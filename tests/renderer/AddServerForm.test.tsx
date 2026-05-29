import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { AddServerForm } from '../../src/renderer/components/AddServerForm';

function mockGateway(overrides: Partial<MCPGatewayAPI> = {}) {
  window.mcpGateway = {
    getServers: vi.fn().mockResolvedValue([]),
    toggleServer: vi.fn().mockResolvedValue({ success: true }),
    addServer: vi.fn().mockResolvedValue({ success: true }),
    deleteServer: vi.fn().mockResolvedValue({ success: true }),
    reconnectServer: vi.fn().mockResolvedValue({ success: true }),
    testServer: vi.fn().mockResolvedValue({ ok: true, status: 'READY', toolCount: 0, durationMs: 0 }),
    getEndpointInfo: vi.fn().mockResolvedValue({ url: 'http://localhost:18721/mcp', port: 18721 }),
    onStateChanged: vi.fn().mockReturnValue(vi.fn()),
    ...overrides,
  };
  window.alert = vi.fn();
  window.confirm = vi.fn().mockReturnValue(true);
}

describe('AddServerForm', () => {
  beforeEach(() => {
    mockGateway();
  });

  it('rejects submit with empty name', () => {
    const onDone = vi.fn();
    render(<AddServerForm editingId={null} onDone={onDone} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('添加服务'));
    expect(screen.getByText('服务名称不能为空')).toBeDefined();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('renders form fields for stdio config', () => {
    render(<AddServerForm editingId={null} onDone={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText('服务名称 *')).toBeDefined();
    expect(screen.getByLabelText('命令 *')).toBeDefined();
    expect(screen.getByLabelText('参数')).toBeDefined();
    expect(screen.getByText('添加服务')).toBeDefined();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<AddServerForm editingId={null} onDone={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('rejects name containing __', () => {
    const onDone = vi.fn();
    render(<AddServerForm editingId={null} onDone={onDone} onCancel={vi.fn()} />);

    // Fill with bad name
    const nameInput = screen.getByLabelText('服务名称 *');
    fireEvent.change(nameInput, { target: { value: 'bad__name' } });

    fireEvent.click(screen.getByText('添加服务'));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows env var and arg add buttons', () => {
    render(<AddServerForm editingId={null} onDone={vi.fn()} onCancel={vi.fn()} />);

    const addButtons = screen.getAllByText('+ 添加');
    expect(addButtons.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('无需额外环境变量')).toBeDefined();
  });

  it('parses mcpServers JSON into form fields and submit input', async () => {
    const addServer = vi.fn().mockResolvedValue({ success: true });
    const onDone = vi.fn();
    mockGateway({ addServer });
    const { container } = render(<AddServerForm editingId={null} onDone={onDone} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('JSON 配置'));
    await waitFor(
      () => expect(container.querySelector('#json-config')).toBeDefined(),
      { container }
    );
    const textarea = container.querySelector('#json-config') as HTMLTextAreaElement;
    fireEvent.input(textarea, {
      target: {
        value: JSON.stringify({
          mcpServers: {
            '12306-mcp': {
              args: ['-y', '12306-mcp'],
              command: 'npx',
            },
          },
        }),
      },
    });

    await waitFor(
      () => expect(screen.getByLabelText('服务名称 *')).toHaveValue('12306-mcp'),
      { container }
    );
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(addServer).toHaveBeenCalledTimes(1));
    expect(addServer).toHaveBeenCalledWith({
      name: '12306-mcp',
      description: '',
      transport: 'stdio',
      enabled: true,
      autoStart: true,
      config: {
        command: 'npx',
        args: ['-y', '12306-mcp'],
        env: {},
        cwd: null,
      },
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
