import { EventEmitter } from 'events';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  ServerConfig,
  ServerState,
  ServerStatus,
  MCPTool,
  MAX_RETRIES,
  RETRY_DELAYS,
  StdioConfig,
  HttpConfig,
} from './types';

export interface ChildManagerEvents {
  'state-changed': (state: ServerState) => void;
  'tools-updated': (serverId: string, tools: MCPTool[]) => void;
}

export class ChildManager extends EventEmitter {
  private config: ServerConfig;
  private state: ServerState;
  private client: Client | null = null;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
  private retryCount: number = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private logBuffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private childProcess: ChildProcess | null = null;
  private isCleaningUp: boolean = false;
  private logPath: string;

  constructor(config: ServerConfig, logPath: string) {
    super();
    this.config = config;
    this.logPath = logPath;
    this.state = {
      id: config.id,
      name: config.name,
      description: config.description || '',
      transport: config.transport,
      enabled: config.enabled,
      autoStart: config.autoStart,
      exposedTo: config.exposedTo || [],
      status: 'CONNECTING' as ServerStatus,
      retryCount: 0,
      configLabel: config.transport === 'stdio'
        ? [(config.config as StdioConfig).command, ...((config.config as StdioConfig).args || [])].join(' ')
        : (config.config as HttpConfig).url,
    };
  }

  getState(): ServerState {
    return { ...this.state };
  }

  getId(): string {
    return this.config.id;
  }

