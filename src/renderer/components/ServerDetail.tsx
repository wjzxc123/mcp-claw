import React, { useEffect, useState, useCallback } from 'react';
import { LogViewer } from './LogViewer';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  serverId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
  onRefresh: () => void;
}

export function ServerDetail({ serverId, onBack, onEdit, onRefresh }: Props): React.ReactElement {
  const [server, setServer] = useState<ServerState | null>(null);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ServerTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadServer = useCallback(async () => {
    try {
      const list = await window.mcpGateway.getServers();
      const found = list.find(s => s.id === serverId);
      if (found) {
        setServer(found);
      } else {
        setError('服务器已删除');
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [serverId]);

  const loadTools = useCallback(async () => {
    setToolsLoading(true);
    try {
      const result = await window.mcpGateway.getServerTools(serverId);
      if (result.error) {
        // Tools may not be available if server isn't ready
        setTools([]);
      } else {
        setTools(result.tools);
      }
    } catch {
      setTools([]);
    } finally {
      setToolsLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    setError(null);
    loadServer();
    loadTools();
  }, [loadServer, loadTools]);

  // Listen for state changes
  useEffect(() => {
    const cleanup = window.mcpGateway.onStateChanged((updated) => {
      if (updated.id === serverId) {
        setServer(updated);
      }
    });
    return cleanup;
  }, [serverId]);

  const handleToggle = async () => {
    if (!server) return;
    try {
      const result = await window.mcpGateway.toggleServer(server.id, !server.enabled);
      if (result.error) {
        alert(`操作失败: ${result.error}`);
      }
      await loadServer();
      onRefresh();
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
    }
  };

  const handleDelete = async () => {
    if (!server) return;
    setDeleting(true);
    try {
      const result = await window.mcpGateway.deleteServer(server.id);
      if (result.error) {
        alert(`删除失败: ${result.error}`);
        return;
      }
      onRefresh();
      onBack();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleReconnect = async () => {
    if (!server) return;
    try {
      const result = await window.mcpGateway.reconnectServer(server.id);
      if (result.error) {
        alert(`重连失败: ${result.error}`);
      }
    } catch (err: any) {
      alert(`重连失败: ${err.message}`);
    }
  };

  const handleTest = async () => {
    if (!server) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.mcpGateway.testServer(server.id);
      setTestResult(result);
      if (result.ok) {
        await loadTools();
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        status: server.status,
        toolCount: 0,
        durationMs: 0,
        error: err.message,
      });
    } finally {
      setTesting(false);
    }
  };

  const statusColor = (status: string): string => {
    switch (status) {
      case 'READY': return '#22c55e';
      case 'ERROR': return '#ef4444';
      case 'CONNECTING': return '#eab308';
      default: return '#6b7280';
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
        <button className="btn btn-outline btn-back" onClick={onBack}>← 返回服务列表</button>
        <div className="error-banner">{error}</div>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="page-container">
        <button className="btn btn-outline btn-back" onClick={onBack}>← 返回服务列表</button>
        <p>加载中...</p>
      </div>
    );
  }

  const transportLabel = (t: string): string =>
    t === 'streamable-http' ? 'streamable-http (HTTP 远程)' : 'stdio (命令行)';

  const cmdStr = server.configLabel || '-';

  return (
    <div className="page-container">
      <button className="btn btn-outline btn-back" onClick={onBack}>← 返回服务列表</button>

      <div className="detail-header">
        <h2>{server.name}</h2>
        <span className="status-badge" style={{ backgroundColor: statusColor(server.status) }}>
          {server.enabled ? statusLabel(server.status) : '已停止'}
        </span>
      </div>

      <div className="detail-card">
        <div className="detail-grid">
          <span className="detail-label">传输方式</span>
          <span className="detail-value">{transportLabel(server.transport)}</span>

          <span className="detail-label">命令</span>
          <span className="detail-value" title={cmdStr}>{cmdStr}</span>

          <span className="detail-label">启动开关</span>
          <span className="detail-value">{server.enabled ? '运行中' : '已停止'}</span>

          <span className="detail-label">自启动</span>
          <span className="detail-value">{server.autoStart ? '是' : '否'}</span>

          <span className="detail-label">暴露给</span>
          <span className="detail-value">{server.exposedTo.length > 0 ? `${server.exposedTo.length} 个 Agent` : '未暴露'}</span>

          {server.error && (
            <>
              <span className="detail-label">错误信息</span>
              <span className="detail-value" style={{ color: '#ef4444' }}>{server.error}</span>
            </>
          )}

          <span className="detail-label">重试次数</span>
          <span className="detail-value">{server.retryCount}</span>
        </div>
      </div>

      <div className="detail-actions">
        <button className="btn btn-outline" onClick={handleToggle}>
          {server.enabled ? '停止' : '启动'}
        </button>
        {server.status === 'ERROR' && server.enabled && (
          <button className="btn btn-outline" onClick={handleReconnect}>重连</button>
        )}
        <button className="btn btn-outline" onClick={handleTest} disabled={testing}>
          {testing ? '测试中...' : '测试'}
        </button>
        <button className="btn btn-primary" onClick={() => onEdit(server.id)}>编辑</button>
        <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>删除</button>
      </div>

      {testResult && (
        <div className={testResult.ok ? 'success-banner' : 'error-banner'}>
          {testResult.ok
            ? `Tools 测试通过: ${testResult.toolCount} 个工具, ${testResult.durationMs}ms`
            : `测试失败: ${testResult.error || `状态 ${testResult.status}`}`}
        </div>
      )}

      {/* Tools section */}
      <div className="section-header">
        <h3>工具列表 ({tools.length})</h3>
      </div>
      {toolsLoading ? (
        <p className="form-hint">加载中...</p>
      ) : tools.length === 0 ? (
        <p className="form-hint">该服务器没有暴露任何工具</p>
      ) : (
        <div className="tool-list">
          {tools.map((tool, i) => (
            <div key={i} className="tool-item">
              <div className="tool-item-name">{tool.name}</div>
              {tool.description && <div className="tool-item-desc">{tool.description}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Logs section */}
      <div className="section-header">
        <h3>运行日志</h3>
      </div>
      <LogViewer serverName={server.name} />

      {showDeleteConfirm && (
        <ConfirmDialog
          title="删除服务"
          message={(
            <>
              确定要删除 <strong>{server.name}</strong> 吗？
            </>
          )}
          detail="删除后会停止该 MCP 服务，并从 MCP Claw 的服务列表中移除。此操作不可撤消。"
          confirmText="删除服务"
          danger
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
