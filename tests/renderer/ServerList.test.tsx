import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ServerList } from '../../src/renderer/components/ServerList';

const mockOnStateChanged = vi.fn().mockReturnValue(vi.fn());

function mockGateway(overrides: Partial<MCPGatewayAPI> = {}) {
  (global as any).window = {
    mcpGateway: {
      getServers: vi.fn().mockResolvedValue([]),
      toggleServer: vi.fn().mockResolvedValue({ success: true }),
      addServer: vi.fn().mockResolvedValue({ success: true }),
      deleteServer: vi.fn().mockResolvedValue({ success: true }),
      reconnectServer: vi.fn().mockResolvedValue({ success: true }),
      testServer: vi.fn().mockResolvedValue({ ok: true, status: 'READY', toolCount: 0, durationMs: 0 }),
      getEndpointInfo: vi.fn().mockResolvedValue({ url: 'http://localhost:18721/mcp', port: 18721 }),
      onStateChanged: mockOnStateChanged,
      ...overrides,
    },
    alert: vi.fn(),
    confirm: vi.fn().mockReturnValue(true),
  };
}

const sampleServers: ServerState[] = [
  { id: '1', name: 'github', transport: 'stdio', enabled: true, status: 'READY', retryCount: 0 },
  { id: '2', name: 'filesystem', transport: 'stdio', enabled: true, status: 'ERROR', error: 'crash', retryCount: 3 },
  { id: '3', name: 'slow-server', transport: 'stdio', enabled: true, status: 'CONNECTING', retryCount: 0 },
  { id: '4', name: 'disabled-srv', transport: 'stdio', enabled: false, status: 'READY', retryCount: 0 },
];

describe('ServerList', () => {
  beforeEach(() => {
    mockGateway();
  });

  it('renders empty state when no servers', async () => {
    (window.mcpGateway.getServers as any).mockResolvedValue([]);

    await act(async () => {
      render(<ServerList onAdd={vi.fn()} onEdit={vi.fn()} onDetail={vi.fn()} />);
    });

    expect(screen.getByText(/还没有 MCP 服务器/)).toBeDefined();
  });

  it('renders multiple rows with status labels', async () => {
    (window.mcpGateway.getServers as any).mockResolvedValue(sampleServers);

    await act(async () => {
      render(<ServerList onAdd={vi.fn()} onEdit={vi.fn()} onDetail={vi.fn()} />);
    });

    expect(screen.getByText('github')).toBeDefined();
    expect(screen.getByText('filesystem')).toBeDefined();
    expect(screen.getByText('在线')).toBeDefined();
    expect(screen.getByText('异常')).toBeDefined();
    expect(screen.getByText('连接中')).toBeDefined();
    expect(screen.getByText('已停止')).toBeDefined();
  });

  it('shows error on load failure', async () => {
    (window.mcpGateway.getServers as any).mockRejectedValue(new Error('Connection refused'));

    await act(async () => {
      render(<ServerList onAdd={vi.fn()} onEdit={vi.fn()} onDetail={vi.fn()} />);
    });

    expect(screen.getByText(/Connection refused/)).toBeDefined();
  });

  it('add button triggers onAdd callback', async () => {
    const onAdd = vi.fn();
    (window.mcpGateway.getServers as any).mockResolvedValue(sampleServers);

    await act(async () => {
      render(<ServerList onAdd={onAdd} onEdit={vi.fn()} onDetail={vi.fn()} />);
    });

    fireEvent.click(screen.getByText('+ 添加服务'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('edit button triggers onEdit with correct id', async () => {
    const onEdit = vi.fn();
    (window.mcpGateway.getServers as any).mockResolvedValue(sampleServers);

    await act(async () => {
      render(<ServerList onAdd={vi.fn()} onEdit={onEdit} onDetail={vi.fn()} />);
    });

    const editBtns = screen.getAllByText('编辑');
    fireEvent.click(editBtns[0]);
    expect(onEdit).toHaveBeenCalledWith('1');
  });

  it('shows reconnect button for ERROR servers', async () => {
    (window.mcpGateway.getServers as any).mockResolvedValue(sampleServers);

    await act(async () => {
      render(<ServerList onAdd={vi.fn()} onEdit={vi.fn()} onDetail={vi.fn()} />);
    });

    expect(screen.getByText('重连')).toBeDefined();
  });
});
