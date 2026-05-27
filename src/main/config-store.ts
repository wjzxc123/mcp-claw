import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ServersFile,
  ServerConfig,
  AgentConfig,
  AddServerInput,
  StorageSettings,
  UpdateStorageSettingsInput,
} from './types';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.mcp-gateway');

function generateToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

function createDefaultAgents(): AgentConfig[] {
  return [
    { id: uuidv4(), name: 'Claude Code', token: generateToken() },
    { id: uuidv4(), name: 'Codex', token: generateToken() },
  ];
}

export class ConfigStore {
  private configDir: string;
  private settingsFile: string;
  private configFile: string;
  private logsDir: string;
  private servers: ServerConfig[] = [];
  private agents: AgentConfig[] = [];
  private version: number = 2;

  constructor(baseDir?: string) {
    this.configDir = baseDir || DEFAULT_CONFIG_DIR;
    this.settingsFile = path.join(this.configDir, 'settings.json');
    this.configFile = path.join(this.configDir, 'servers.json');
    this.logsDir = path.join(this.configDir, 'logs');
    this.loadSettings();
    this.ensureConfigDir();
  }

  private normalizePath(filePath: string): string {
    const expanded = filePath.startsWith('~')
      ? path.join(os.homedir(), filePath.slice(1))
      : filePath;
    return path.resolve(expanded);
  }

