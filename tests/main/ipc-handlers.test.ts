import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { registerIpcHandlers } from '../../src/main/ipc-handlers';
import { ConfigStore } from '../../src/main/config-store';
import { ChildManager } from '../../src/main/child-manager';
import { ProxyServer } from '../../src/main/proxy-server';
import { HealthChecker } from '../../src/main/health-check';
import { EventEmitter } from 'events';

// Clear handlers between tests
beforeEach(() => {
  (ipcMain as any)._clear();
});

function createMocks() {
  const testDir = path.join(os.tmpdir(), `mcp-gateway-ipc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configStore = new ConfigStore(testDir);
  const childManagers = new Map<string, ChildManager>();
  const proxyServer = {
    getPort: () => 18721,
    registerChildManager: vi.fn(),
    unregisterChildManager: vi.fn(),
    notifyToolsChanged: vi.fn(),
    invalidateCache: vi.fn(),
  } as unknown as ProxyServer;
  const healthChecker = {
    registerChildManager: vi.fn(),
    unregisterChildManager: vi.fn(),
  } as unknown as HealthChecker;
  const onStateChange = vi.fn();

  registerIpcHandlers(
    configStore,
    childManagers,
    proxyServer,
    healthChecker,
    onStateChange,
  );

  return { configStore, childManagers, proxyServer, healthChecker, onStateChange, testDir };
}

class MockChildManager extends EventEmitter {
  constructor(
    private state: any,
    private tools: any[] = [],
    private toolsError?: Error,
  ) {
    super();
  }

  getId() { return this.state.id; }
  getName() { return this.state.name; }
  getState() { return { ...this.state }; }
  async getTools() {
    if (this.toolsError) throw this.toolsError;
    return this.tools;
  }

  getCachedTools() {
    return this.tools;
  }
}

describe('IPC Handlers', () => {
  const testDirs: string[] = [];

  afterEach(() => {
    for (const dir of testDirs) {
      try {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    testDirs.length = 0;
  });

  function track(dir: string) {
    testDirs.push(dir);
  }

  it('servers:list returns empty when no servers', async () => {
    const { configStore, testDir } = createMocks();
    track(testDir);
    configStore.load();

    const result = await (ipcMain as any)._invoke(undefined, 'servers:list');
    expect(result).toEqual([]);
  });

  it('server:add with invalid config returns error', async () => {
    createMocks();
    const result = await (ipcMain as any)._invoke(undefined, 'server:add', {
      name: '',
      transport: 'stdio',
      enabled: false,
      config: { command: '', args: [], env: {}, cwd: null },
    });
    expect(result).toBeDefined();
  });

  it('endpoint:info returns URL and port', async () => {
    const { proxyServer } = createMocks();
    const result = await (ipcMain as any)._invoke(undefined, 'endpoint:info');
    expect(result.url).toContain('18721');
    expect(result.url).toContain('/mcp');
    expect(result.port).toBe(18721);
  });

  it('server:delete returns success for non-existent server', async () => {
    createMocks();
    const result = await (ipcMain as any)._invoke(undefined, 'server:delete', { id: 'non-existent' });
    expect(result.success).toBe(true);
  });

  it('server:reconnect returns error for non-existent server', async () => {
    createMocks();
    const result = await (ipcMain as any)._invoke(undefined, 'server:reconnect', { id: 'non-existent' });
    expect(result.error).toBeDefined();
  });

  it('server:test returns success for tools on a ready server', async () => {
    const { childManagers } = createMocks();
    childManagers.set('srv-1', new MockChildManager(
      { id: 'srv-1', name: 'github', enabled: true, status: 'READY', retryCount: 0 },
      [{ name: 'create_issue' }, { name: 'list_repos' }],
    ) as unknown as ChildManager);

    const result = await (ipcMain as any)._invoke(undefined, 'server:test', { id: 'srv-1' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('READY');
    expect(result.toolCount).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('server:test returns failure for a non-ready server', async () => {
    const { childManagers } = createMocks();
    childManagers.set('srv-1', new MockChildManager(
      { id: 'srv-1', name: 'github', enabled: true, status: 'ERROR', error: 'crash', retryCount: 1 },
    ) as unknown as ChildManager);

    const result = await (ipcMain as any)._invoke(undefined, 'server:test', { id: 'srv-1' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('ERROR');
    expect(result.error).toBe('crash');
  });
});
