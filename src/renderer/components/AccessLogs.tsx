import React, { useEffect, useState, useRef } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

export function AccessLogs(): React.ReactElement {
  const [logs, setLogs] = useState<AccessLogEntry[]>([]);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    // Load existing logs
    window.mcpGateway.getAccessLogs().then(setLogs);

    // Listen for real-time logs
    const cleanup = window.mcpGateway.onAccessLog((entry) => {
      setLogs(prev => [...prev, entry]);
    });

    return cleanup;
  }, []);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logs]);

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const confirmClear = () => {
    setShowClearConfirm(false);
    setClearing(true);
    setTimeout(() => {
      setLogs([]);
      setClearing(false);
    }, 300);
  };

  const formatTime = (ts: string): string => {
    try {
      const d = new Date(ts);
      return d.toLocaleString('zh-CN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        fractionalSecond: 3,
      } as any);
    } catch {
      return ts;
    }
  };

  const actionLabel = (action: string): string => {
    switch (action) {
      case 'tools/list': return '列出工具';
      case 'tools/call': return '调用工具';
      default: return action;
    }
  };

  return (
    <div className="page-container">
      <div className="section-header">
        <h2>接入日志</h2>
        <span className="form-hint" style={{ marginLeft: 12 }}>
          实时显示 MCP Claw 的接入请求记录
        </span>
      </div>

      <div className="log-viewer" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        <div className="log-toolbar">
          <span className="log-status">
            实时监控中 / 共 {logs.length} 条记录
          </span>
          <button
            className="btn btn-sm btn-outline"
            onClick={handleClear}
            disabled={clearing || logs.length === 0}
          >
            {clearing ? '清空中...' : '清空显示'}
          </button>
        </div>
        <pre ref={preRef} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {logs.length === 0 ? (
            <span className="log-empty">暂无接入记录，等待请求...</span>
          ) : (
            logs.map((entry, i) => (
              <span
                key={i}
                className={`log-line ${
                  entry.action === 'tools/call' && entry.detail.startsWith('失败') ? 'log-error' :
                  !entry.agentId ? 'log-denied' : ''
                }`}
              >
                <span className="log-time">[{formatTime(entry.timestamp)}]</span>{' '}
                <span className={`log-agent ${!entry.agentName ? 'log-no-agent' : ''}`}>
                  {entry.agentName || '未认证'}
                </span>{' '}
                <span className="log-action">{actionLabel(entry.action)}</span>{' '}
                <span className="log-detail">{entry.detail}</span>
              </span>
            ))
          )}
        </pre>
      </div>

      {showClearConfirm && (
        <ConfirmDialog
          title="清空接入日志显示"
          message="确定要清空当前页面显示的接入日志吗？"
          detail="这里只清空当前界面的显示记录，不会影响 MCP Claw 后续继续记录新的请求。"
          confirmText="清空显示"
          danger
          busy={clearing}
          onConfirm={confirmClear}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}