  private loadSettings(): void {
    if (!fs.existsSync(this.settingsFile)) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsFile, 'utf-8'));
      if (typeof parsed.configFile === 'string' && parsed.configFile.trim()) {
        this.configFile = this.normalizePath(parsed.configFile);
      }
      if (typeof parsed.logsDir === 'string' && parsed.logsDir.trim()) {
        this.logsDir = this.normalizePath(parsed.logsDir);
      }
    } catch {
      // Ignore invalid settings and keep defaults.
    }
  }

  private saveSettings(): void {
    const settingsDir = path.dirname(this.settingsFile);
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
    }
    const data: StorageSettings = this.getStorageSettings();
    fs.writeFileSync(this.settingsFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  private ensureConfigDir(): void {
    const configDir = path.dirname(this.configFile);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true, mode: 0o700 });
    }
  }

  getStorageSettings(): StorageSettings {
    return {
      configFile: this.configFile,
      logsDir: this.logsDir,
      settingsFile: this.settingsFile,
    };
  }

  updateStorageSettings(input: UpdateStorageSettingsInput): { settings?: StorageSettings; error?: string } {
    const rawConfigFile = input.configFile.trim();
    const rawLogsDir = input.logsDir.trim();

    if (!rawConfigFile) return { error: 'Config file path cannot be empty' };
    if (!rawLogsDir) return { error: 'Logs directory path cannot be empty' };

    const configFile = this.normalizePath(rawConfigFile);
    const logsDir = this.normalizePath(rawLogsDir);

    if (path.extname(configFile).toLowerCase() !== '.json') {
      return { error: 'Config file path must end with .json' };
    }

    try {
      const configDir = path.dirname(configFile);
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });

      this.configFile = configFile;
      this.logsDir = logsDir;
      this.saveSettings();
      this.save();

      return { settings: this.getStorageSettings() };
    } catch (err: any) {
      return { error: err?.message || String(err) };
    }
  }

  load(): { servers: ServerConfig[]; agents: AgentConfig[]; error?: string } {
    try {
      if (!fs.existsSync(this.configFile)) {
        this.agents = createDefaultAgents();
        this.servers = [];
        return { servers: [], agents: this.agents };
      }

      const raw = fs.readFileSync(this.configFile, 'utf-8');
      const parsed: any = JSON.parse(raw);

      // Validate version
      if (typeof parsed.version !== 'number' || !Array.isArray(parsed.servers)) {
        return { servers: [], agents: [], error: 'Invalid config format: missing version or servers array' };
      }

      // V1 → V2 migration
      if (parsed.version < 2) {
        this.agents = createDefaultAgents();
        const allAgentIds = this.agents.map(a => a.id);

        for (const s of parsed.servers) {
          if (s.exposed === true) {
            s.exposedTo = [...allAgentIds];
          } else {
            s.exposedTo = [];
          }
          delete s.exposed;
        }
        this.version = 2;
        this.servers = parsed.servers;
      } else {
        this.version = parsed.version;
        this.agents = Array.isArray(parsed.agents) ? parsed.agents : createDefaultAgents();
        this.servers = parsed.servers;
      }

      // Validate each server
      for (const s of this.servers) {
        const err = ConfigStore.validateServer(s);
        if (err) {
          return { servers: [], agents: [], error: `Invalid server config: ${err}` };
        }
      }

      // Normalize missing fields for backward compat
      for (const s of this.servers) {
        if (typeof s.description !== 'string') {
          s.description = '';
        }
        if (!Array.isArray(s.exposedTo)) {
          s.exposedTo = [];
        }
        if (typeof s.autoStart !== 'boolean') {
          s.autoStart = true;
        }
      }

      // Validate agents
      for (const a of this.agents) {
        if (!a.id || !a.name || !a.token) {
          this.agents = createDefaultAgents();
          break;
        }
      }

      return { servers: this.servers, agents: this.agents };
    } catch (e: any) {
      if (e instanceof SyntaxError) {
        return { servers: [], agents: [], error: 'Config file is corrupted (invalid JSON)' };
      }
      return { servers: [], agents: [], error: `Failed to load config: ${e.message}` };
    }
  }

  getAll(): ServerConfig[] {
    return [...this.servers];
  }

  getById(id: string): ServerConfig | undefined {
    return this.servers.find(s => s.id === id);
  }

  getAgents(): AgentConfig[] {
    return [...this.agents];
  }

  addAgent(name: string): { agent?: AgentConfig; error?: string } {
    if (!name.trim()) {
      return { error: 'Agent name cannot be empty' };
    }
    const agent: AgentConfig = {
      id: uuidv4(),
      name: name.trim(),
      token: generateToken(),
    };
    this.agents.push(agent);
    this.save();
    return { agent };
  }

  removeAgent(id: string): { error?: string } {
    const idx = this.agents.findIndex(a => a.id === id);
    if (idx === -1) return { error: 'Agent not found' };
    this.agents.splice(idx, 1);
    // Remove this agent from all servers' exposedTo
    for (const s of this.servers) {
      s.exposedTo = s.exposedTo.filter(aid => aid !== id);
    }
    this.save();
    return {};
  }

  updateAgentName(id: string, name: string): { agent?: AgentConfig; error?: string } {
    const agent = this.agents.find(a => a.id === id);
    if (!agent) return { error: 'Agent not found' };
    if (!name.trim()) return { error: 'Agent name cannot be empty' };
    agent.name = name.trim();
    this.save();
    return { agent };
  }

  updateAgentToken(id: string, token: string): { agent?: AgentConfig; error?: string } {
    const agent = this.agents.find(a => a.id === id);
    if (!agent) return { error: 'Agent not found' };
    if (!token.trim()) return { error: 'Token cannot be empty' };
    agent.token = token.trim();
    this.save();
    return { agent };
  }

  add(input: AddServerInput): { server?: ServerConfig; error?: string } {
    if (this.servers.some(s => s.name === input.name)) {
      return { error: `Server name "${input.name}" already exists` };
    }
    if (input.name.includes('__')) {
      return { error: 'Server name cannot contain "__"' };
    }

    const now = new Date().toISOString();
    const server: ServerConfig = {
      id: uuidv4(),
      name: input.name,
      description: input.description || '',
      transport: input.transport,
      enabled: input.enabled,
      autoStart: input.autoStart ?? true,
      exposedTo: [],
      config: input.config,
      createdAt: now,
      updatedAt: now,
    };

    this.servers.push(server);
    this.save();
    return { server };
  }

  update(id: string, input: Partial<AddServerInput>): { server?: ServerConfig; error?: string } {
    const index = this.servers.findIndex(s => s.id === id);
    if (index === -1) {
      return { error: `Server "${id}" not found` };
    }

    if (input.name && input.name !== this.servers[index].name) {
      if (this.servers.some(s => s.name === input.name)) {
        return { error: `Server name "${input.name}" already exists` };
      }
      if (input.name.includes('__')) {
        return { error: 'Server name cannot contain "__"' };
      }
    }

    this.servers[index] = {
      ...this.servers[index],
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.transport !== undefined && { transport: input.transport }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.autoStart !== undefined && { autoStart: input.autoStart }),
      ...(input.config !== undefined && { config: input.config }),
      updatedAt: new Date().toISOString(),
    };

    this.save();
    return { server: this.servers[index] };
  }

  delete(id: string): boolean {
    const index = this.servers.findIndex(s => s.id === id);
    if (index === -1) return false;
    this.servers.splice(index, 1);
    this.save();
    return true;
  }

  toggle(id: string, enabled: boolean): { server?: ServerConfig; error?: string } {
    return this.update(id, { enabled });
  }

  setExposedTo(id: string, exposedTo: string[]): { server?: ServerConfig; error?: string } {
    const server = this.getById(id);
    if (!server) return { error: `Server "${id}" not found` };
    server.exposedTo = exposedTo;
    server.updatedAt = new Date().toISOString();
    this.save();
    return { server };
  }

  setAutoStart(id: string, autoStart: boolean): { server?: ServerConfig; error?: string } {
    const server = this.getById(id);
    if (!server) return { error: `Server "${id}" not found` };
    server.autoStart = autoStart;
    server.updatedAt = new Date().toISOString();
    this.save();
    return { server };
  }

  private save(): void {
    this.ensureConfigDir();
    const data: ServersFile = {
      version: this.version,
      agents: this.agents,
      servers: this.servers,
    };
    const tmpFile = this.configFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmpFile, this.configFile);
  }

  static validateServer(s: any): string | null {
    if (!s || typeof s !== 'object') return 'server must be an object';
    if (typeof s.id !== 'string') return 'missing id';
    if (typeof s.name !== 'string') return 'missing name';
    if (s.transport !== 'stdio' && s.transport !== 'streamable-http') return 'transport must be "stdio" or "streamable-http"';
    if (typeof s.enabled !== 'boolean') return 'missing enabled';
    if (!s.config || typeof s.config !== 'object') return 'missing config';
    if (s.transport === 'stdio') {
      if (typeof s.config.command !== 'string') return 'missing config.command';
      if (!Array.isArray(s.config.args)) return 'config.args must be an array';
      if (typeof s.config.env !== 'object' || s.config.env === null) return 'config.env must be an object';
    } else if (s.transport === 'streamable-http') {
      if (typeof s.config.url !== 'string' || !s.config.url) return 'missing config.url';
    }
    return null;
  }

  getLogPath(serverName: string): string {
    return path.join(this.logsDir, `${serverName}.log`);
  }

  getLogsDir(): string {
    return this.logsDir;
  }
}
