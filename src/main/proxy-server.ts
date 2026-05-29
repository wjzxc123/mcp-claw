import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, Server as HttpServer, IncomingMessage } from 'http';
import { ChildManager } from './child-manager';
import { ToolRouter, parseToolName, prefixToolName } from './tool-router';
import { MCPTool, AgentConfig, AccessLogEntry, DEFAULT_PORT, GATEWAY_SERVER_NAME } from './types';

const GATEWAY_TOOLS: MCPTool[] = [
  {
    name: prefixToolName(GATEWAY_SERVER_NAME, 'list_servers'),
    title: 'List Managed MCP Servers',
    description: 'List MCP servers managed by MCP Claw, including status, transport, exposure for the current agent, and tool count.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: prefixToolName(GATEWAY_SERVER_NAME, 'list_tools'),
    title: 'List Managed MCP Tools',
    description: 'List tools currently available to the authenticated agent through MCP Claw, grouped by managed MCP service. Use this when the user names an MCP service and you need to find tools from that service.',
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Optional managed server name to filter by.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: prefixToolName(GATEWAY_SERVER_NAME, 'call_tool'),
    title: 'Call Tool By Managed MCP Service',
    description: 'Call a tool by MCP service name and original tool name. Use this after listing or searching tools when the user refers to a managed MCP service instead of a namespaced tool name.',
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Managed MCP service name, for example "github" or "filesystem".',
        },
        tool: {
          type: 'string',
          description: 'Original tool name inside that MCP service, without the MCP Claw service prefix.',
        },
        arguments: {
          type: 'object',
          description: 'Arguments to pass to the downstream MCP tool.',
          additionalProperties: true,
        },
      },
      required: ['server', 'tool'],
      additionalProperties: false,
    },
  },
  {
    name: prefixToolName(GATEWAY_SERVER_NAME, 'get_server_status'),
    title: 'Get Managed MCP Server Status',
    description: 'Get status and available tools for one MCP server managed by MCP Claw.',
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Managed server name.',
        },
      },
      required: ['server'],
      additionalProperties: false,
    },
  },
  {
    name: prefixToolName(GATEWAY_SERVER_NAME, 'search'),
    title: 'Search Managed MCP Servers And Tools',
    description: 'Search visible MCP servers and tools managed by MCP Claw by name or description.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive text to search for.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

function extractToken(req: IncomingMessage): string | null {
  // Check Authorization: Bearer <token>
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  // Check ?token=<token> query parameter
  if (req.url) {
    const q = req.url.indexOf('?');
    if (q !== -1) {
      const params = new URLSearchParams(req.url.slice(q));
      const token = params.get('token');
      if (token) return token.trim();
    }
  }

  return null;
}

export class ProxyServer {
  private httpServer: HttpServer | null = null;
  private port: number;
  private toolRouter: ToolRouter;
  private childManagers: Map<string, ChildManager> = new Map();
  private toolListCacheByAgent: Map<string, MCPTool[]> = new Map();
  private cacheVersion: number = 0;
  private agents: Map<string, AgentConfig> = new Map();
  private currentRequestAgentId: string | null = null;
  private logCallbacks: Array<(entry: AccessLogEntry) => void> = [];
  private accessLogBuffer: AccessLogEntry[] = [];
  private readonly MAX_LOG_BUFFER = 1000;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
    this.toolRouter = new ToolRouter();
  }

  getPort(): number {
    return this.port;
  }

  onAccessLog(callback: (entry: AccessLogEntry) => void): void {
    this.logCallbacks.push(callback);
  }

  getAccessLogs(): AccessLogEntry[] {
    return [...this.accessLogBuffer];
  }

  private emitLog(entry: AccessLogEntry): void {
    this.accessLogBuffer.push(entry);
    if (this.accessLogBuffer.length > this.MAX_LOG_BUFFER) {
      this.accessLogBuffer = this.accessLogBuffer.slice(-this.MAX_LOG_BUFFER);
    }
    for (const cb of this.logCallbacks) {
      try { cb(entry); } catch { /* ignore */ }
    }
  }

  setAgents(agents: AgentConfig[]): void {
    this.agents.clear();
    for (const a of agents) {
      this.agents.set(a.id, a);
    }
  }

  private findAgentByToken(token: string): AgentConfig | undefined {
    for (const a of this.agents.values()) {
      if (a.token === token) return a;
    }
    return undefined;
  }

  registerChildManager(cm: ChildManager): void {
    this.childManagers.set(cm.getId(), cm);

    cm.on('tools-updated', (serverId: string, tools: MCPTool[]) => {
      this.toolRouter.setServerTools(serverId, cm.getName(), tools);
      this.invalidateCache();
    });

    cm.on('state-changed', () => {
      this.invalidateCache();
    });

    const cachedTools = cm.getCachedTools();
    if (cachedTools.length > 0) {
      this.toolRouter.setServerTools(cm.getId(), cm.getName(), cachedTools);
      this.invalidateCache();
    }
  }

  unregisterChildManager(id: string): void {
    this.childManagers.delete(id);
    this.toolRouter.removeServer(id);
    this.invalidateCache();
  }

  invalidateCache(): void {
    this.cacheVersion++;
    this.toolListCacheByAgent.clear();
  }

  async getTools(): Promise<MCPTool[]> {
    if (!this.currentRequestAgentId) {
      return [];
    }

    return this.getToolsForAgent(this.currentRequestAgentId);
  }

  private async getToolsForAgent(agentId: string): Promise<MCPTool[]> {
    const cached = this.toolListCacheByAgent.get(agentId);
    if (cached) {
      return cached;
    }

    const allowedIds = new Set<string>();
    for (const cm of this.childManagers.values()) {
      if (this.shouldExposeServer(cm, agentId)) {
        allowedIds.add(cm.getId());
      }
    }

    const tools = [...GATEWAY_TOOLS, ...this.toolRouter.getAggregatedTools(allowedIds)];
    this.toolListCacheByAgent.set(agentId, tools);
    return tools;
  }

  private getVisibleChildManagers(agentId: string): ChildManager[] {
    const visible: ChildManager[] = [];
    for (const cm of this.childManagers.values()) {
      if (this.shouldExposeServer(cm, agentId)) {
        visible.push(cm);
      }
    }
    return visible;
  }

  private getGatewayToolRows(agentId: string, serverFilter?: string): Array<{
    server: string;
    tool: string;
    exposedName: string;
    title?: string;
    callViaGateway: {
      tool: string;
      arguments: {
        server: string;
        tool: string;
        arguments: Record<string, unknown>;
      };
    };
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    const rows: Array<{
      server: string;
      tool: string;
      exposedName: string;
      title?: string;
      callViaGateway: {
        tool: string;
        arguments: {
          server: string;
          tool: string;
          arguments: Record<string, unknown>;
        };
      };
      description: string;
      inputSchema: Record<string, unknown>;
    }> = [];
    const filter = serverFilter?.trim();

    for (const cm of this.getVisibleChildManagers(agentId)) {
      const serverName = cm.getName();
      if (filter && serverName !== filter) continue;

      const tools = cm.getCachedTools();
      for (const tool of tools) {
        rows.push({
          server: serverName,
          tool: tool.name,
          exposedName: prefixToolName(serverName, tool.name),
          title: tool.title,
          callViaGateway: {
            tool: prefixToolName(GATEWAY_SERVER_NAME, 'call_tool'),
            arguments: {
              server: serverName,
              tool: tool.name,
              arguments: {},
            },
          },
          description: tool.description || '',
          inputSchema: tool.inputSchema,
        });
      }
    }

    return rows;
  }

  private async callGatewayTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }> {
    if (!this.currentRequestAgentId) {
      throw new Error('A valid agent token is required to inspect MCP Claw gateway state.');
    }

    return this.callGatewayToolForAgent(this.currentRequestAgentId, name, args);
  }

  private async callGatewayToolForAgent(agentId: string, name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }> {
    switch (name) {
      case 'list_servers': {
        const servers = await Promise.all(Array.from(this.childManagers.values()).map(async (cm) => {
          const state = cm.getState();
          const visible = this.shouldExposeServer(cm, agentId);
          const tools = visible ? cm.getCachedTools() : [];
          return {
            id: cm.getId(),
            name: cm.getName(),
            description: state.description || '',
            transport: state.transport,
            enabled: state.enabled,
            autoStart: state.autoStart,
            status: state.status,
            retryCount: state.retryCount,
            error: state.error || null,
            exposedToCurrentAgent: state.exposedTo.includes(agentId),
            visibleToCurrentAgent: visible,
            toolCount: tools.length,
          };
        }));

        return this.textResult({
          gateway: GATEWAY_SERVER_NAME,
          agent: this.getAgentLabel(agentId),
          servers,
        });
      }

      case 'list_tools': {
        const server = typeof args.server === 'string' ? args.server : undefined;
        return this.textResult({
          gateway: GATEWAY_SERVER_NAME,
          agent: this.getAgentLabel(agentId),
          usage: 'When a user names an MCP service, choose a row for that service and call either exposedName directly or mcp_claw__call_tool with { server, tool, arguments }.',
          tools: this.getGatewayToolRows(agentId, server),
        });
      }

      case 'call_tool': {
        const serverName = typeof args.server === 'string' ? args.server.trim() : '';
        const toolName = typeof args.tool === 'string' ? args.tool.trim() : '';
        const toolArgs = args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)
          ? args.arguments as Record<string, unknown>
          : {};

        if (!serverName) {
          throw new Error('Argument "server" is required.');
        }
        if (!toolName) {
          throw new Error('Argument "tool" is required.');
        }

        const cm = this.findChildByName(serverName, agentId);
        if (!cm) {
          throw new Error(`Unknown or hidden managed MCP server "${serverName}".`);
        }
        if (cm.getState().status !== 'READY') {
          throw new Error(`Server "${serverName}" is not ready (status: ${cm.getState().status}).`);
        }

        const tools = cm.getCachedTools();
        if (!tools.some(tool => tool.name === toolName)) {
          const available = tools.map(tool => tool.name).join(', ') || '(none)';
          throw new Error(`Unknown tool "${toolName}" on MCP server "${serverName}". Available tools: ${available}`);
        }

        return cm.callTool(toolName, toolArgs);
      }

      case 'get_server_status': {
        if (typeof args.server !== 'string' || !args.server.trim()) {
          throw new Error('Argument "server" is required.');
        }

        const serverName = args.server.trim();
        const cm = Array.from(this.childManagers.values()).find(child => child.getName() === serverName);
        if (!cm) {
          throw new Error(`Unknown managed MCP server "${serverName}".`);
        }

        const state = cm.getState();
        const visible = this.shouldExposeServer(cm, agentId);
        return this.textResult({
          id: cm.getId(),
          name: cm.getName(),
          description: state.description || '',
          transport: state.transport,
          enabled: state.enabled,
          autoStart: state.autoStart,
          status: state.status,
          retryCount: state.retryCount,
          error: state.error || null,
          exposedToCurrentAgent: state.exposedTo.includes(agentId),
          visibleToCurrentAgent: visible,
          tools: visible ? this.getGatewayToolRows(agentId, serverName) : [],
        });
      }

      case 'search': {
        if (typeof args.query !== 'string' || !args.query.trim()) {
          throw new Error('Argument "query" is required.');
        }

        const query = args.query.trim().toLowerCase();
        const servers = this.getVisibleChildManagers(agentId)
          .map(cm => cm.getState())
          .filter(state =>
            state.name.toLowerCase().includes(query) ||
            (state.description || '').toLowerCase().includes(query)
          )
          .map(state => ({
            id: state.id,
            name: state.name,
            description: state.description || '',
            transport: state.transport,
            status: state.status,
          }));

        const tools = this.getGatewayToolRows(agentId).filter(tool =>
          tool.server.toLowerCase().includes(query) ||
          tool.tool.toLowerCase().includes(query) ||
          tool.exposedName.toLowerCase().includes(query) ||
          tool.description.toLowerCase().includes(query)
        );

        return this.textResult({
          gateway: GATEWAY_SERVER_NAME,
          query: args.query,
          servers,
          tools,
        });
      }

      default:
        throw new Error(`Unknown MCP Claw gateway tool "${name}".`);
    }
  }

  private textResult(payload: unknown): { content: Array<{ type: string; text: string }> } {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private shouldExposeServer(cm: ChildManager, agentId: string | null = this.currentRequestAgentId): boolean {
    const state = cm.getState();
    if (!state.enabled || state.status !== 'READY') return false;
    if (!agentId) return false;
    return state.exposedTo.includes(agentId);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer(async (req, res) => {
        if (req.url === '/mcp' || req.url?.startsWith('/mcp')) {
          try {
            if (req.method !== 'POST') {
              res.writeHead(405, {
                'Allow': 'POST',
                'Content-Type': 'application/json',
              });
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                error: {
                  code: -32000,
                  message: 'Method not allowed.',
                },
                id: null,
              }));
              return;
            }

            const token = extractToken(req);
            const agent = token ? this.findAgentByToken(token) : undefined;

            if (!agent) {
              this.emitLog({
                timestamp: new Date().toISOString(),
                agentName: null,
                agentId: null,
                action: 'auth',
                detail: token ? 'Rejected invalid token' : 'Rejected missing token',
              });
              res.writeHead(401, {
                'Content-Type': 'application/json',
                'WWW-Authenticate': 'Bearer realm="mcp-claw"',
              });
              res.end(JSON.stringify({
                error: 'unauthorized',
                message: 'A valid MCP Claw agent token is required.',
              }));
              return;
            }

            const requestServer = this.createRequestServer(agent.id);
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
            });

            let closed = false;
            const closeRequest = async () => {
              if (closed) return;
              closed = true;
              await transport.close().catch(() => undefined);
              await requestServer.close().catch(() => undefined);
            };

            res.on('close', () => {
              void closeRequest();
            });

            await requestServer.connect(transport);
            await transport.handleRequest(req, res);
            if (res.writableEnded) {
              await closeRequest();
            }
          } catch (err: any) {
            console.error('[Proxy] handleRequest error:', err?.message || err);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end('Internal Server Error');
            }
          }
          return;
        }

        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      });

      this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          reject(err);
        }
      });

      this.httpServer.listen(this.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
  }

  private getAgentLabel(agentId: string | null = this.currentRequestAgentId): string {
    if (!agentId) return '未认证';
    const agent = this.agents.get(agentId);
    return agent ? `${agent.name}` : '未知';
  }

  private createRequestServer(agentId: string): Server {
    const server = new Server(
      { name: 'mcp-claw', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    this.registerHandlers(server, agentId);
    return server;
  }

  private registerHandlers(server: Server, agentId: string): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.getToolsForAgent(agentId);
      const agentLabel = this.getAgentLabel(agentId);
      this.emitLog({
        timestamp: new Date().toISOString(),
        agentName: agentLabel,
        agentId,
        action: 'tools/list',
        detail: `返回 ${tools.length} 个工具`,
      });
      return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const parsed = parseToolName(name);
      const agentLabel = this.getAgentLabel(agentId);

      if (parsed?.serverName === GATEWAY_SERVER_NAME) {
        try {
          const result = await this.callGatewayToolForAgent(agentId, parsed.toolName, args || {});
          this.emitLog({
            timestamp: new Date().toISOString(),
            agentName: agentLabel,
            agentId,
            action: 'tools/call',
            detail: `成功 - ${GATEWAY_SERVER_NAME}__${parsed.toolName}`,
          });
          return result;
        } catch (err: any) {
          this.emitLog({
            timestamp: new Date().toISOString(),
            agentName: agentLabel,
            agentId,
            action: 'tools/call',
            detail: `失败 - ${GATEWAY_SERVER_NAME}__${parsed.toolName}: ${err?.message || err}`,
          });
          throw err;
        }
      }

      if (!parsed) {
        this.emitLog({
          timestamp: new Date().toISOString(),
          agentName: agentLabel,
          agentId,
          action: 'tools/call',
          detail: `失败 — 未知工具: "${name}"`,
        });
        throw new Error(
          `Unknown tool: "${name}". Tools must be prefixed with server name, e.g. "myserver__toolname". Available tools: ${(await this.getToolsForAgent(agentId)).map(t => t.name).join(', ') || '(none)'}`
        );
      }

      const cm = this.findChildByName(parsed.serverName, agentId);
      if (!cm) {
        this.emitLog({
          timestamp: new Date().toISOString(),
          agentName: agentLabel,
          agentId,
          action: 'tools/call',
          detail: `失败 — 未知服务: "${parsed.serverName}"`,
        });
        throw new Error(`Unknown server "${parsed.serverName}". No MCP server with that name is configured.`);
      }

      if (cm.getState().status !== 'READY') {
        this.emitLog({
          timestamp: new Date().toISOString(),
          agentName: agentLabel,
          agentId,
          action: 'tools/call',
          detail: `失败 — 服务 "${parsed.serverName}" 未就绪`,
        });
        throw new Error(`Server "${parsed.serverName}" is not ready (status: ${cm.getState().status}).`);
      }

      try {
        const result = await cm.callTool(parsed.toolName, args || {});
        this.emitLog({
          timestamp: new Date().toISOString(),
          agentName: agentLabel,
          agentId,
          action: 'tools/call',
          detail: `成功 — ${parsed.serverName}__${parsed.toolName}`,
        });
        return result;
      } catch (err: any) {
        this.emitLog({
          timestamp: new Date().toISOString(),
          agentName: agentLabel,
          agentId,
          action: 'tools/call',
          detail: `失败 — ${parsed.serverName}__${parsed.toolName}: ${err?.message || err}`,
        });
        throw err;
      }
    });
  }

  private findChildByName(name: string, agentId: string | null = this.currentRequestAgentId): ChildManager | undefined {
    for (const cm of this.childManagers.values()) {
      if (cm.getName() === name && this.shouldExposeServer(cm, agentId)) return cm;
    }
    return undefined;
  }

  async notifyToolsChanged(): Promise<void> {
    this.invalidateCache();
  }
}
