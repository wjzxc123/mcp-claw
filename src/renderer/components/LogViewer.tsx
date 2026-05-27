import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  serverName: string;
  /** Polling interval in ms (default 1000) */
  interval?: number;
}

export function LogViewer({ serverName, interval = 1000 }: Props): React.ReactElement {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const contentRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLog = useCallback(async () => {
    try {
      const result = await window.mcpGateway.getServerLog(serverName);
      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
        const newContent = result.content || '';
        if (contentRef.current !== newContent) {
          contentRef.current = newContent;
          setContent(newContent);
          setLastFetch(Date.now());
        }
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [serverName]);

  const handleClear = async () => {
    setShowClearConfirm(true);
  };

  const confirmClear = async () => {
    setShowClearConfirm(false);
    setClearing(true);
    try {
      const result = await window.mcpGateway.clearServerLog(serverName);
      if (result.error) {
        alert(`清理失败: ${result.error}`);
      } else {
        contentRef.current = '';
        setContent('');
        setLastFetch(Date.now());
      }
    } catch (err: any) {
      alert(`清理失败: ${err.message}`);
    } finally {
      setClearing(false);
    }
  };

  // Fetch on mount and when serverName changes
  useEffect(() => {
    contentRef.current = null;
    setContent(null);
    setError(null);
    fetchLog();

    // Start polling
    timerRef.current = setInterval(fetchLog, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [serverName, interval, fetchLog]);

  // Auto-scroll to bottom when content updates
  useEffect(() => {
    if (preRef.current && content) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content, lastFetch]);

  if (error) {
    return (
      <div className="log-viewer">
        <div className="log-empty">读取日志失败: {error}</div>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="log-viewer">
        <div className="log-empty">加载中...</div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="log-viewer">
        <div className="log-empty">暂无日志</div>
      </div>
    );
  }

  return (
    <>
      {showClearConfirm && (
        <ConfirmDialog
          title="清理运行日志"
          message={(
            <>
              确定要清理 <strong>{serverName}</strong> 的运行日志吗？
            </>
          )}
          detail="日志文件会被清空，历史运行输出将无法恢复。"
          confirmText="清理日志"
          danger
          busy={clearing}
          onConfirm={confirmClear}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
      <div className="log-viewer">
        <div className="log-toolbar">
          <span className="log-status">实时监控中 / 共 {content.split(/\r?\n/).filter(Boolean).length} 行</span>
          <button
            className="btn btn-sm btn-outline"
            onClick={handleClear}
            disabled={clearing}
          >
            {clearing ? '清理中...' : '清理日志'}
          </button>
        </div>
        <pre ref={preRef}>{content}</pre>
      </div>
    </>
  );
}
