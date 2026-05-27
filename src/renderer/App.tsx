import React, { useEffect, useState } from 'react';
import { ServerList } from './components/ServerList';
import { AddServerForm } from './components/AddServerForm';
import { EndpointInfo } from './components/EndpointInfo';
import { ServerDetail } from './components/ServerDetail';
import { AccessLogs } from './components/AccessLogs';
import { Settings } from './components/Settings';
import { applyThemeMode, getStoredThemeMode, saveThemeMode, ThemeMode } from './theme';

type Page = 'servers' | 'add' | 'endpoint' | 'detail' | 'logs' | 'settings';

export function App(): React.ReactElement {
  const [page, setPage] = useState<Page>('servers');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());

  useEffect(() => {
    applyThemeMode(themeMode);
    if (themeMode !== 'system') return;

    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!media) return;

    const handleChange = () => applyThemeMode('system');
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [themeMode]);

  const handleThemeChange = (mode: ThemeMode) => {
    saveThemeMode(mode);
    setThemeMode(mode);
    applyThemeMode(mode);
  };

  const navigateToAdd = () => {
    setEditingId(null);
    setPage('add');
  };

  const navigateToEdit = (id: string) => {
    setEditingId(id);
    setPage('add');
  };

  const navigateToDetail = (id: string) => {
    setDetailId(id);
    setPage('detail');
  };

  const handleFormDone = () => {
    setRefreshKey(k => k + 1);
    if (editingId) {
      setDetailId(editingId);
      setPage('detail');
    } else {
      setPage('servers');
    }
  };

  const handleFormCancel = () => {
    if (editingId) {
      setDetailId(editingId);
      setPage('detail');
    } else {
      setPage('servers');
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">MCP Claw</h1>
        <nav className="app-nav">
          <button
            className={`nav-btn ${page === 'servers' || page === 'detail' ? 'active' : ''}`}
            onClick={() => setPage('servers')}
          >
            服务列表
          </button>
          <button
            className={`nav-btn ${page === 'endpoint' ? 'active' : ''}`}
            onClick={() => setPage('endpoint')}
          >
            Endpoint 信息
          </button>
          <button
            className={`nav-btn ${page === 'logs' ? 'active' : ''}`}
            onClick={() => setPage('logs')}
          >
            接入日志
          </button>
          <button
            className={`nav-btn ${page === 'settings' ? 'active' : ''}`}
            onClick={() => setPage('settings')}
          >
            配置
          </button>
        </nav>
      </header>
      <main className="app-main">
        {page === 'servers' && (
          <ServerList
            key={refreshKey}
            onAdd={navigateToAdd}
            onEdit={navigateToEdit}
            onDetail={navigateToDetail}
          />
        )}
        {page === 'detail' && detailId && (
          <ServerDetail
            serverId={detailId}
            onBack={() => setPage('servers')}
            onEdit={navigateToEdit}
            onRefresh={() => setRefreshKey(k => k + 1)}
          />
        )}
        {page === 'add' && (
          <AddServerForm
            editingId={editingId}
            onDone={handleFormDone}
            onCancel={handleFormCancel}
          />
        )}
        {page === 'endpoint' && <EndpointInfo />}
        {page === 'logs' && <AccessLogs />}
        {page === 'settings' && (
          <Settings
            themeMode={themeMode}
            onThemeChange={handleThemeChange}
          />
        )}
      </main>
    </div>
  );
}
