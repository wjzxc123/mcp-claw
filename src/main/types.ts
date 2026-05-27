// Shared types between main and renderer processes

export type TransportType = 'stdio' | 'streamable-http';

export type ServerStatus = 'CONNECTING' | 'READY' | 'ERROR';

export interface StdioConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
}

export interface HttpConfig {
  url: string;
}

export type ServerTransportConfig = StdioConfig | HttpConfig;

export interface AgentConfig {
  id: string;
  name: string;
  token: string;
}

export interface ServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: TransportType;
  enabled: boolean;
  autoStart: boolean;
  exposedTo: string[];
  config: ServerTransportConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ServersFile {
  version: number;
  agents: AgentConfig[];
  servers: ServerConfig[];
}

export interface ServerState {
  id: string;
  name: string;
  description?: string;
  transport: TransportType;
  enabled: boolean;
  autoStart: boolean;
  exposedTo: string[];
  status: ServerStatus;
  error?: string;
  retryCount: number;
  /** Display label for the transport config (command line or URL) */
  configLabel?: string;
}

export interface EndpointInfo {
  url: string;
  port: number;
  agents: AgentConfig[];
}

export interface AddServerInput {
  name: string;
  description?: string;
  transport: TransportType;
  enabled: boolean;
  autoStart?: boolean;
  config: ServerTransportConfig;
}

export interface MCPTool {
  name: string;
  description?: string;
  title?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  execution?: Record<string, unknown>;
}

export interface AccessLogEntry {
  timestamp: string;
  agentName: string | null;
  agentId: string | null;
  action: string;
  detail: string;
}

export interface ServerTestResult {
  ok: boolean;
  status: ServerStatus;
  toolCount: number;
  durationMs: number;
  error?: string;
}

export interface StorageSettings {
  configFile: string;
  logsDir: string;
  settingsFile: string;
}

export interface UpdateStorageSettingsInput {
  configFile: string;
  logsDir: string;
}

export const DEFAULT_PORT = 18721;
export const HEALTH_CHECK_INTERVAL = 30_000;
export const STARTUP_TIMEOUT = 10_000;
export const MAX_RETRIES = 3;
export const RETRY_DELAYS = [1_000, 2_000, 4_000];
export const CONFIG_PATH = '~/.mcp-gateway/servers.json';
export const LOGS_DIR = '~/.mcp-gateway/logs';
export const GATEWAY_SERVER_NAME = 'mcp_claw';
