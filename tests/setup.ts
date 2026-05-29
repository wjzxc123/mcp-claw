import '@testing-library/jest-dom';

const testGlobal = typeof window === 'undefined' ? globalThis : window;

// Mock electron APIs without replacing jsdom's window object.
(testGlobal as any).mcpGateway = {
  getServers: async () => [],
  toggleServer: async () => ({ success: true }),
  addServer: async (input: any) => ({ success: true, server: { id: 'mock-id', ...input } }),
  deleteServer: async () => ({ success: true }),
  reconnectServer: async () => ({ success: true }),
  testServer: async () => ({ ok: true, status: 'READY', toolCount: 0, durationMs: 0 }),
  getEndpointInfo: async () => ({ url: 'http://localhost:18721/mcp', port: 18721 }),
  getStorageSettings: async () => ({
    configFile: 'C:\\Users\\test\\.mcp-gateway\\servers.json',
    logsDir: 'C:\\Users\\test\\.mcp-gateway\\logs',
    settingsFile: 'C:\\Users\\test\\.mcp-gateway\\settings.json',
  }),
  selectConfigFile: async () => ({ canceled: true }),
  selectLogsDir: async () => ({ canceled: true }),
  updateStorageSettings: async (input: any) => ({
    settings: {
      ...input,
      settingsFile: 'C:\\Users\\test\\.mcp-gateway\\settings.json',
    },
  }),
  onStateChanged: (cb: Function) => {
    return () => {};
  },
};

// Mock process.kill for Windows health check tests
if (!(global as any).process) {
  (global as any).process = {};
}