  getName(): string {
    return this.config.name;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async start(): Promise<void> {
    if (this.isCleaningUp) return;

    this.setState('CONNECTING');
    this.retryCount = 0;

    try {
      await this.spawnProcess();
    } catch (err: any) {
      this.handleError(err);
    }
  }

  private log(msg: string): void {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const line = `[${ts}] ${msg}\n`;
    this.logBuffer.push(line);
  }

  private openLogFile(): void {
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    }
    // Ensure the log file exists
    if (!fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, '', { mode: 0o600 });
    }
    // Flush buffered log entries to disk every 500ms
    this.flushTimer = setInterval(() => this.flushLog(), 500);
  }

  private flushLog(): void {
    if (this.logBuffer.length === 0) return;
    const data = this.logBuffer.join('');
    this.logBuffer = [];
    try {
      fs.appendFileSync(this.logPath, data);
    } catch {
      // Ignore flush errors — the log file might not be writable
    }
  }

  private finalFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushLog();
  }

  private async spawnProcess(): Promise<void> {
    this.client = new Client(
      { name: 'mcp-claw', version: '0.1.0' },
      { capabilities: {} as any },
    );

    this.openLogFile();

    if (this.config.transport === 'stdio') {
      await this.connectStdio();
    } else if (this.config.transport === 'streamable-http') {
      await this.connectHttp();
    }

    this.state.enabled = true;
    this.setState('READY');
    this.updateTools();
  }

  private async connectStdio(): Promise<void> {
    const { command, args, env, cwd } = this.config.config as StdioConfig;
    const cmdLine = [command, ...(args || [])].join(' ');

    this.log(`Starting: ${cmdLine}`);

    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, ...env })) {
      if (v !== undefined) childEnv[k] = v;
    }

    // 1. Spawn the child process ourselves so we can capture stdout/stderr
    //    BEFORE the MCP transport starts consuming stdout for JSON-RPC.
    const proc = spawn(command, args || [], {
      env: childEnv,
      cwd: cwd || undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    this.childProcess = proc;

    // 2. Capture stdout and stderr from the very first byte
    proc.stdout.on('data', (chunk: Buffer) => {
      this.logBuffer.push(chunk.toString('utf-8'));
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      this.logBuffer.push(chunk.toString('utf-8'));
    });

    // 3. Track the process lifecycle
    proc.on('close', (code: number | null, signal: string | null) => {
      const reason = signal
        ? `Process killed by signal ${signal}`
        : `Process exited with code ${code}`;
      this.log(`Process closed: ${reason}`);
      if (!this.isCleaningUp) {
        this.handleError(new Error(reason));
      }
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      const msg = err.code === 'ENOENT'
        ? `Command not found: ${command}`
        : `Spawn failed: ${err.message}`;
      this.log(`Spawn error: ${msg}`);
      this.handleError(new Error(msg));
    });

    // 4. Create StdioClientTransport but inject our pre-spawned process
    const stdioTransport = new StdioClientTransport({
      command,
      args,
      env: childEnv,
      cwd: cwd || undefined,
      stderr: 'pipe',
    });

    const t = stdioTransport as any;
    t._process = proc;

    // Override start() — skip spawning (we already did it), just wire up MCP listeners
    stdioTransport.start = async () => {
      if (t._started) {
        throw new Error('StdioClientTransport already started!');
      }
      t._started = true;

      // Wire MCP message parsing on stdout (same as original SDK start())
      proc.stdout.on('data', (chunk: Buffer) => {
        t._readBuffer.append(chunk);
        t.processReadBuffer();
      });
      proc.stdout.on('error', (error: Error) => {
        stdioTransport.onerror?.(error);
      });
      proc.stdin?.on('error', (error: Error) => {
        stdioTransport.onerror?.(error);
      });

      // Also pipe stderr through the SDK's PassThrough if available
      if (t._stderrStream && proc.stderr) {
        proc.stderr.pipe(t._stderrStream);
      }
    };

    stdioTransport.onerror = (err) => {
      this.log(`Transport error: ${err}`);
    };

    this.transport = stdioTransport;
    await this.client!.connect(this.transport);

    this.log('Connected successfully (stdio)');
  }

  private async connectHttp(): Promise<void> {
    const { url } = this.config.config as HttpConfig;

    this.log(`Connecting to ${url}`);

    const httpTransport = new StreamableHTTPClientTransport(
      new URL(url),
    );

    httpTransport.onerror = (err) => {
      this.log(`HTTP transport error: ${err}`);
      console.error(`[${this.config.name}] HTTP transport error:`, err);
    };

    this.transport = httpTransport;
    await this.client!.connect(this.transport);

    this.log('Connected successfully (HTTP)');
  }

  private async updateTools(): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.listTools();
      this.emit('tools-updated', this.config.id, result.tools as MCPTool[]);
    } catch {
      this.handleError(new Error('tools/list failed after connection'));
    }
  }

  private handleError(err: Error): void {
    if (this.isCleaningUp) return;

    this.log(`Error: ${err.message}`);

    this.retryCount++;

    if (this.retryCount <= MAX_RETRIES) {
      const delay = RETRY_DELAYS[this.retryCount - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      this.setError(err.message);

      this.retryTimer = setTimeout(() => {
        this.cleanupProcess().then(() => {
          this.spawnProcess().catch((e) => this.handleError(e));
        });
      }, delay);
    } else {
      this.setError(`Max retries (${MAX_RETRIES}) exceeded: ${err.message}`);
    }
  }

  private setState(status: ServerStatus): void {
    this.state = {
      ...this.state,
      status,
      error: status === 'ERROR' ? this.state.error : undefined,
      retryCount: this.retryCount,
      configLabel: this.state.configLabel,
    };
    this.emit('state-changed', this.getState());
  }

  private setError(message: string): void {
    this.state = {
      ...this.state,
      status: 'ERROR',
      error: message,
      retryCount: this.retryCount,
      configLabel: this.state.configLabel,
    };
    this.emit('state-changed', this.getState());
  }

  async reconnect(): Promise<void> {
    this.retryCount = 0;
    this.isCleaningUp = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.cleanupProcess();
    await this.start();
  }

  async cleanupProcess(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Ignore close errors
      }
      this.client = null;
    }

    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Ignore close errors
      }
      this.transport = null;
    }

    // Kill the child process and all its descendants
    if (this.childProcess && !this.childProcess.killed && this.childProcess.pid) {
      try {
        // On Windows, taskkill /T /PID kills the process tree
        if (process.platform === 'win32') {
          try {
            execSync(`taskkill /T /PID ${this.childProcess.pid} /F`, { timeout: 5000, stdio: 'ignore' });
          } catch {
            // Fallback to direct kill
            this.childProcess.kill('SIGKILL');
          }
        } else {
          // Unix: negative pid signals the process group
          process.kill(-this.childProcess.pid, 'SIGTERM');
          setTimeout(() => {
            try { process.kill(-this.childProcess!.pid!, 'SIGKILL'); } catch {}
          }, 2000).unref();
        }
      } catch {
        // Process already dead
      }
      this.childProcess = null;
    }

    this.finalFlush();
  }

  async stop(): Promise<void> {
    this.isCleaningUp = true;
    this.log('Shutting down...');
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.cleanupProcess();
    this.log('Shutdown complete');
  }

  setExposedTo(agentIds: string[]): void {
    this.state.exposedTo = agentIds;
    this.emit('state-changed', this.getState());
  }

  setAutoStart(val: boolean): void {
    this.state.autoStart = val;
    this.emit('state-changed', this.getState());
  }

  checkHealth(): ServerStatus {
    if (this.state.status !== 'READY' && this.state.status !== 'ERROR') {
      return this.state.status;
    }

    if (this.config.transport === 'streamable-http') {
      return this.client ? 'READY' : 'ERROR';
    }

    if (!this.childProcess || this.childProcess.killed || !this.childProcess.pid) {
      return 'ERROR';
    }

    try {
      if (process.platform !== 'win32') {
        process.kill(this.childProcess.pid, 0);
      }
      return this.client ? 'READY' : 'ERROR';
    } catch {
      return 'ERROR';
    }
  }

  async getTools(): Promise<MCPTool[]> {
    if (!this.client || this.state.status !== 'READY') {
      return [];
    }
    try {
      const result = await this.client.listTools();
      return result.tools as MCPTool[];
    } catch {
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }> {
    if (!this.client) {
      throw new Error(`Server "${this.config.name}" is not connected`);
    }
    const result = await this.client.callTool({ name, arguments: args });
    return { content: result.content as Array<{ type: string; text?: string }> };
  }
}
