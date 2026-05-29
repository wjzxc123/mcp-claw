import React, { useState, useEffect } from 'react';
import { LogViewer } from './LogViewer';

interface Props {
  editingId: string | null;
  onDone: () => void;
  onCancel: () => void;
}

interface EnvEntry {
  key: string;
  value: string;
}

type FormTransport = 'stdio' | 'streamable-http';
type ConfigMode = 'form' | 'json';

interface ParsedJsonDraft {
  name?: string;
  description?: string;
  transport: FormTransport;
  autoStart: boolean;
  config: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string | null;
    url?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item !== null && item !== undefined)
    .map(item => String(item));
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, val]) => key.trim() && val !== null && val !== undefined)
      .map(([key, val]) => [key.trim(), String(val)])
  );
}

function normalizeCwd(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function inferTransport(raw: Record<string, unknown>, config: Record<string, unknown>): FormTransport | null {
  const declared = String(raw.transport || raw.type || '').toLowerCase();
  if (declared === 'stdio') return 'stdio';
  if (declared === 'streamable-http' || declared === 'http' || declared === 'streamable_http') {
    return 'streamable-http';
  }
  if (typeof config.command === 'string') return 'stdio';
  if (typeof config.url === 'string') return 'streamable-http';
  return null;
}

function inferNameFromStdioConfig(config: Record<string, unknown>): string | undefined {
  const args = normalizeStringArray(config.args).map(arg => arg.trim()).filter(Boolean);
  const packageArg = [...args].reverse().find(arg => !arg.startsWith('-'));
  if (packageArg) return packageArg;

  if (typeof config.command === 'string' && config.command.trim()) {
    const parts = config.command.trim().split(/[\\/]/);
    return parts[parts.length - 1].replace(/\.(cmd|exe|ps1)$/i, '') || undefined;
  }
  return undefined;
}

function normalizeServerDraft(raw: Record<string, unknown>, fallbackName?: string): ParsedJsonDraft {
  const config = isRecord(raw.config) ? raw.config : raw;
  const transport = inferTransport(raw, config);
  if (!transport) {
    throw new Error('无法识别 MCP 服务配置，请提供 command 或 url');
  }

  const nameFromConfig = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined;
  const description = typeof raw.description === 'string' ? raw.description : undefined;
  const autoStart = typeof raw.autoStart === 'boolean' ? raw.autoStart : true;

  if (transport === 'stdio') {
    const command = typeof config.command === 'string' ? config.command.trim() : '';
    if (!command) {
      throw new Error('stdio 模式下 command 不能为空');
    }

    return {
      name: nameFromConfig || fallbackName || inferNameFromStdioConfig(config),
      description,
      transport,
      autoStart,
      config: {
        command,
        args: normalizeStringArray(config.args),
        env: normalizeEnv(config.env),
        cwd: normalizeCwd(config.cwd),
      },
    };
  }

  const url = typeof config.url === 'string' ? config.url.trim() : '';
  if (!url) {
    throw new Error('streamable-http 模式下 url 不能为空');
  }

  return {
    name: nameFromConfig || fallbackName,
    description,
    transport,
    autoStart,
    config: { url },
  };
}

function parseJsonServerConfig(jsonConfig: string): ParsedJsonDraft {
  if (!jsonConfig.trim()) {
    throw new Error('JSON 配置不能为空');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonConfig);
  } catch (e: any) {
    throw new Error(`JSON 解析失败: ${e.message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('JSON 配置必须是对象');
  }

  if (isRecord(parsed.mcpServers)) {
    const servers = Object.entries(parsed.mcpServers).filter(([, value]) => isRecord(value));
    if (servers.length === 0) {
      throw new Error('mcpServers 中没有可用的服务配置');
    }
    const [serverName, serverConfig] = servers[0] as [string, Record<string, unknown>];
    return normalizeServerDraft(serverConfig, serverName);
  }

  return normalizeServerDraft(parsed);
}

export function AddServerForm({ editingId, onDone, onCancel }: Props): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [transport, setTransport] = useState<FormTransport>('stdio');
  const [command, setCommand] = useState('npx');
  const [argEntries, setArgEntries] = useState<string[]>(['-y']);
  const [httpUrl, setHttpUrl] = useState('');
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [autoStart, setAutoStart] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configMode, setConfigMode] = useState<ConfigMode>('form');
  const [jsonConfig, setJsonConfig] = useState('');

  const isEditing = editingId !== null;

  useEffect(() => {
    if (!editingId) return;
    window.mcpGateway.getServerConfig(editingId).then(result => {
      if (!result.config) return;
      const server = result.config;
      setName(server.name);
      setDescription((server as any).description || '');
      setTransport(server.transport as 'stdio' | 'streamable-http');
      setAutoStart(server.autoStart !== false);
      if (server.transport === 'stdio') {
        setCommand((server.config as any).command || '');
        setArgEntries(((server.config as any).args && (server.config as any).args.length > 0) ? (server.config as any).args : ['']);
        if ((server.config as any).env) {
          setEnvEntries(
            Object.entries((server.config as any).env).map(([key, value]) => ({ key, value }))
          );
        } else {
          setEnvEntries([]);
        }
      } else if (server.transport === 'streamable-http') {
        setHttpUrl((server.config as any).url || '');
      }
    });
  }, [editingId]);

  const buildInputFromForm = (): AddServerInput | null => {
    if (!name.trim()) {
      setError('服务名称不能为空');
      return null;
    }
    if (name.includes('__')) {
      setError('服务名称不能包含 "__"');
      return null;
    }

    if (transport === 'stdio') {
      if (!command.trim()) {
        setError('命令不能为空');
        return null;
      }
      const args = argEntries.map(s => s.trim()).filter(s => s.length > 0);
      const env: Record<string, string> = {};
      for (const entry of envEntries) {
        if (entry.key.trim()) {
          env[entry.key.trim()] = entry.value;
        }
      }
      return {
        name: name.trim(),
        description: description.trim(),
        transport,
        enabled: true,
        autoStart,
        config: {
          command: command.trim(),
          args,
          env,
        },
      };
    } else {
      if (!httpUrl.trim()) {
        setError('URL 不能为空');
        return null;
      }
      return {
        name: name.trim(),
        description: description.trim(),
        transport,
        enabled: true,
        autoStart,
        config: {
          url: httpUrl.trim(),
        },
      };
    }
  };

  const buildInputFromJson = (): AddServerInput | null => {
    let parsed: ParsedJsonDraft;
    try {
      parsed = parseJsonServerConfig(jsonConfig);
    } catch (e: any) {
      setError(e.message);
      return null;
    }

    const inputName = (name || parsed.name || '').trim();
    if (!inputName) {
      setError('服务名称不能为空');
      return null;
    }
    if (inputName.includes('__')) {
      setError('服务名称不能包含 "__"');
      return null;
    }

    return {
      name: inputName,
      description: (description || parsed.description || '').trim(),
      transport: parsed.transport,
      enabled: true,
      autoStart: parsed.autoStart,
      config: parsed.config,
    };
  };

  const applyJsonDraft = (draft: ParsedJsonDraft) => {
    if (!isEditing && draft.name) {
      setName(draft.name);
    }
    if (draft.description !== undefined) {
      setDescription(draft.description);
    }
    setTransport(draft.transport);
    setAutoStart(draft.autoStart);

    if (draft.transport === 'stdio') {
      setCommand(draft.config.command || '');
      setArgEntries(draft.config.args && draft.config.args.length > 0 ? draft.config.args : ['']);
      setEnvEntries(Object.entries(draft.config.env || {}).map(([key, value]) => ({ key, value })));
    } else {
      setHttpUrl(draft.config.url || '');
    }
  };

  const handleJsonConfigChange = (value: string) => {
    setJsonConfig(value);
    try {
      const draft = parseJsonServerConfig(value);
      applyJsonDraft(draft);
      if (error) setError(null);
    } catch {
      // Keep typing/pasting quiet; submit still reports the concrete parse error.
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const input = configMode === 'form' ? buildInputFromForm() : buildInputFromJson();
      if (!input) {
        setSubmitting(false);
        return;
      }

      if (configMode === 'form' && transport === 'stdio') {
        const env = input.config.env || {};
        const secretKeys = Object.keys(env).filter(k =>
          k.toUpperCase().includes('TOKEN') ||
          k.toUpperCase().includes('KEY') ||
          k.toUpperCase().includes('SECRET') ||
          k.toUpperCase().includes('PASSWORD')
        );

        if (secretKeys.length > 0 && !isEditing) {
          const confirmed = confirm(
            `检测到密钥字段 (${secretKeys.join(', ')}) 将被写入本地配置文件。\n` +
            `配置文件仅限本机访问 (权限 0600)。\n\n确定要继续吗？`
          );
          if (!confirmed) {
            setSubmitting(false);
            return;
          }
        }
      }

      const result = isEditing
        ? await window.mcpGateway.updateServer(editingId!, input)
        : await window.mcpGateway.addServer(input);
      if (result.error) {
        setError(result.error);
        setSubmitting(false);
        return;
      }

      onDone();
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const addArgRow = () => setArgEntries([...argEntries, '']);
  const removeArgRow = (index: number) => setArgEntries(argEntries.filter((_, i) => i !== index));
  const updateArgEntry = (index: number, val: string) => {
    const updated = [...argEntries];
    updated[index] = val;
    setArgEntries(updated);
  };

  const addEnvRow = () => setEnvEntries([...envEntries, { key: '', value: '' }]);
  const removeEnvRow = (index: number) => setEnvEntries(envEntries.filter((_, i) => i !== index));
  const updateEnvEntry = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...envEntries];
    updated[index] = { ...updated[index], [field]: val };
    setEnvEntries(updated);
  };

  const generateJsonExample = () => {
    if (transport === 'stdio') {
      return JSON.stringify({
        transport: 'stdio',
        autoStart: true,
        config: {
          command: command || 'npx',
          args: argEntries.filter(s => s.trim()),
          env: Object.fromEntries(envEntries.filter(e => e.key.trim()).map(e => [e.key.trim(), e.value])),
        },
      }, null, 2);
    } else {
      return JSON.stringify({
        transport: 'streamable-http',
        autoStart: true,
        config: {
          url: httpUrl || 'http://localhost:3000/mcp',
        },
      }, null, 2);
    }
  };

  const switchToJson = () => {
    setJsonConfig(generateJsonExample());
    setConfigMode('json');
  };

  return (
    <div className="page-container">
      <button className="btn btn-outline btn-back" onClick={onCancel}>← 返回</button>
      <h2>{isEditing ? `编辑服务: ${name}` : '添加 MCP 服务'}</h2>

      <div className="config-mode-tabs">
        <button
          type="button"
          className={`tab-btn ${configMode === 'form' ? 'active' : ''}`}
          onClick={() => setConfigMode('form')}
        >
          表单配置
        </button>
        <button
          type="button"
          className={`tab-btn ${configMode === 'json' ? 'active' : ''}`}
          onClick={switchToJson}
        >
          JSON 配置
        </button>
      </div>

      <form className="server-form" onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}

        <div className="form-group">
          <label htmlFor="name">服务名称 *</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如: github, filesystem"
            disabled={isEditing}
          />
          <span className="form-hint">工具将以 "服务名__工具名" 形式暴露给 AI</span>
        </div>

        <div className="form-group">
          <label htmlFor="description">服务描述</label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="简要描述该服务的功能（可选）"
          />
        </div>

        {configMode === 'json' ? (
          <div className="form-group">
            <label htmlFor="json-config">JSON 配置</label>
            <textarea
              id="json-config"
              className="json-textarea"
              value={jsonConfig}
              onChange={e => handleJsonConfigChange(e.target.value)}
              rows={14}
              spellCheck={false}
            />
            <span className="form-hint">
              支持 MCP Claw JSON、Claude/Codex 的 mcpServers JSON，粘贴后会自动解析到表单字段。
              {transport === 'stdio' ? ' stdio 模式需 config.command。' : ' streamable-http 模式需 config.url。'}
            </span>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label>传输方式</label>
              <div className="transport-tabs">
                <button
                  type="button"
                  className={`tab-btn ${transport === 'stdio' ? 'active' : ''}`}
                  onClick={() => !isEditing && setTransport('stdio')}
                  disabled={isEditing}
                >
                  stdio (命令行)
                </button>
                <button
                  type="button"
                  className={`tab-btn ${transport === 'streamable-http' ? 'active' : ''}`}
                  onClick={() => !isEditing && setTransport('streamable-http')}
                  disabled={isEditing}
                >
                  streamable-http (HTTP 地址)
                </button>
              </div>
            </div>

            {transport === 'stdio' ? (
              <>
                <div className="form-group">
                  <label htmlFor="command">命令 *</label>
                  <input
                    id="command"
                    type="text"
                    value={command}
                    onChange={e => setCommand(e.target.value)}
                    placeholder="例如: npx, node, python"
                  />
                </div>

                <div className="form-group">
                  <label>
                    参数
                    <button type="button" className="btn btn-sm btn-outline" onClick={addArgRow} style={{ marginLeft: 12 }}>
                      + 添加
                    </button>
                  </label>
                  {argEntries.length === 0 && (
                    <p className="form-hint">无需参数</p>
                  )}
                  {argEntries.map((entry, i) => (
                    <div key={i} className="entry-row">
                      <input
                        type="text"
                        value={entry}
                        onChange={e => updateArgEntry(i, e.target.value)}
                        placeholder={`参数 ${i + 1}`}
                      />
                      <button
                        type="button"
                        className="btn-remove"
                        onClick={() => removeArgRow(i)}
                        title="删除此参数"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div className="form-group">
                  <label>
                    环境变量
                    <button type="button" className="btn btn-sm btn-outline" onClick={addEnvRow} style={{ marginLeft: 12 }}>
                      + 添加
                    </button>
                  </label>
                  {envEntries.length === 0 && (
                    <p className="form-hint">无需额外环境变量</p>
                  )}
                  {envEntries.map((entry, i) => (
                    <div key={i} className="entry-row">
                      <input
                        type="text"
                        value={entry.key}
                        onChange={e => updateEnvEntry(i, 'key', e.target.value)}
                        placeholder="KEY"
                        style={{ flex: 1 }}
                      />
                      <input
                        type="text"
                        value={entry.value}
                        onChange={e => updateEnvEntry(i, 'value', e.target.value)}
                        placeholder="VALUE"
                        style={{ flex: 2 }}
                      />
                      <button
                        type="button"
                        className="btn-remove"
                        onClick={() => removeEnvRow(i)}
                        title="删除此变量"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="form-group">
                <label htmlFor="http-url">URL *</label>
                <input
                  id="http-url"
                  type="text"
                  value={httpUrl}
                  onChange={e => setHttpUrl(e.target.value)}
                  placeholder="http://localhost:3000/mcp"
                />
                <span className="form-hint">远程 MCP 服务器的 Streamable HTTP 端点地址</span>
              </div>
            )}
          </>
        )}

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={e => setAutoStart(e.target.checked)}
            />
            启动 MCP Claw 时自动拉起此服务
          </label>
          <span className="form-hint">关闭后，服务不会随 MCP Claw 启动，但可以手动开启</span>
        </div>

        {isEditing && (
          <div className="form-group">
            <label>启动日志</label>
            <LogViewer serverName={name} />
          </div>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '保存中...' : isEditing ? '保存修改' : '添加服务'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onCancel}>
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
