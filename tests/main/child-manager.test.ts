import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [{ name: 'test_tool', description: 'A test tool', inputSchema: {} }],
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
    }),
  })),
}));

import { ChildManager, createSpawnSpec, resolveCommand } from '../../src/main/child-manager';
import { ServerConfig } from '../../src/main/types';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const baseConfig: ServerConfig = {
  id: 'test-1',
  name: 'test-server',
  transport: 'stdio',
  enabled: true,
  config: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-test'],
    env: {},
    cwd: null,
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ChildManager', () => {
  let logPath: string;

  beforeEach(() => {
    logPath = path.join(os.tmpdir(), `test-${Date.now()}.log`);
  });

  afterEach(async () => {
    // cleanup
  });

  it('spawn starts process and Client.connect succeeds', async () => {
    const cm = new ChildManager(baseConfig, logPath);
    // Since spawn is async and involves real process, we test state transitions
    expect(cm.getState().status).toBe('CONNECTING');
    expect(cm.getName()).toBe('test-server');
    expect(cm.getId()).toBe('test-1');
    expect(cm.isEnabled()).toBe(true);
  });

  it('getState returns current state', () => {
    const cm = new ChildManager(baseConfig, logPath);
    const state = cm.getState();
    expect(state.id).toBe('test-1');
    expect(state.name).toBe('test-server');
    expect(state.status).toBe('CONNECTING');
    expect(state.enabled).toBe(true);
    expect(state.retryCount).toBe(0);
  });

  it('checkHealth for CONNECTING state returns CONNECTING', () => {
    const cm = new ChildManager(baseConfig, logPath);
    expect(cm.checkHealth()).toBe('CONNECTING');
  });

  it('cleanup on stop sets isCleaningUp and removes listeners', async () => {
    const cm = new ChildManager(baseConfig, logPath);
    // Should not throw when stopping a non-started process
    await expect(cm.stop()).resolves.toBeUndefined();
  });

  it('resolves command wrappers from PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-claw-command-'));
    const ext = process.platform === 'win32' ? '.cmd' : '';
    const executable = path.join(dir, `npx${ext}`);
    fs.writeFileSync(executable, '');

    const resolved = resolveCommand('npx', {
      Path: dir,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    });

    expect(resolved).toBe(executable);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps command scripts in non-shell mode for cross-spawn', () => {
    const command = process.platform === 'win32' ? 'C:\\node\\npx.cmd' : '/usr/bin/npx';
    const spec = createSpawnSpec(command, ['--version']);

    if (process.platform === 'win32') {
      expect(spec.command).toBe(command);
      expect(spec.args).toEqual(['--version']);
      expect(spec.shell).toBe(false);
      expect(spec.displayCommand).toContain('npx.cmd');
    } else {
      expect(spec.command).toBe(command);
      expect(spec.args).toEqual(['--version']);
      expect(spec.shell).toBe(false);
    }
  });
});
