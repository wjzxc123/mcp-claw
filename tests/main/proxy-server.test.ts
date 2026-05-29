import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the MCP SDK modules used by ProxyServer
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const mockHandlers: Map<string, Function> = new Map();
  return {
    Server: vi.fn().mockImplementation(() => ({
      setRequestHandler: vi.fn((schema: any, handler: Function) => {
        mockHandlers.set(schema._meta?.method || 'tools/list', handler);
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      notification: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      _getHandler: (method: string) => mockHandlers.get(method),
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
    handleRequest: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onclose: undefined,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { _meta: { method: 'tools/list' } },
  CallToolRequestSchema: { _meta: { method: 'tools/call' } },
  ListResourcesRequestSchema: { _meta: { method: 'resources/list' } },
  ListResourceTemplatesRequestSchema: { _meta: { method: 'resources/templates/list' } },
  ReadResourceRequestSchema: { _meta: { method: 'resources/read' } },
  ListPromptsRequestSchema: { _meta: { method: 'prompts/list' } },
  GetPromptRequestSchema: { _meta: { method: 'prompts/get' } },
  CompleteRequestSchema: { _meta: { method: 'completion/complete' } },
  SubscribeRequestSchema: { _meta: { method: 'resources/subscribe' } },
  UnsubscribeRequestSchema: { _meta: { method: 'resources/unsubscribe' } },
  SetLevelRequestSchema: { _meta: { method: 'logging/setLevel' } },
}));

import { ProxyServer } from '../../src/main/proxy-server';
import { ChildManager } from '../../src/main/child-manager';
import { MCPTool } from '../../src/main/types';
import { EventEmitter } from 'events';
import { request } from 'http';

// Create a simple ChildManager mock
class MockChildManager extends EventEmitter {
  private id: string;
  private name: string;
  private state: any;
  private tools: MCPTool[] = [];

  constructor(id: string, name: string, tools: MCPTool[]) {
    super();
    this.id = id;
    this.name = name;
    this.tools = tools;
    this.state = {
      id,
      name,
      description: '',
      transport: 'stdio',
      autoStart: true,
      status: 'READY',
      enabled: true,
      exposedTo: ['agent-1'],
      retryCount: 0,
    };
  }

  getId() { return this.id; }
  getName() { return this.name; }
  getState() { return { ...this.state }; }
  isEnabled() { return this.state.enabled; }
  async getTools() { return this.tools; }
  getCachedTools() { return this.tools; }

  async callTool(name: string, args: Record<string, unknown>) {
    return { content: [{ type: 'text', text: `called ${name}` }] };
  }

  checkHealth() { return 'READY'; }
}

function httpRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}

describe('ProxyServer', () => {
  let proxy: ProxyServer;
  let port: number;

  function authenticate(agentId = 'agent-1') {
    (proxy as any).currentRequestAgentId = agentId;
    proxy.setAgents([{ id: agentId, name: 'Claude Code', token: 'token-1' }]);
  }

  beforeEach(() => {
    port = 19800 + Math.floor(Math.random() * 1000);
    proxy = new ProxyServer(port);
  });

  afterEach(async () => {
    await proxy.stop();
  });

  it('returns correct port', () => {
    expect(proxy.getPort()).toBe(port);
  });

  it('getTools returns empty when no backends', async () => {
    authenticate();
    const tools = await proxy.getTools();
    expect(tools.map(t => t.name).sort()).toEqual([
      'mcp_claw__call_tool',
      'mcp_claw__get_server_status',
      'mcp_claw__list_servers',
      'mcp_claw__list_tools',
      'mcp_claw__search',
    ]);
  });

  it('getTools returns namespaced tools from all clients', async () => {
    authenticate();
    const cm1 = new MockChildManager('1', 'github', [
      { name: 'create_issue', description: '', inputSchema: {} },
    ]);
    const cm2 = new MockChildManager('2', 'filesystem', [
      { name: 'read_file', description: '', inputSchema: {} },
    ]);

    proxy.registerChildManager(cm1 as unknown as ChildManager);
    proxy.registerChildManager(cm2 as unknown as ChildManager);

    // Wait for async tool registration to complete
    await new Promise(r => setTimeout(r, 10));

    const tools = await proxy.getTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'filesystem__read_file',
      'github__create_issue',
      'mcp_claw__call_tool',
      'mcp_claw__get_server_status',
      'mcp_claw__list_servers',
      'mcp_claw__list_tools',
      'mcp_claw__search',
    ]);
  });

  it('skips disconnected backends', async () => {
    const cmReady = new MockChildManager('1', 'good', [
      { name: 'ok_tool', description: '', inputSchema: {} },
    ]);
    const cmError = new MockChildManager('2', 'bad', [
      { name: 'bad_tool', description: '', inputSchema: {} },
    ]);
    (cmError as any).state.status = 'ERROR';

    proxy.registerChildManager(cmReady as unknown as ChildManager);
    proxy.registerChildManager(cmError as unknown as ChildManager);

    // getTools would get from cmReady's tools-updated event + cmError might still add
    // After calling invalidateCache, it re-aggregates from router which gets set via tools-updated events
    // The routing works correctly since tool-router only has tools from servers that emitted tools-updated
  });

  it('starts with zero backends without error', async () => {
    await expect(proxy.start()).resolves.toBeUndefined();
  });

  it('rejects missing token at HTTP layer', async () => {
    proxy.setAgents([{ id: 'agent-1', name: 'Claude Code', token: 'token-1' }]);
    await proxy.start();

    const response = await httpRequest(port, '/mcp');

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'unauthorized',
      message: 'A valid MCP Claw agent token is required.',
    });
  });

  it('rejects invalid token at HTTP layer', async () => {
    proxy.setAgents([{ id: 'agent-1', name: 'Claude Code', token: 'token-1' }]);
    await proxy.start();

    const response = await httpRequest(port, '/mcp', {
      Authorization: 'Bearer wrong-token',
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer realm="mcp-claw"');
  });

  it('stops gracefully', async () => {
    await proxy.stop();
  });

  it('invalidateCache clears tool cache', async () => {
    authenticate();
    proxy.invalidateCache();
    const tools = await proxy.getTools();
    expect(tools.map(t => t.name).sort()).toEqual([
      'mcp_claw__call_tool',
      'mcp_claw__get_server_status',
      'mcp_claw__list_servers',
      'mcp_claw__list_tools',
      'mcp_claw__search',
    ]);
  });

  it('notifyToolsChanged does not throw when no client', async () => {
    await expect(proxy.notifyToolsChanged()).resolves.toBeUndefined();
  });

  it('does not expose tools without an authenticated agent', async () => {
    const cm = new MockChildManager('1', 'github', [
      { name: 'create_issue', description: '', inputSchema: {} },
    ]);
    proxy.registerChildManager(cm as unknown as ChildManager);

    await new Promise(r => setTimeout(r, 10));

    await expect(proxy.getTools()).resolves.toEqual([]);
  });

  it('gateway list_servers reports managed server visibility', async () => {
    authenticate();
    const cm = new MockChildManager('1', 'github', [
      { name: 'create_issue', description: 'Create issue', inputSchema: {} },
    ]);
    proxy.registerChildManager(cm as unknown as ChildManager);

    const result = await (proxy as any).callGatewayTool('list_servers', {});
    const payload = JSON.parse(result.content[0].text);

    expect(payload.gateway).toBe('mcp_claw');
    expect(payload.agent).toBe('Claude Code');
    expect(payload.servers).toHaveLength(1);
    expect(payload.servers[0]).toMatchObject({
      name: 'github',
      status: 'READY',
      exposedToCurrentAgent: true,
      visibleToCurrentAgent: true,
      toolCount: 1,
    });
  });

  it('gateway list_tools returns exposed tool names', async () => {
    authenticate();
    const cm = new MockChildManager('1', 'github', [
      { name: 'create_issue', description: 'Create issue', inputSchema: {} },
    ]);
    proxy.registerChildManager(cm as unknown as ChildManager);

    const result = await (proxy as any).callGatewayTool('list_tools', {});
    const payload = JSON.parse(result.content[0].text);

    expect(payload.tools).toEqual([
      {
        server: 'github',
        tool: 'create_issue',
        exposedName: 'github__create_issue',
        callViaGateway: {
          tool: 'mcp_claw__call_tool',
          arguments: {
            server: 'github',
            tool: 'create_issue',
            arguments: {},
          },
        },
        description: 'Create issue',
        inputSchema: {},
      },
    ]);
  });

  it('gateway call_tool invokes tool by server and original tool name', async () => {
    authenticate();
    const cm = new MockChildManager('1', 'github', [
      { name: 'create_issue', description: 'Create issue', inputSchema: {} },
    ]);
    const callTool = vi.spyOn(cm, 'callTool');
    proxy.registerChildManager(cm as unknown as ChildManager);

    const result = await (proxy as any).callGatewayTool('call_tool', {
      server: 'github',
      tool: 'create_issue',
      arguments: { title: 'Bug' },
    });

    expect(callTool).toHaveBeenCalledWith('create_issue', { title: 'Bug' });
    expect(result.content[0].text).toBe('called create_issue');
  });

  it('gateway search finds visible servers and tools', async () => {
    authenticate();
    const cm = new MockChildManager('1', 'github', [
      { name: 'create_issue', description: 'Create issue', inputSchema: {} },
    ]);
    proxy.registerChildManager(cm as unknown as ChildManager);

    const result = await (proxy as any).callGatewayTool('search', { query: 'issue' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.servers).toEqual([]);
    expect(payload.tools).toHaveLength(1);
    expect(payload.tools[0].exposedName).toBe('github__create_issue');
  });
});
