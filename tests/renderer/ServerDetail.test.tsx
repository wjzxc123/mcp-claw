import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ServerDetail } from '../../src/renderer/components/ServerDetail';

const server: ServerState = {
  id: 'srv-1',
  name: 'github',
  description: '',
  transport: 'stdio',
  enabled: true,
  autoStart: true,
  exposedTo: [],
  status: 'READY',
  retryCount: 0,
  configLabel: 'npx -y github',
};

function mockGateway(overrides: Partial<MCPGatewayAPI> = {}) {
  (global as any).window = {
    mcpGateway: {
      getServers: vi.fn().mockResolvedValue([server]),
      toggleServer: vi.fn().mockResolvedValue({ success: true }),
      addServer: vi.fn().mockResolvedValue({ success: true }),
      updateServer: vi.fn().mockResolvedValue({ success: true }),
      deleteServer: vi.fn().mockResolvedValue({ success: true }),
      reconnectServer: vi.fn().mockResolvedValue({ success: true }),
      testServer: vi.fn().mockResolvedValue({
        ok: true,
        status: 'READY',
        toolCount: 2,
        durationMs: 12,
      }),
      getEndpointInfo: vi.fn().mockResolvedValue({ url: 'http://localhost:18721/mcp', port: 18721, agents: [] }),
      setExposedTo: vi.fn().mockResolvedValue({ success: true }),
      setAutoStart: vi.fn().mockResolvedValue({ success: true }),
      getServerConfig: vi.fn().mockResolvedValue({ config: server }),
      getServerLog: vi.fn().mockResolvedValue({ content: '' }),
      clearServerLog: vi.fn().mockResolvedValue({ success: true }),
      getServerTools: vi.fn().mockResolvedValue({
        tools: [
          { name: 'create_issue', description: 'Create issue', inputSchema: {} },
        ],
      }),
      getAgents: vi.fn().mockResolvedValue([]),
      addAgent: vi.fn().mockResolvedValue({}),
      removeAgent: vi.fn().mockResolvedValue({ success: true }),
      updateAgentName: vi.fn().mockResolvedValue({}),
      updateAgentToken: vi.fn().mockResolvedValue({}),
      getAccessLogs: vi.fn().mockResolvedValue([]),
      onAccessLog: vi.fn().mockReturnValue(vi.fn()),
      onStateChanged: vi.fn().mockReturnValue(vi.fn()),
      ...overrides,
    },
    alert: vi.fn(),
    confirm: vi.fn().mockReturnValue(true),
  };
}

describe('ServerDetail', () => {
  beforeEach(() => {
    mockGateway();
  });

  it('tests server tools and displays success result', async () => {
    await act(async () => {
      render(<ServerDetail serverId="srv-1" onBack={vi.fn()} onEdit={vi.fn()} onRefresh={vi.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('测试'));
    });

    expect(window.mcpGateway.testServer).toHaveBeenCalledWith('srv-1');
    expect(screen.getByText('Tools 测试通过: 2 个工具, 12ms')).toBeDefined();
  });

  it('tests a server and displays failure result', async () => {
    mockGateway({
      testServer: vi.fn().mockResolvedValue({
        ok: false,
        status: 'ERROR',
        toolCount: 0,
        durationMs: 4,
        error: 'tools/list failed',
      }),
    });

    await act(async () => {
      render(<ServerDetail serverId="srv-1" onBack={vi.fn()} onEdit={vi.fn()} onRefresh={vi.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('测试'));
    });

    expect(screen.getByText('测试失败: tools/list failed')).toBeDefined();
  });
});
