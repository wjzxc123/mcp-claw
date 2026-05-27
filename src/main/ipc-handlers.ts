import { ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import { ConfigStore } from './config-store';
import { ChildManager } from './child-manager';
import { ProxyServer } from './proxy-server';
import { HealthChecker } from './health-check';
import { ServerState, AddServerInput, EndpointInfo, AgentConfig, ServerTestResult, StorageSettings, UpdateStorageSettingsInput } from './types';

/**
 * Register all IPC handlers for the main process.
 */
export function registerIpcHandlers(
  configStore: ConfigStore,
  childManagers: Map<string, ChildManager>,
  proxyServer: ProxyServer,
  healthChecker: HealthChecker,
  getStateChangeCallback: (state: ServerState) => void,
): void {
  // servers:list — Return all server states
  ipcMain.handle('servers:list', async (): Promise<ServerState[]> => {
    const configs = configStore.getAll();
    return configs.map(config => {
      const cm = childManagers.get(config.id);
      if (cm) {
        return cm.getState();
      }
      return {
        id: config.id,
        name: config.name,
        description: config.description || '',
        transport: config.transport,
        enabled: config.enabled,
        autoStart: config.autoStart ?? true,
        exposedTo: config.exposedTo || [],
        status: config.enabled ? 'CONNECTING' as const : 'ERROR' as const,
        retryCount: 0,
        configLabel: config.transport === 'stdio'
          ? [(config.config as any).command, ...((config.config as any).args || [])].join(' ')
          : (config.config as any).url || '-',
      };
    });
  });

  // server:toggle — Enable/disable a server
  ipcMain.handle('server:toggle', async (_, { id, enabled }: { id: string; enabled: boolean }) => {
    const result = configStore.toggle(id, enabled);
    if (result.error) {
      return { error: result.error };
    }

    const cm = childManagers.get(id);

    if (enabled) {
      // Start the child process
      if (cm) {
        await cm.start();
      } else {
        // New child manager needs to be created
        const config = configStore.getById(id);
        if (config) {
          const newCm = new ChildManager(config, configStore.getLogPath(config.name));
          childManagers.set(id, newCm);
          proxyServer.registerChildManager(newCm);
          healthChecker.registerChildManager(newCm);
          newCm.on('state-changed', getStateChangeCallback);

          // Notify initial state
          newCm.on('state-changed', (s) => {
            proxyServer.notifyToolsChanged();
          });

          await newCm.start();
        }
      }
    } else {
      // Stop the child process
      if (cm) {
        cm.stop().catch(() => {});
        proxyServer.unregisterChildManager(id);
        healthChecker.unregisterChildManager(id);
        childManagers.delete(id);
      }

      // Push state change so renderer reflects disabled state immediately
      const config = configStore.getById(id);
      if (config) {
        const disabledState: ServerState = {
          id: config.id,
          name: config.name,
          description: config.description || '',
          transport: config.transport,
          enabled: false,
          autoStart: config.autoStart ?? true,
          exposedTo: config.exposedTo || [],
          status: 'ERROR',
          retryCount: 0,
          configLabel: config.transport === 'stdio'
            ? [(config.config as any).command, ...((config.config as any).args || [])].join(' ')
            : (config.config as any).url || '-',
        };
        getStateChangeCallback(disabledState);
      }
    }

    proxyServer.notifyToolsChanged();
    return { success: true };
  });

  // server:add — Add a new server
  ipcMain.handle('server:add', async (_, input: AddServerInput) => {
    const result = configStore.add(input);
    if (result.error) {
      return { error: result.error };
    }

    const server = result.server!;

    if (server.enabled) {
      const cm = new ChildManager(server, configStore.getLogPath(server.name));
      childManagers.set(server.id, cm);
      proxyServer.registerChildManager(cm);
      healthChecker.registerChildManager(cm);
      cm.on('state-changed', getStateChangeCallback);
      cm.on('state-changed', () => proxyServer.notifyToolsChanged());
      await cm.start();
    }

    proxyServer.notifyToolsChanged();
    return { success: true, server };
  });

  // server:delete — Delete a server
  ipcMain.handle('server:delete', async (_, { id }: { id: string }) => {
    const cm = childManagers.get(id);
    if (cm) {
      proxyServer.unregisterChildManager(id);
      healthChecker.unregisterChildManager(id);
      await cm.stop();
      childManagers.delete(id);
    }

    configStore.delete(id);
    proxyServer.notifyToolsChanged();
    return { success: true };
  });

  // server:reconnect — Manually reconnect a server
  ipcMain.handle('server:reconnect', async (_, { id }: { id: string }) => {
    const cm = childManagers.get(id);
    if (!cm) {
      return { error: `Server "${id}" not found` };
    }
    await cm.reconnect();
    return { success: true };
  });

  // server:test — Check whether a managed MCP server is usable.
  ipcMain.handle('server:test', async (_, { id }: { id: string }): Promise<ServerTestResult> => {
    const cm = childManagers.get(id);
    if (!cm) {
      return {
        ok: false,
        status: 'ERROR',
        toolCount: 0,
        durationMs: 0,
        error: `Server "${id}" is not running`,
      };
    }

    const startedAt = Date.now();
    const state = cm.getState();
    if (!state.enabled) {
      return {
        ok: false,
        status: state.status,
        toolCount: 0,
        durationMs: Date.now() - startedAt,
        error: 'Server is disabled',
      };
    }

    if (state.status !== 'READY') {
      return {
        ok: false,
        status: state.status,
        toolCount: 0,
        durationMs: Date.now() - startedAt,
        error: state.error || `Server is not ready (status: ${state.status})`,
      };
    }

    try {
      const tools = await cm.getTools();
      return {
        ok: true,
        status: cm.getState().status,
        toolCount: tools.length,
        durationMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      return {
        ok: false,
        status: cm.getState().status,
        toolCount: 0,
        durationMs: Date.now() - startedAt,
        error: err?.message || String(err),
      };
    }
  });

  // server:set-exposed-to — Set which agents can access a server
  ipcMain.handle('server:set-exposed-to', async (_, { id, agentIds }: { id: string; agentIds: string[] }) => {
    const result = configStore.setExposedTo(id, agentIds);
    if (result.error) {
      return { error: result.error };
    }

    const cm = childManagers.get(id);
    if (cm) {
      cm.setExposedTo(agentIds);
    }

    proxyServer.notifyToolsChanged();
    return { success: true };
  });

  // agents:list — Return all agents
  ipcMain.handle('agents:list', async (): Promise<AgentConfig[]> => {
    return configStore.getAgents();
  });

  // agent:add — Add a new agent
  ipcMain.handle('agent:add', async (_, { name }: { name: string }) => {
    const result = configStore.addAgent(name);
    if (result.error) return { error: result.error };
    proxyServer.setAgents(configStore.getAgents());
    proxyServer.notifyToolsChanged();
    return { agent: result.agent };
  });

  // agent:remove — Remove an agent
  ipcMain.handle('agent:remove', async (_, { id }: { id: string }) => {
    const result = configStore.removeAgent(id);
    if (result.error) return { error: result.error };
    // Update all child managers whose exposedTo may have changed
    for (const s of configStore.getAll()) {
      const cm = childManagers.get(s.id);
      if (cm) cm.setExposedTo(s.exposedTo);
    }
    proxyServer.setAgents(configStore.getAgents());
    proxyServer.notifyToolsChanged();
    return { success: true };
  });

  // agent:update-name — Rename an agent
  ipcMain.handle('agent:update-name', async (_, { id, name }: { id: string; name: string }) => {
    const result = configStore.updateAgentName(id, name);
    if (result.error) return { error: result.error };
    proxyServer.setAgents(configStore.getAgents());
    return { agent: result.agent };
  });

  // agent:update-token — Update an agent's token
  ipcMain.handle('agent:update-token', async (_, { id, token }: { id: string; token: string }) => {
    const result = configStore.updateAgentToken(id, token);
    if (result.error) return { error: result.error };
    proxyServer.setAgents(configStore.getAgents());
    return { agent: result.agent };
  });

  // server:auto-start — Toggle auto-start on launch
  ipcMain.handle('server:auto-start', async (_, { id, autoStart }: { id: string; autoStart: boolean }) => {
    const result = configStore.setAutoStart(id, autoStart);
    if (result.error) {
      return { error: result.error };
    }

    const cm = childManagers.get(id);
    if (cm) {
      cm.setAutoStart(autoStart);
    }

    return { success: true };
  });

  // server:get-log — Read log file for a server
  ipcMain.handle('server:get-log', async (_, { name }: { name: string }) => {
    try {
      const logPath = configStore.getLogPath(name);
      if (!fs.existsSync(logPath)) {
        return { content: '', error: null };
      }
      const raw = fs.readFileSync(logPath, 'utf-8');
      const lines = raw.split(/\r?\n/);
      const tail = lines.slice(-5000).join('\n');
      return { content: tail };
    } catch (err: any) {
      return { content: '', error: err.message };
    }
  });

  // server:clear-log — Truncate log file
  ipcMain.handle('server:clear-log', async (_, { name }: { name: string }) => {
    try {
      const logPath = configStore.getLogPath(name);
      fs.writeFileSync(logPath, '', { mode: 0o600 });
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // server:update — Update an existing server
  ipcMain.handle('server:update', async (_, { id, input }: { id: string; input: AddServerInput }) => {
    const result = configStore.update(id, input);
    if (result.error) {
      return { error: result.error };
    }

    const server = result.server!;

    // Stop and restart the child process if it's running
    const cm = childManagers.get(id);
    if (cm) {
      proxyServer.unregisterChildManager(id);
      healthChecker.unregisterChildManager(id);
      await cm.stop();
      childManagers.delete(id);
    }

    if (server.enabled) {
      const newCm = new ChildManager(server, configStore.getLogPath(server.name));
      childManagers.set(id, newCm);
      proxyServer.registerChildManager(newCm);
      healthChecker.registerChildManager(newCm);
      newCm.on('state-changed', getStateChangeCallback);
      newCm.on('state-changed', () => proxyServer.notifyToolsChanged());
      await newCm.start();
    }

    proxyServer.notifyToolsChanged();
    return { success: true, server };
  });

  // server:get-config — Get full config for a server (for edit form)
  ipcMain.handle('server:get-config', async (_, { id }: { id: string }) => {
    const config = configStore.getById(id);
    if (!config) {
      return { error: 'Server not found' };
    }
    return { config };
  });

  // server:get-tools — Get tools for a specific server
  ipcMain.handle('server:get-tools', async (_, { id }: { id: string }) => {
    const cm = childManagers.get(id);
    if (!cm) {
      return { tools: [], error: 'Server not found' };
    }
    try {
      const tools = await cm.getTools();
      return { tools };
    } catch (err: any) {
      return { tools: [], error: err.message };
    }
  });

  // proxy:get-access-logs — Get recent access log entries
  ipcMain.handle('proxy:get-access-logs', async () => {
    return proxyServer.getAccessLogs();
  });

  // settings:get-storage — Return current storage paths
  ipcMain.handle('settings:get-storage', async (): Promise<StorageSettings> => {
    return configStore.getStorageSettings();
  });

  // settings:select-config-file — Pick a JSON config file path
  ipcMain.handle('settings:select-config-file', async (): Promise<{ path?: string; canceled?: boolean; error?: string }> => {
    try {
      const current = configStore.getStorageSettings();
      const result = await dialog.showSaveDialog({
        title: '选择 MCP 服务配置文件',
        defaultPath: current.configFile,
        buttonLabel: '使用此路径',
        filters: [
          { name: 'JSON 配置文件', extensions: ['json'] },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      return { path: result.filePath };
    } catch (err: any) {
      return { error: err?.message || String(err) };
    }
  });

  // settings:select-logs-dir — Pick a logs directory
  ipcMain.handle('settings:select-logs-dir', async (): Promise<{ path?: string; canceled?: boolean; error?: string }> => {
    try {
      const current = configStore.getStorageSettings();
      const result = await dialog.showOpenDialog({
        title: '选择 MCP 服务日志目录',
        defaultPath: current.logsDir,
        buttonLabel: '选择目录',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }

      return { path: result.filePaths[0] };
    } catch (err: any) {
      return { error: err?.message || String(err) };
    }
  });

  // settings:update-storage — Update config/log storage paths
  ipcMain.handle('settings:update-storage', async (_, input: UpdateStorageSettingsInput) => {
    const result = configStore.updateStorageSettings(input);
    if (result.error) {
      return { error: result.error };
    }

    const runningManagers = Array.from(childManagers.entries());
    for (const [id, cm] of runningManagers) {
      const config = configStore.getById(id);
      if (!config) continue;

      proxyServer.unregisterChildManager(id);
      healthChecker.unregisterChildManager(id);
      await cm.stop();
      childManagers.delete(id);

      if (config.enabled) {
        const newCm = new ChildManager(config, configStore.getLogPath(config.name));
        childManagers.set(id, newCm);
        proxyServer.registerChildManager(newCm);
        healthChecker.registerChildManager(newCm);
        newCm.on('state-changed', getStateChangeCallback);
        newCm.on('state-changed', () => proxyServer.notifyToolsChanged());
        await newCm.start();
      }
    }

    proxyServer.notifyToolsChanged();
    return { settings: result.settings };
  });

  // endpoint:info — Get endpoint information
  ipcMain.handle('endpoint:info', async (): Promise<EndpointInfo> => {
    return {
      url: `http://localhost:${proxyServer.getPort()}/mcp`,
      port: proxyServer.getPort(),
      agents: configStore.getAgents(),
    };
  });
}
