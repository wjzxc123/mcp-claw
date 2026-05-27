import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { Settings } from '../../src/renderer/components/Settings';

function mockGateway(overrides: Partial<MCPGatewayAPI> = {}) {
  (global as any).window = {
    mcpGateway: {
      getStorageSettings: vi.fn().mockResolvedValue({
        configFile: 'C:\\Users\\test\\.mcp-gateway\\servers.json',
        logsDir: 'C:\\Users\\test\\.mcp-gateway\\logs',
        settingsFile: 'C:\\Users\\test\\.mcp-gateway\\settings.json',
      }),
      updateStorageSettings: vi.fn().mockResolvedValue({
        settings: {
          configFile: 'D:\\mcp\\servers.json',
          logsDir: 'D:\\mcp\\logs',
          settingsFile: 'C:\\Users\\test\\.mcp-gateway\\settings.json',
        },
      }),
      selectConfigFile: vi.fn().mockResolvedValue({ path: 'D:\\mcp\\servers.json' }),
      selectLogsDir: vi.fn().mockResolvedValue({ path: 'D:\\mcp\\logs' }),
      ...overrides,
    } as any,
  };
}

describe('Settings', () => {
  beforeEach(() => {
    mockGateway();
  });

  it('renders storage paths and saves updates', async () => {
    await act(async () => {
      render(<Settings themeMode="system" onThemeChange={vi.fn()} />);
    });

    expect(await screen.findByText('配置')).toBeDefined();
    expect(screen.getByText('白天')).toBeDefined();
    expect(screen.getByText('暗夜')).toBeDefined();
    expect(screen.getByText('跟随系统')).toBeDefined();
    expect(screen.getByDisplayValue('C:\\Users\\test\\.mcp-gateway\\servers.json')).toBeDefined();
    expect(screen.getByDisplayValue('C:\\Users\\test\\.mcp-gateway\\logs')).toBeDefined();

    const selectButtons = screen.getAllByText('选择');

    await act(async () => {
      fireEvent.click(selectButtons[0]);
    });
    await act(async () => {
      fireEvent.click(selectButtons[1]);
    });

    expect(window.mcpGateway.selectConfigFile).toHaveBeenCalled();
    expect(window.mcpGateway.selectLogsDir).toHaveBeenCalled();
    expect(screen.getByDisplayValue('D:\\mcp\\servers.json')).toBeDefined();
    expect(screen.getByDisplayValue('D:\\mcp\\logs')).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByText('保存配置'));
    });

    expect(window.mcpGateway.updateStorageSettings).toHaveBeenCalledWith({
      configFile: 'D:\\mcp\\servers.json',
      logsDir: 'D:\\mcp\\logs',
    });
    expect(await screen.findByText(/配置已保存/)).toBeDefined();
  });

  it('changes theme mode', async () => {
    const onThemeChange = vi.fn();
    await act(async () => {
      render(<Settings themeMode="system" onThemeChange={onThemeChange} />);
    });

    fireEvent.click(await screen.findByText('白天'));

    expect(onThemeChange).toHaveBeenCalledWith('light');
  });
});
