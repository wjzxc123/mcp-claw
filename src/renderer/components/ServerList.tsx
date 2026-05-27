import React, { useEffect, useState, useCallback } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDetail: (id: string) => void;
}

export function ServerList({ onAdd, onEdit, onDetail }: Props): React.ReactElement {
  const [servers, setServers] = useState<ServerState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [serverToDelete, setServerToDelete] = useState<ServerState | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = servers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const loadServers = useCallback(async () => {
    try {
      const list = await window.mcpGateway.getServers();
      setServers(list);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  // Listen for state changes
  useEffect(() => {
    const cleanup = window.mcpGateway.onStateChanged((updated) => {
      setServers(prev =>
        prev.map(s => (s.id === updated.id ? updated : s))
      );
    });
    return cleanup;
  }, []);

  const handleToggle = async (server: ServerState) => {
    try {
      const result = await window.mcpGateway.toggleServer(server.id, !server.enabled);
      if (result.error) {
        alert(`操作失败: ${result.error}`);
      }
      await loadServers();
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
    }
  };

  const handleDelete = async () => {
    if (!serverToDelete) return;
    setDeleting(true);
    try {
      const result = await window.mcpGateway.deleteServer(serverToDelete.id);
      if (result.error) {
        alert(`删除失败: ${result.error}`);
        return;
      }
      await loadServers();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    } finally {
      setDeleting(false);
      setServerToDelete(null);
    }
  };

  const handleReconnect = async (server: ServerState) => {
    try {
      const result = await window.mcpGateway.reconnectServer(server.id);
      if (result.error) {
        alert(`重连失败: ${result.error}`);
      }
    } catch (err: any) {
      alert(`重连失败: ${err.message}`);
    }
  };

  const statusColor = (status: string): string => {
    switch (status) {
      case 'READY': return '#22c55e';       // Green
      case 'ERROR': return '#ef4444';       // Red
      case 'CONNECTING': return '#eab308';  // Yellow
      default: return '#6b7280';             // Gray
    }
  };

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'READY': return '在线';
      case 'ERROR': return '异常';
      case 'CONNECTING': return '连接中';
      default: return '未知';
    }
  };

  if (error) {
    return (
      <div className="page-container">
        <div className="error-banner">加载失败: {error}</div>
        <button className="btn btn-primary" onClick={loadServers}>重试</button>
      </div>
    );
  }

  // Empty state
  if (servers.length === 0) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-icon">⚡</div>
          <h2>还没有 MCP 服务器</h2>
          <p>添加你的第一个 MCP 服务器，开始统一管理所有 AI 工具的 MCP 配置。</p>
          <button className="btn btn-primary" onClick={onAdd}>
            添加第一个服务器
          </button>
        </div>
      </div>
    );
  }

  const renderCard = (server: ServerState) => (
    <div
      key={server.id}
      className={`server-card ${server.enabled ? '' : 'disabled'}`}
      onClick={() => onDetail(server.id)}
    >
      <div className="card-head">
        <div className="card-status">
          <span
            className="status-dot"
            style={{ backgroundColor: server.enabled ? statusColor(server.status) : '#6b7280' }}
            title={server.error ? `错误: ${server.error}` : ''}
          />
          <span className="card-status-text">
            {server.enabled ? statusLabel(server.status) : '已停止'}
          </span>
        </div>
        <label className="toggle-switch card-toggle" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={() => handleToggle(server)}
          />
          <span className="toggle-slider" />
        </label>
      </div>
      <div className="card-body">
        <span className="card-name">{server.name}</span>
        {server.description && (
          <span className="card-desc">{server.description}</span>
        )}
      </div>
      <div className={`card-actions ${server.status === 'ERROR' && server.enabled ? 'has-reconnect' : ''}`}>
        {server.status === 'ERROR' && server.enabled && (
          <button
            className="btn btn-sm btn-outline server-card-btn btn-reconnect"
            onClick={e => { e.stopPropagation(); handleReconnect(server); }}
          >
            重连
          </button>
        )}
        <button
          className="btn btn-sm btn-outline server-card-btn"
          onClick={e => { e.stopPropagation(); onEdit(server.id); }}
        >
          编辑
        </button>
        <button
          className="btn btn-sm btn-danger server-card-btn"
          onClick={e => { e.stopPropagation(); setServerToDelete(server); }}
        >
          删除
        </button>
      </div>
    </div>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>服务列表</h2>
        <button className="btn btn-primary" onClick={onAdd}>
          + 添加服务
        </button>
      </div>
      <div className="search-box">
        <input
          type="text"
          className="search-input"
          placeholder="搜索服务名称..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 20px' }}>
          <p>{search ? '没有匹配的服务' : '暂无服务'}</p>
        </div>
      ) : (
        <div className="server-cards">
          {filtered.map(renderCard)}
        </div>
      )}

      {serverToDelete && (
        <ConfirmDialog
          title="删除服务"
          message={(
            <>
              确定要删除 <strong>{serverToDelete.name}</strong> 吗？
            </>
          )}
          detail="删除后会停止该 MCP 服务，并从 MCP Claw 的服务列表中移除。此操作不可撤消。"
          confirmText="删除服务"
          danger
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setServerToDelete(null)}
        />
      )}
    </div>
  );
}
