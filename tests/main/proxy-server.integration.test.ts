// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ProxyServer } from '../../src/main/proxy-server';
import { ChildManager } from '../../src/main/child-manager';
import { MCPTool } from '../../src/main/types';

class MockChildManager extends EventEmitter {
  private state: any;

  constructor(
    private readonly id: string,
    private readonly name: string,
    private readonly tools: MCPTool[],
  ) {
    super();
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
  async getTools() { return this.tools; }
  getCachedTools() { return this.tools; }

  async callTool(name: string) {
    return { content: [{ type: 'text', text: `called ${name}` }] };
  }
}

describe('ProxyServer MCP integration', () => {
  let proxy: ProxyServer;
  let port: number;

  beforeEach(() => {
    port = 21000 + Math.floor(Math.random() * 1000);
    proxy = new ProxyServer(port);
    proxy.setAgents([{ id: 'agent-1', name: 'Claude Code', token: 'token-1' }]);
  });

  afterEach(async () => {
    await proxy.stop();
  });

  it('exposes gateway and aggregated tools through streamable HTTP tools/list', async () => {
    proxy.registerChildManager(new MockChildManager('srv-1', 'github', [
      {
        name: 'create_issue',
        description: 'Create an issue',
        inputSchema: { type: 'object', properties: {} },
      },
    ]) as unknown as ChildManager);

    await new Promise(resolve => setTimeout(resolve, 20));
    await proxy.start();

    const client = new Client(
      { name: 'integration-test', version: '0.1.0' },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: 'Bearer token-1',
          },
        },
      },
    );

    try {
      await client.connect(transport);
      const result = await client.listTools();
      const names = result.tools.map(tool => tool.name).sort();

      expect(names).toContain('mcp_claw__list_tools');
      expect(names).toContain('mcp_claw__call_tool');
      expect(names).toContain('github__create_issue');

      const gatewayResult = await client.callTool({
        name: 'mcp_claw__list_tools',
        arguments: {},
      });
      expect((gatewayResult.content as any[])[0].text).toContain('github__create_issue');

      const gatewayCallResult = await client.callTool({
        name: 'mcp_claw__call_tool',
        arguments: {
          server: 'github',
          tool: 'create_issue',
          arguments: { title: 'Test issue' },
        },
      });
      expect((gatewayCallResult.content as any[])[0].text).toBe('called create_issue');

      const downstreamResult = await client.callTool({
        name: 'github__create_issue',
        arguments: { title: 'Test issue' },
      });
      expect((downstreamResult.content as any[])[0].text).toBe('called create_issue');
    } finally {
      await client.close();
    }
  });
});
