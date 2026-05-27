interface AgentConfig {
  id: string;
  name: string;
  token: string;
}

interface ServerState {
  id: string;
  name: string;
  description?: string;
  transport: 'stdio' | 'streamable-http';
  enabled: boolean;
  autoStart: boolean;
  exposedTo: string[];
  status: 'CONNECTING' | 'READY' | 'ERROR';
  error?: string;
  retryCount: number;
  configLabel?: string;
}

interface MCPTool {
  name: string;
  description?: string;
  title?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  execution?: Record<string, unknown>;
}

interface ServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: 'stdio' | 'streamable-http';
  enabled: boolean;
  exposedTo: string[];
  config: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string | null;
    url?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface AddServerInput {
  name: string;
  description?: string;
  transport: 'stdio' | 'streamable-http';
  enabled: boolean;
  config: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string | null;
    url?: string;
  };
}

interface EndpointInfo {
  url: string;
  port: number;
  agents: AgentConfig[];
}

interface AccessLogEntry {
  timestamp: string;
  agentName: string | null;
  agentId: string | null;
  action: string;
  detail: string;
}

interface ServerTestResult {
  ok: boolean;
  status: 'CONNECTING' | 'READY' | 'ERROR';
  toolCount: number;
  durationMs: number;
  error?: string;
}

interface StorageSettings {
  configFile: string;
  logsDir: string;
  settingsFile: string;
}

interface UpdateStorageSettingsInput {
  configFile: string;
  logsDir: string;
}

interface MCPGatewayAPI {
  getServers(): Promise<ServerState[]>;
  toggleServer(id: string, enabled: boolean): Promise<{ success?: boolean; error?: string }>;
  addServer(config: AddServerInput): Promise<{ success?: boolean; server?: ServerConfig; error?: string }>;
  updateServer(id: string, input: AddServerInput): Promise<{ success?: boolean; server?: ServerConfig; error?: string }>;
  deleteServer(id: string): Promise<{ success?: boolean; error?: string }>;
  reconnectServer(id: string): Promise<{ success?: boolean; error?: string }>;
  testServer(id: string): Promise<ServerTestResult>;
  getEndpointInfo(): Promise<EndpointInfo>;
  setExposedTo(id: string, agentIds: string[]): Promise<{ success?: boolean; error?: string }>;
  setAutoStart(id: string, autoStart: boolean): Promise<{ success?: boolean; error?: string }>;
  getServerConfig(id: string): Promise<{ config?: ServerConfig; error?: string }>;
  getServerLog(name: string): Promise<{ content: string; error?: string | null }>;
  clearServerLog(name: string): Promise<{ success?: boolean; error?: string }>;
  getServerTools(id: string): Promise<{ tools: MCPTool[]; error?: string }>;
  getAgents(): Promise<AgentConfig[]>;
  addAgent(name: string): Promise<{ agent?: AgentConfig; error?: string }>;
  removeAgent(id: string): Promise<{ success?: boolean; error?: string }>;
  updateAgentName(id: string, name: string): Promise<{ agent?: AgentConfig; error?: string }>;
  updateAgentToken(id: string, token: string): Promise<{ agent?: AgentConfig; error?: string }>;
  getAccessLogs(): Promise<AccessLogEntry[]>;
  getStorageSettings(): Promise<StorageSettings>;
  selectConfigFile(): Promise<{ path?: string; canceled?: boolean; error?: string }>;
  selectLogsDir(): Promise<{ path?: string; canceled?: boolean; error?: string }>;
  updateStorageSettings(input: UpdateStorageSettingsInput): Promise<{ settings?: StorageSettings; error?: string }>;
  onAccessLog(callback: (entry: AccessLogEntry) => void): () => void;
  onStateChanged(callback: (state: ServerState) => void): () => void;
}

interface Window {
  mcpGateway: MCPGatewayAPI;
}
