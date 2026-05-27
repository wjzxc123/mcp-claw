import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { ConfigStore } from './config-store';
import { ChildManager } from './child-manager';
import { ProxyServer } from './proxy-server';
import { HealthChecker } from './health-check';
import { registerIpcHandlers } from './ipc-handlers';
import { ServerState, AccessLogEntry, DEFAULT_PORT, HEALTH_CHECK_INTERVAL, STARTUP_TIMEOUT } from './types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let proxyServer: ProxyServer;
let configStore: ConfigStore;
let healthChecker: HealthChecker;
const childManagers: Map<string, ChildManager> = new Map();

// Push state changes to renderer
function pushStateChange(state: ServerState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('servers:state-changed', state);
  }
}

// Push access log entries to renderer in real-time
function pushAccessLog(entry: AccessLogEntry): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('proxy:access-log', entry);
  }
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');

  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 680,
    minHeight: 480,
    title: 'MCP Claw',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url) => {
    console.error('[FAIL] Load failed:', errorCode, errorDescription, url);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[GONE] Render process gone:', details.reason, details.exitCode);
  });

  const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  // Once the renderer is ready, push all current states so the UI
  // reflects any servers that auto-started during bootstrap.
  mainWindow.webContents.on('did-finish-load', () => {
    for (const cm of childManagers.values()) {
      pushStateChange(cm.getState());
    }
    proxyServer?.notifyToolsChanged();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  // Create a simple tray icon (16x16 transparent PNG)
  // In production, use a proper icon file
  try {
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show', click: () => mainWindow?.show() },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setToolTip('MCP Claw');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow?.show());
  } catch {
    // Tray may not be supported on all platforms
  }
}

async function bootstrap(): Promise<void> {
  // 1. Load configuration
  configStore = new ConfigStore();
  const { servers, agents, error } = configStore.load();

  if (error) {
    console.error('Config load error:', error);
  }

  // 2. Create proxy server
  proxyServer = new ProxyServer(DEFAULT_PORT);
  proxyServer.setAgents(agents || []);
  proxyServer.onAccessLog(pushAccessLog);

  // 3. Set up health checker
  healthChecker = new HealthChecker(proxyServer, pushStateChange);

  // 4. Register IPC handlers
  registerIpcHandlers(configStore, childManagers, proxyServer, healthChecker, pushStateChange);

  // 5. Start proxy server
  try {
    await proxyServer.start();
    console.log(`Proxy server started on port ${DEFAULT_PORT}`);
  } catch (err: any) {
    console.error('Failed to start proxy server:', err.message);
    // Show error in UI later
  }

  // 6. Start auto-start servers in parallel
  const autoStartServers = servers.filter(s => s.autoStart !== false);

  await Promise.allSettled(
    autoStartServers.map(async (config) => {
      const cm = new ChildManager(config, configStore.getLogPath(config.name));
      childManagers.set(config.id, cm);
      proxyServer.registerChildManager(cm);
      healthChecker.registerChildManager(cm);
      cm.on('state-changed', pushStateChange);
      cm.on('state-changed', () => {
        proxyServer.notifyToolsChanged();
      });
      await cm.start();
    }),
  );

  // 7. Wait for startup timeout then ensure proxy is serving
  setTimeout(() => {
    proxyServer.notifyToolsChanged();
  }, STARTUP_TIMEOUT);

  // 8. Start periodic health checks
  healthChecker.start(HEALTH_CHECK_INTERVAL);
}

// App lifecycle
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await bootstrap();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Don't quit on macOS (keep in tray)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Graceful shutdown — prevent Electron from exiting until cleanup completes
app.on('before-quit', async (event) => {
  event.preventDefault();

  healthChecker?.stop();

  // Kill all child processes
  const stops = Array.from(childManagers.values()).map(cm => cm.stop());
  await Promise.all(stops);

  if (proxyServer) {
    await proxyServer.stop();
  }

  app.exit(0);
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}
