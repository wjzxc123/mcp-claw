import React, { useEffect, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

type AgentClientKind = 'claude' | 'codex' | 'generic';

function getAgentClientKind(agent: AgentConfig): AgentClientKind {
  const name = agent.name.toLowerCase();
  if (name.includes('codex')) return 'codex';
  if (name.includes('claude')) return 'claude';
  return 'generic';
}

function getCodexTokenEnvVar(agent: AgentConfig): string {
  const suffix = agent.name
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return suffix ? `MCP_CLAW_${suffix}_TOKEN` : 'MCP_CLAW_TOKEN';
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function EndpointInfo(): React.ReactElement {
  const [info, setInfo] = useState<EndpointInfo | null>(null);
  const [servers, setServers] = useState<ServerState[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [newAgentName, setNewAgentName] = useState('');
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState('');

  // Modals
  const [configModal, setConfigModal] = useState<AgentConfig | null>(null);
  const [serverModal, setServerModal] = useState<AgentConfig | null>(null);
  const [agentToRemove, setAgentToRemove] = useState<AgentConfig | null>(null);
  const [removingAgent, setRemovingAgent] = useState(false);

  const loadData = async () => {
    const [infoData, serversData, agentsData] = await Promise.all([
      window.mcpGateway.getEndpointInfo(),
      window.mcpGateway.getServers(),
      window.mcpGateway.getAgents(),
    ]);
    setInfo(infoData);
    setServers(serversData);
    setAgents(agentsData);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const cleanup = window.mcpGateway.onStateChanged((updated) => {
      setServers(prev =>
        prev.map(s => (s.id === updated.id ? updated : s))
      );
    });
    return cleanup;
  }, []);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleExposeToggle = async (serverId: string, agentId: string) => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;
    const newExposedTo = server.exposedTo.includes(agentId)
      ? server.exposedTo.filter(id => id !== agentId)
      : [...server.exposedTo, agentId];
    try {
      const result = await window.mcpGateway.setExposedTo(serverId, newExposedTo);
      if (result.error) {
        alert(`操作失败: ${result.error}`);
      }
      setServers(prev =>
        prev.map(s => s.id === serverId ? { ...s, exposedTo: newExposedTo } : s)
      );
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
    }
  };

  const handleAddAgent = async () => {
    if (!newAgentName.trim()) return;
    const result = await window.mcpGateway.addAgent(newAgentName.trim());
    if (result.error) {
      alert(`添加失败: ${result.error}`);
      return;
    }
    if (result.agent) {
      setAgents(prev => [...prev, result.agent!]);
      setNewAgentName('');
    }
  };

  const handleRemoveAgent = async () => {
    if (!agentToRemove) return;
    setRemovingAgent(true);
    try {
      const result = await window.mcpGateway.removeAgent(agentToRemove.id);
      if (result.error) {
        alert(`删除失败: ${result.error}`);
        return;
      }
      setAgents(prev => prev.filter(a => a.id !== agentToRemove.id));
      setServers(prev =>
        prev.map(s => ({ ...s, exposedTo: s.exposedTo.filter(aid => aid !== agentToRemove.id) }))
      );
      if (configModal?.id === agentToRemove.id) setConfigModal(null);
      if (serverModal?.id === agentToRemove.id) setServerModal(null);
      setAgentToRemove(null);
    } finally {
      setRemovingAgent(false);
    }
  };

  const handleUpdateToken = async (id: string) => {
    if (!tokenValue.trim()) return;
    const result = await window.mcpGateway.updateAgentToken(id, tokenValue.trim());
    if (result.error) {
      alert(`更新失败: ${result.error}`);
      return;
    }
    if (result.agent) {
      setAgents(prev => prev.map(a => a.id === id ? result.agent! : a));
    }
    setEditingToken(null);
  };

  const handleUpdateName = async (id: string) => {
    if (!nameValue.trim()) return;
    const result = await window.mcpGateway.updateAgentName(id, nameValue.trim());
    if (result.error) {
      alert(`更新失败: ${result.error}`);
      return;
    }
    if (result.agent) {
      setAgents(prev => prev.map(a => a.id === id ? result.agent! : a));
      if (configModal?.id === id) setConfigModal(result.agent);
      if (serverModal?.id === id) setServerModal(result.agent);
    }
    setEditingName(null);
  };

  const handleRegenerateToken = async (id: string) => {
    const newToken = 'tk_' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    const result = await window.mcpGateway.updateAgentToken(id, newToken);
    if (result.error) {
      alert(`更新失败: ${result.error}`);
      return;
    }
    if (result.agent) {
      setAgents(prev => prev.map(a => a.id === id ? result.agent! : a));
    }
  };

  if (!info) {
    return (
      <div className="page-container">
        <p>加载中...</p>
      </div>
    );
  }

  const makeClaudeConfig = (token: string) => JSON.stringify({
    mcpServers: {
      "mcp-claw": {
        type: 'http',
        url: info.url,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  }, null, 2);

  const makeCodexCommand = (agent: AgentConfig) => {
    const envVar = getCodexTokenEnvVar(agent);
    return [
      `[Environment]::SetEnvironmentVariable(${psSingleQuote(envVar)}, ${psSingleQuote(agent.token)}, 'User')`,
      `codex mcp add mcp-claw --url ${psSingleQuote(info.url)} --bearer-token-env-var ${envVar}`,
    ].join('\n');
  };

  const makeCodexConfig = (agent: AgentConfig) => {
    return [
      '[mcp_servers.mcp_servers]',
      'type = "http"',
      `url = "${info.url}"`,
      `headers = { Authorization = "Bearer ${agent.token}" }`,
    ].join('\n');
  };

  const makeCodexJsonConfig = (agent: AgentConfig) => JSON.stringify({
    mcpServers: {
      "mcp_claw": {
        type: 'http',
        url: info.url,
        headers: {
          Authorization: `Bearer ${agent.token}`,
        }
      }
    },
  }, null, 2);

  const makeGenericConfig = (token: string) => JSON.stringify({
    type: 'http',
    url: info.url,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }, null, 2);

  const renderConfigSections = (agent: AgentConfig) => {
    const kind = getAgentClientKind(agent);

    if (kind === 'claude') {
      return (
        <>
          <div className="config-modal-section">
            <label>Claude Code 全局配置</label>
            <p className="form-hint">
              添加到 <code>~/.claude.json</code> 的 <code>mcpServers</code> 字段中，所有项目生效。
            </p>
            <pre><code>{makeClaudeConfig(agent.token)}</code></pre>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => copyToClipboard(makeClaudeConfig(agent.token), `claude-global-${agent.id}`)}
            >
              {copied === `claude-global-${agent.id}` ? '已复制' : '复制'}
            </button>
          </div>

          <div className="config-modal-section">
            <label>Claude Code 项目级配置</label>
            <p className="form-hint">
              在项目根目录创建 <code>.mcp.json</code> 文件，仅当前项目生效。
            </p>
            <pre><code>{makeClaudeConfig(agent.token)}</code></pre>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => copyToClipboard(makeClaudeConfig(agent.token), `claude-project-${agent.id}`)}
            >
              {copied === `claude-project-${agent.id}` ? '已复制' : '复制'}
            </button>
          </div>
        </>
      );
    }

    if (kind === 'codex') {
      return (
        <>
          <div className="config-modal-section">
            <label>Codex CLI 命令</label>
            <p className="form-hint">
              Token 写入用户环境变量，Codex 配置只保存环境变量名。
            </p>
            <pre><code>{makeCodexCommand(agent)}</code></pre>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => copyToClipboard(makeCodexCommand(agent), `codex-command-${agent.id}`)}
            >
              {copied === `codex-command-${agent.id}` ? '已复制' : '复制'}
            </button>
          </div>

          <div className="config-modal-section">
            <label>Codex JSON 配置</label>
            <p className="form-hint">
              用于需要 JSON 格式的 Codex/MCP 配置导入场景。
            </p>
            <pre><code>{makeCodexJsonConfig(agent)}</code></pre>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => copyToClipboard(makeCodexJsonConfig(agent), `codex-json-${agent.id}`)}
            >
              {copied === `codex-json-${agent.id}` ? '已复制' : '复制'}
            </button>
          </div>

          <div className="config-modal-section">
            <label>~/.codex/config.toml</label>
            <p className="form-hint">
              也可以手动添加到 Codex 的 <code>mcp_servers</code> 配置中。
            </p>
            <pre><code>{makeCodexConfig(agent)}</code></pre>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => copyToClipboard(makeCodexConfig(agent), `codex-config-${agent.id}`)}
            >
              {copied === `codex-config-${agent.id}` ? '已复制' : '复制'}
            </button>
          </div>
        </>
      );
    }

    return (
      <div className="config-modal-section">
        <label>通用 Streamable HTTP 配置</label>
        <p className="form-hint">
          用于支持 Streamable HTTP MCP 的客户端；不要使用 Claude 或 Codex 的专用配置路径。
        </p>
        <pre><code>{makeGenericConfig(agent.token)}</code></pre>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => copyToClipboard(makeGenericConfig(agent.token), `generic-config-${agent.id}`)}
        >
          {copied === `generic-config-${agent.id}` ? '已复制' : '复制'}
        </button>
      </div>
    );
  };

  const agentServers = (agent: AgentConfig) =>
    servers.filter(s => s.exposedTo.includes(agent.id)).length;

  const agentToRemoveServerCount = agentToRemove ? agentServers(agentToRemove) : 0;

  return (
    <div className="page-container">
      <h2>Endpoint 信息</h2>

      {/* URL Card */}
      <div className="endpoint-card">
        <div className="endpoint-url-section">
          <label>统一 Endpoint URL</label>
          <div className="url-copy-row">
            <code className="endpoint-url">{info.url}</code>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => copyToClipboard(info.url, 'url')}
            >
              {copied === 'url' ? '已复制' : '复制'}
            </button>
          </div>
          <p className="form-hint">
            端口: {info.port} | 协议: Streamable HTTP | 仅监听 localhost
          </p>
        </div>
      </div>

      {/* Add Agent Row */}
      <div className="add-agent-row" style={{ marginBottom: 16 }}>
        <input
          type="text"
          className="search-input"
          placeholder="新 Agent 名称..."
          value={newAgentName}
          onChange={e => setNewAgentName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddAgent()}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary btn-sm" onClick={handleAddAgent}>
          + 添加 Agent
        </button>
      </div>

      {/* Agent Cards Grid */}
      <div className="agent-cards">
        {agents.map(agent => (
          <div
            key={agent.id}
            className="agent-card"
            onClick={() => setConfigModal(agent)}
          >
            {/* Name */}
            <div className="agent-card-head">
              {editingName === agent.id ? (
                <div className="agent-card-edit" onClick={e => e.stopPropagation()}>
                  <input
                    type="text"
                    className="agent-name-input"
                    value={nameValue}
                    onChange={e => setNameValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUpdateName(agent.id)}
                    autoFocus
                  />
                  <button className="btn btn-sm btn-primary" onClick={() => handleUpdateName(agent.id)}>确定</button>
                  <button className="btn btn-sm btn-outline" onClick={() => setEditingName(null)}>取消</button>
                </div>
              ) : (
                <span
                  className="agent-card-name"
                  onClick={e => { e.stopPropagation(); setNameValue(agent.name); setEditingName(agent.id); }}
                  title="点击编辑名称"
                >
                  {agent.name}
                </span>
              )}
              <span className="agent-server-count">
                {agentServers(agent)} 个服务
              </span>
            </div>

            {/* Token */}
            <div className="agent-card-token">
              {editingToken === agent.id ? (
                <div className="agent-card-edit" onClick={e => e.stopPropagation()}>
                  <input
                    type="text"
                    className="agent-token-input"
                    value={tokenValue}
                    onChange={e => setTokenValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUpdateToken(agent.id)}
                    autoFocus
                  />
                  <button className="btn btn-sm btn-primary" onClick={() => handleUpdateToken(agent.id)}>确定</button>
                  <button className="btn btn-sm btn-outline" onClick={() => setEditingToken(null)}>取消</button>
                </div>
              ) : (
                <code
                  className="agent-card-token-value"
                  onClick={e => { e.stopPropagation(); setTokenValue(agent.token); setEditingToken(agent.id); }}
                  title="点击编辑令牌"
                >
                  {agent.token}
                </code>
              )}
            </div>

            {/* Actions */}
            <div className="agent-card-actions" onClick={e => e.stopPropagation()}>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => copyToClipboard(agent.token, `token-${agent.id}`)}
              >
                {copied === `token-${agent.id}` ? '已复制' : '复制令牌'}
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => handleRegenerateToken(agent.id)}
              >
                重新生成
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setServerModal(agent)}
              >
                管理服务
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => setAgentToRemove(agent)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Config Modal */}
      {configModal && (
        <div className="modal-overlay" onClick={() => setConfigModal(null)}>
          <div className="modal-box agent-config-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">{configModal.name} — 接入配置</div>
            <div className="modal-body">
              <p className="form-hint" style={{ marginBottom: 16 }}>
                通过 <code>Authorization</code> 请求头携带令牌，连接至 Streamable HTTP 端点 <code>{info.url}</code>。
              </p>
              {renderConfigSections(configModal)}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setConfigModal(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Server Exposure Modal */}
      {serverModal && (
        <div className="modal-overlay" onClick={() => setServerModal(null)}>
          <div className="modal-box agent-config-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">{serverModal.name} — 可访问的服务</div>
            <div className="modal-body">
              {servers.length === 0 ? (
                <p className="form-hint">暂无服务。请先添加 MCP 服务。</p>
              ) : (
                <div className="server-check-modal-list">
                  {servers.map(server => {
                    const canCheck = server.enabled && server.status === 'READY';
                    const checked = server.exposedTo.includes(serverModal.id);
                    return (
                      <label
                        key={server.id}
                        className={`agent-check-row ${!canCheck ? 'disabled' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canCheck}
                          onChange={() => handleExposeToggle(server.id, serverModal.id)}
                        />
                        <span className="agent-check-label">
                          <span className={`status-dot-sm ${canCheck ? 'online' : 'offline'}`} />
                          {server.name}
                          {!canCheck && (
                            <span className="form-hint" style={{ marginLeft: 8 }}>
                              ({server.enabled ? '连接中' : '已停止'})
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setServerModal(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {agentToRemove && (
        <ConfirmDialog
          title="删除 Agent"
          message={(
            <>
              确定要删除 <strong>{agentToRemove.name}</strong> 吗？
            </>
          )}
          detail={
            agentToRemoveServerCount > 0
              ? `该 Agent 当前可访问 ${agentToRemoveServerCount} 个服务。删除后，这些服务会立即移除此 Agent 的授权。`
              : '该 Agent 当前未授权访问任何服务。删除后，对应 token 将不能再接入 MCP Claw。'
          }
          confirmText="删除 Agent"
          danger
          busy={removingAgent}
          onConfirm={handleRemoveAgent}
          onCancel={() => setAgentToRemove(null)}
        />
      )}
    </div>
  );
}
