import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigStore } from '../../src/main/config-store';
import { AddServerInput } from '../../src/main/types';

function createStore(): ConfigStore {
  const testDir = path.join(os.tmpdir(), `mcp-gateway-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return new ConfigStore(testDir);
}

describe('ConfigStore', () => {
  let stores: ConfigStore[] = [];

  afterEach(() => {
    // Clean up test dirs
    for (const store of stores) {
      try {
        const dir = (store as any).configDir;
        if (dir && fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {}
    }
    stores = [];
  });

  function track(store: ConfigStore): ConfigStore {
    stores.push(store);
    return store;
  }

  it('load returns empty config when file missing', () => {
    const store = track(createStore());
    const { servers, error } = store.load();
    expect(servers).toEqual([]);
    expect(error).toBeUndefined();
  });

  it('load parses valid file correctly', () => {
    const store = track(createStore());
    // Manually write a valid config to the store's directory
    const dir = (store as any).configDir;
    const file = path.join(dir, 'servers.json');
    const config = {
      version: 1,
      servers: [
        {
          id: 'test-1',
          name: 'test-server',
          transport: 'stdio',
          enabled: true,
          config: {
            command: 'npx',
            args: ['-y', 'some-server'],
            env: {},
            cwd: null,
          },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config));

    const { servers } = store.load();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-server');
  });

  it('load returns error when JSON is corrupted', () => {
    const store = track(createStore());
    const dir = (store as any).configDir;
    const file = path.join(dir, 'servers.json');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, 'not valid json{{{');

    const { error } = store.load();
    expect(error).toBeDefined();
  });

  // Validation tests (static method)
  it('validate rejects missing required fields', () => {
    expect(ConfigStore.validateServer(null)).toBe('server must be an object');
    expect(ConfigStore.validateServer({})).toBe('missing id');
    expect(ConfigStore.validateServer({ id: 'x' })).toBe('missing name');
  });

  it('validate rejects duplicate server names', () => {
    const store = track(createStore());
    const input: AddServerInput = {
      name: 'unique',
      transport: 'stdio',
      enabled: true,
      config: { command: 'npx', args: [], env: {}, cwd: null },
    };

    store.add(input);
    const result = store.add(input);
    expect(result.error).toBe('Server name "unique" already exists');
  });

  it('rejects server name with __', () => {
    const store = track(createStore());
    const result = store.add({
      name: 'bad__name',
      transport: 'stdio',
      enabled: true,
      config: { command: 'npx', args: [], env: {}, cwd: null },
    });
    expect(result.error).toBe('Server name cannot contain "__"');
  });

  it('add with valid config saves and can be retrieved', () => {
    const store = track(createStore());
    const input: AddServerInput = {
      name: 'my-server',
      transport: 'stdio',
      enabled: true,
      config: { command: 'npx', args: ['-y', 'pkg'], env: {}, cwd: null },
    };

    const { server, error } = store.add(input);
    expect(error).toBeUndefined();
    expect(server).toBeDefined();
    expect(server!.name).toBe('my-server');
    expect(server!.id).toBeDefined();

    const all = store.getAll();
    expect(all).toHaveLength(1);
  });

  it('updates storage paths and saves current config to the new file', () => {
    const store = track(createStore());
    store.load();
    store.add({
      name: 'portable-server',
      transport: 'stdio',
      enabled: true,
      config: { command: 'node', args: ['server.js'], env: {}, cwd: null },
    });

    const baseDir = (store as any).settingsFile
      ? path.dirname((store as any).settingsFile)
      : os.tmpdir();
    const nextDir = path.join(baseDir, 'custom-storage');
    const nextConfigFile = path.join(nextDir, 'mcp-services.json');
    const nextLogsDir = path.join(nextDir, 'logs');

    const result = store.updateStorageSettings({
      configFile: nextConfigFile,
      logsDir: nextLogsDir,
    });

    expect(result.error).toBeUndefined();
    expect(result.settings?.configFile).toBe(nextConfigFile);
    expect(result.settings?.logsDir).toBe(nextLogsDir);
    expect(fs.existsSync(nextConfigFile)).toBe(true);
    expect(fs.existsSync(path.join(baseDir, 'settings.json'))).toBe(true);

    const saved = JSON.parse(fs.readFileSync(nextConfigFile, 'utf-8'));
    expect(saved.servers[0].name).toBe('portable-server');
  });
});
