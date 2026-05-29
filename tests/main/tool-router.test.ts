import { describe, it, expect } from 'vitest';
import { ToolRouter, aggregateTools, prefixToolName, parseToolName } from '../../src/main/tool-router';
import { MCPTool } from '../../src/main/types';

function makeTool(name: string, desc: string): MCPTool {
  return {
    name,
    description: desc,
    inputSchema: { type: 'object', properties: {} },
  };
}

describe('ToolRouter', () => {
  describe('aggregateTools', () => {
    it('prefixes tools without collision', () => {
      const servers = [
        {
          serverId: '1',
          serverName: 'github',
          tools: [makeTool('create_issue', 'Create an issue')],
        },
        {
          serverId: '2',
          serverName: 'filesystem',
          tools: [makeTool('read_file', 'Read a file')],
        },
      ];

      const result = aggregateTools(servers);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('github__create_issue');
      expect(result[1].name).toBe('filesystem__read_file');
      expect(result[0]).toMatchObject({
        title: 'github / create_issue',
        description: 'MCP service "github", original tool "create_issue". Create an issue',
        annotations: {
          mcpClaw: {
            serverId: '1',
            serverName: 'github',
            originalName: 'create_issue',
            exposedName: 'github__create_issue',
          },
        },
      });
    });

    it('returns empty array for zero clients', () => {
      expect(aggregateTools([])).toEqual([]);
    });

    it('handles serverName containing __ correctly', () => {
      const servers = [
        {
          serverId: '1',
          serverName: 'my__server',
          tools: [makeTool('do_stuff', 'Stuff')],
        },
      ];

      const result = aggregateTools(servers);
      expect(result[0].name).toBe('my__server__do_stuff');
    });
  });

  describe('parseToolName', () => {
    it('parses standard namespaced name', () => {
      const parsed = parseToolName('github__create_issue');
      expect(parsed).toEqual({ serverName: 'github', toolName: 'create_issue' });
    });

    it('returns null for name without separator', () => {
      expect(parseToolName('create_issue')).toBeNull();
    });

    it('handles toolName containing __', () => {
      const parsed = parseToolName('github__create__issue');
      expect(parsed).toEqual({ serverName: 'github', toolName: 'create__issue' });
    });

    it('returns null for empty serverName', () => {
      expect(parseToolName('__tool')).toBeNull();
    });
  });

  describe('prefixToolName', () => {
    it('creates correct prefixed name', () => {
      expect(prefixToolName('github', 'create_issue')).toBe('github__create_issue');
    });
  });

  describe('ToolRouter class', () => {
    it('routes handles tool name without namespace prefix correctly', () => {
      const router = new ToolRouter();
      router.setServerTools('1', 'github', [makeTool('do_it', '')]);
      expect(router.findServer('do_it')).toBeNull();
    });

    it('routes tool to correct server', () => {
      const router = new ToolRouter();
      router.setServerTools('1', 'github', [makeTool('do_it', '')]);
      router.setServerTools('2', 'filesystem', [makeTool('read', '')]);

      const result = router.findServer('github__do_it');
      expect(result).not.toBeNull();
      expect(result!.serverId).toBe('1');
    });

    it('returns null for unknown namespace', () => {
      const router = new ToolRouter();
      expect(router.findServer('unknown__tool')).toBeNull();
      expect(router.isValidNamespace('unknown__tool')).toBe(false);
    });

    it('isValidNamespace returns true for known namespace', () => {
      const router = new ToolRouter();
      router.setServerTools('1', 'test', [makeTool('x', '')]);
      expect(router.isValidNamespace('test__x')).toBe(true);
    });

    it('removeServer clears tools', () => {
      const router = new ToolRouter();
      router.setServerTools('1', 'test', [makeTool('x', '')]);
      router.removeServer('1');
      expect(router.getAggregatedTools()).toHaveLength(0);
    });

    it('getAggregatedTools merges all servers', () => {
      const router = new ToolRouter();
      router.setServerTools('1', 'a', [makeTool('t1', ''), makeTool('t2', '')]);
      router.setServerTools('2', 'b', [makeTool('t3', '')]);
      const tools = router.getAggregatedTools();
      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.name).sort()).toEqual(['a__t1', 'a__t2', 'b__t3']);
    });
  });
});
