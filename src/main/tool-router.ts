import { MCPTool } from './types';

export interface ToolsByServer {
  serverId: string;
  serverName: string;
  tools: MCPTool[];
}

/**
 * Namespace separator for tool naming: {serverName}__{toolName}
 */
export const NAMESPACE_SEPARATOR = '__';

/**
 * Prefix a tool name with server name for global uniqueness.
 */
export function prefixToolName(serverName: string, toolName: string): string {
  return `${serverName}${NAMESPACE_SEPARATOR}${toolName}`;
}

/**
 * Parse a namespaced tool name back to {serverName, toolName}.
 * Returns null if no valid namespace prefix found.
 */
export function parseToolName(namespacedName: string): { serverName: string; toolName: string } | null {
  const sepIndex = namespacedName.indexOf(NAMESPACE_SEPARATOR);
  if (sepIndex === -1) return null;

  const serverName = namespacedName.substring(0, sepIndex);
  const toolName = namespacedName.substring(sepIndex + NAMESPACE_SEPARATOR.length);

  // Both parts must be non-empty, and toolName must not start with __
  // (handles server names containing __ correctly)
  if (!serverName || !toolName) return null;

  return { serverName, toolName };
}

function describeAggregatedTool(serverName: string, tool: MCPTool): string {
  const ownership = `MCP service "${serverName}", original tool "${tool.name}".`;
  const originalDescription = (tool.description || '').trim();
  return originalDescription ? `${ownership} ${originalDescription}` : ownership;
}

/**
 * Aggregate tools from multiple servers, prefixing each tool with server name.
 */
export function aggregateTools(servers: ToolsByServer[]): MCPTool[] {
  const result: MCPTool[] = [];

  for (const server of servers) {
    for (const tool of server.tools) {
      const exposedName = prefixToolName(server.serverName, tool.name);
      result.push({
        ...tool,
        name: exposedName,
        title: tool.title ? `${server.serverName} / ${tool.title}` : `${server.serverName} / ${tool.name}`,
        description: describeAggregatedTool(server.serverName, tool),
        annotations: {
          ...(tool.annotations || {}),
          mcpClaw: {
            serverId: server.serverId,
            serverName: server.serverName,
            originalName: tool.name,
            exposedName,
          },
        },
        execution: {
          ...(tool.execution || {}),
          mcpClaw: {
            serverId: server.serverId,
            serverName: server.serverName,
            originalName: tool.name,
            exposedName,
          },
        },
      });
    }
  }

  return result;
}

/**
 * Router for resolving tool calls to the right server.
 */
export class ToolRouter {
  private servers: Map<string, ToolsByServer> = new Map();

  /**
   * Update the tool list for a server. Call when server tools change.
   */
  setServerTools(serverId: string, serverName: string, tools: MCPTool[]): void {
    this.servers.set(serverId, { serverId, serverName, tools });
  }

  /**
   * Remove a server from the routing table.
   */
  removeServer(serverId: string): void {
    this.servers.delete(serverId);
  }

  /**
   * Get aggregated tools from all registered servers, optionally filtered by server ID set.
   */
  getAggregatedTools(allowedServerIds?: Set<string>): MCPTool[] {
    let servers = Array.from(this.servers.values());
    if (allowedServerIds) {
      servers = servers.filter(s => allowedServerIds.has(s.serverId));
    }
    return aggregateTools(servers);
  }

  /**
   * Find which server handles a given namespaced tool name.
   */
  findServer(namespacedName: string): ToolsByServer | null {
    const parsed = parseToolName(namespacedName);
    if (!parsed) return null;

    for (const server of this.servers.values()) {
      if (server.serverName === parsed.serverName) {
        return server;
      }
    }

    return null;
  }

  /**
   * Check if a tool name has a valid namespace prefix pointing to a registered server.
   */
  isValidNamespace(namespacedName: string): boolean {
    return this.findServer(namespacedName) !== null;
  }

  /**
   * Get all registered servers.
   */
  getServers(): ToolsByServer[] {
    return Array.from(this.servers.values());
  }
}
