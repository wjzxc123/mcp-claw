import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { EndpointInfo } from '../../src/renderer/components/EndpointInfo';

function mockGateway(overrides: Partial<MCPGatewayAPI> = {}) {
  (global as any).window = {
    mcpGateway: {
      getServers: vi.fn().mockResolvedValue([]),
      toggleServer: vi.fn().mockResolvedValue({ success: true }),
      addServer: vi.fn().mockResolvedValue({ success: true }),
      deleteServer: vi.fn().mockResolvedValue({ success: true }),
      reconnectServer: vi.fn().mockResolvedValue({ success: true }),
      testServer: vi.fn().mockResolvedValue({ ok: true, status: 'READY', toolCount: 0, durationMs: 0 }),
      getEndpointInfo: vi.fn().mockResolvedValue({
        url: 'http://localhost:18721/mcp',
        port: 18721,
      }),
      getAgents: vi.fn().mockResolvedValue([
        { id: 'agent-1', name: 'Claude Code', token: 'claude-token' },
        { id: 'agent-2', name: 'Codex', token: 'codex-token' },
        { id: 'agent-3', name: 'Cursor', token: 'cursor-token' },
      ]),
      addAgent: vi.fn().mockResolvedValue({ agent: { id: 'agent-3', name: 'Cursor', token: 'cursor-token' } }),
      removeAgent: vi.fn().mockResolvedValue({ success: true }),
      updateAgentName: vi.fn().mockResolvedValue({ agent: { id: 'agent-1', name: 'Claude Code', token: 'claude-token' } }),
      updateAgentToken: vi.fn().mockResolvedValue({ agent: { id: 'agent-1', name: 'Claude Code', token: 'new-token' } }),
      setExposedTo: vi.fn().mockResolvedValue({ success: true }),
      onStateChanged: vi.fn().mockReturnValue(vi.fn()),
      ...overrides,
    },
    alert: vi.fn(),
    confirm: vi.fn().mockReturnValue(true),
  };
}

Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

function openAgentConfig(name: string) {
  const card = screen.getByText(name).closest('.agent-card');
  expect(card).toBeTruthy();
  fireEvent.click(card!);
}

describe('EndpointInfo', () => {
  beforeEach(() => {
    mockGateway();
  });

  it('renders endpoint URL and copy button', async () => {
    await act(async () => {
      render(<EndpointInfo />);
    });

    expect(screen.getByText('http://localhost:18721/mcp')).toBeDefined();
  });

  it('renders configured agents', async () => {
    await act(async () => {
      render(<EndpointInfo />);
    });

    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Codex')).toBeDefined();
  });

  it('renders Claude Code config only for Claude agents', async () => {
    await act(async () => {
      render(<EndpointInfo />);
    });

    openAgentConfig('Claude Code');

    expect(await screen.findByText('Claude Code 全局配置')).toBeDefined();
    expect(screen.getByText('~/.claude.json')).toBeDefined();
    expect(screen.queryByText('~/.codex/config.toml')).toBeNull();
  });

  it('renders Codex config only for Codex agents', async () => {
    await act(async () => {
      render(<EndpointInfo />);
    });

    openAgentConfig('Codex');

    expect(await screen.findByText('Codex CLI 命令')).toBeDefined();
    expect(screen.getByText('Codex JSON 配置')).toBeDefined();
    expect(screen.getByText('~/.codex/config.toml')).toBeDefined();
    expect(screen.getByText(/codex mcp add mcp-claw/)).toBeDefined();
    expect(screen.getByText(/"type": "http"/)).toBeDefined();
    expect(screen.getByText(/"Authorization": "Bearer codex-token"/)).toBeDefined();
    expect(screen.getByText(/\[mcp_servers\.mcp_servers\]/)).toBeDefined();
    expect(screen.getByText(/headers = \{ Authorization = "Bearer codex-token" \}/)).toBeDefined();
    expect(screen.queryByText('~/.claude.json')).toBeNull();
  });

  it('renders generic config for non-Claude non-Codex agents', async () => {
    await act(async () => {
      render(<EndpointInfo />);
    });

    openAgentConfig('Cursor');

    expect(await screen.findByText('通用 Streamable HTTP 配置')).toBeDefined();
    expect(screen.queryByText('~/.claude.json')).toBeNull();
    expect(screen.queryByText('~/.codex/config.toml')).toBeNull();
  });

  it('copies URL to clipboard on button click', async () => {
    await act(async () => {
      render(<EndpointInfo />);
    });

    const copyBtns = screen.getAllByText('复制');
    fireEvent.click(copyBtns[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:18721/mcp');
  });
});
