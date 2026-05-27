import { contextBridge, ipcRenderer } from 'electron';
import type { ServerState, ServerConfig, AddServerInput, EndpointInfo, AgentConfig, MCPTool, AccessLogEntry, ServerTestResult, StorageSettings, UpdateStorageSettingsInput } from '../main/types';

const mcpGateway = {
  getServers: (): Promise<ServerState[]> =>
    ipcRenderer.invoke('servers:list'),

  toggleServer: (id: string, enabled: boolean): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('server:toggle', { id, enabled }),

  addServer: (config: AddServerInput): Promise<{ success?: boolean; server?: ServerConfig; error?: string }> =>
    ipcRenderer.invoke('server:add', config),

  updateServer: (id: string, input: AddServerInput): Promise<{ success?: boolean; server?: ServerConfig; error?: string }> =>
    ipcRenderer.invoke('server:update', { id, input }),

  deleteServer: (id: string): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('server:delete', { id }),

  reconnectServer: (id: string): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('server:reconnect', { id }),

  testServer: (id: string): Promise<ServerTestResult> =>
    ipcRenderer.invoke('server:test', { id }),

  getEndpointInfo: (): Promise<EndpointInfo> =>
    ipcRenderer.invoke('endpoint:info'),

  setExposedTo: (id: string, agentIds: string[]): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('server:set-exposed-to', { id, agentIds }),

  setAutoStart: (id: string, autoStart: boolean): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('server:auto-start', { id, autoStart }),

  getServerLog: (name: string): Promise<{ content: string; error?: string | null }> =>
    ipcRenderer.invoke('server:get-log', { name }),

  clearServerLog: (name: string): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('server:clear-log', { name }),

  getServerConfig: (id: string): Promise<{ config?: ServerConfig; error?: string }> =>
    ipcRenderer.invoke('server:get-config', { id }),

  getServerTools: (id: string): Promise<{ tools: MCPTool[]; error?: string }> =>
    ipcRenderer.invoke('server:get-tools', { id }),

  getAgents: (): Promise<AgentConfig[]> =>
    ipcRenderer.invoke('agents:list'),

  addAgent: (name: string): Promise<{ agent?: AgentConfig; error?: string }> =>
    ipcRenderer.invoke('agent:add', { name }),

  removeAgent: (id: string): Promise<{ success?: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:remove', { id }),

  updateAgentName: (id: string, name: string): Promise<{ agent?: AgentConfig; error?: string }> =>
    ipcRenderer.invoke('agent:update-name', { id, name }),

  updateAgentToken: (id: string, token: string): Promise<{ agent?: AgentConfig; error?: string }> =>
    ipcRenderer.invoke('agent:update-token', { id, token }),

  getAccessLogs: (): Promise<AccessLogEntry[]> =>
    ipcRenderer.invoke('proxy:get-access-logs'),

  getStorageSettings: (): Promise<StorageSettings> =>
    ipcRenderer.invoke('settings:get-storage'),

  selectConfigFile: (): Promise<{ path?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:select-config-file'),

  selectLogsDir: (): Promise<{ path?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:select-logs-dir'),

  updateStorageSettings: (input: UpdateStorageSettingsInput): Promise<{ settings?: StorageSettings; error?: string }> =>
    ipcRenderer.invoke('settings:update-storage', input),

  onAccessLog: (callback: (entry: AccessLogEntry) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, entry: AccessLogEntry) => callback(entry);
    ipcRenderer.on('proxy:access-log', handler);
    return () => {
      ipcRenderer.removeListener('proxy:access-log', handler);
    };
  },

  onStateChanged: (callback: (state: ServerState) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: ServerState) => callback(state);
    ipcRenderer.on('servers:state-changed', handler);
    return () => {
      ipcRenderer.removeListener('servers:state-changed', handler);
    };
  },
};

contextBridge.exposeInMainWorld('mcpGateway', mcpGateway);
