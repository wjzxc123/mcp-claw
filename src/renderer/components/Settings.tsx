import React, { useEffect, useState } from 'react';
import { ThemeMode } from '../theme';

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function Settings({ themeMode, onThemeChange }: Props): React.ReactElement {
  const [settings, setSettings] = useState<StorageSettings | null>(null);
  const [configFile, setConfigFile] = useState('');
  const [logsDir, setLogsDir] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.mcpGateway.getStorageSettings()
      .then(data => {
        setSettings(data);
        setConfigFile(data.configFile);
        setLogsDir(data.logsDir);
      })
      .catch(err => setError(err?.message || String(err)));
  }, []);

  const selectConfigFile = async () => {
    setMessage(null);
    setError(null);
    const result = await window.mcpGateway.selectConfigFile();
    if (result.error) {
      setError(result.error);
      return;
    }
    if (!result.canceled && result.path) {
      setConfigFile(result.path);
    }
  };

  const selectLogsDir = async () => {
    setMessage(null);
    setError(null);
    const result = await window.mcpGateway.selectLogsDir();
    if (result.error) {
      setError(result.error);
      return;
    }
    if (!result.canceled && result.path) {
      setLogsDir(result.path);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextConfigFile = String(formData.get('configFile') || '').trim();
    const nextLogsDir = String(formData.get('logsDir') || '').trim();

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const result = await window.mcpGateway.updateStorageSettings({
        configFile: nextConfigFile,
        logsDir: nextLogsDir,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.settings) {
        setSettings(result.settings);
        setConfigFile(result.settings.configFile);
        setLogsDir(result.settings.logsDir);
      }
      setMessage('配置已保存。正在运行的 MCP 服务已按新日志目录重启。');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="page-container">
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2>配置</h2>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}

      <div className="settings-card">
        <div className="form-group">
          <label>主题</label>
          <div className="theme-options" role="radiogroup" aria-label="主题">
            <button
              type="button"
              className={`theme-option ${themeMode === 'light' ? 'active' : ''}`}
              onClick={() => onThemeChange('light')}
              aria-pressed={themeMode === 'light'}
            >
              白天
            </button>
            <button
              type="button"
              className={`theme-option ${themeMode === 'dark' ? 'active' : ''}`}
              onClick={() => onThemeChange('dark')}
              aria-pressed={themeMode === 'dark'}
            >
              暗夜
            </button>
            <button
              type="button"
              className={`theme-option ${themeMode === 'system' ? 'active' : ''}`}
              onClick={() => onThemeChange('system')}
              aria-pressed={themeMode === 'system'}
            >
              跟随系统
            </button>
          </div>
        </div>
      </div>

      <form className="settings-card" onSubmit={handleSave}>
        <div className="form-group">
          <label htmlFor="config-file">MCP 服务配置文件</label>
          <div className="path-picker-row">
            <input
              id="config-file"
              name="configFile"
              type="text"
              value={configFile}
              readOnly
              placeholder="请选择 servers.json 路径"
            />
            <button type="button" className="btn btn-outline" onClick={selectConfigFile}>
              选择
            </button>
          </div>
          <span className="form-hint">
            保存 Agent、MCP 服务配置、服务授权关系。路径必须是 JSON 文件。
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="logs-dir">MCP 服务日志目录</label>
          <div className="path-picker-row">
            <input
              id="logs-dir"
              name="logsDir"
              type="text"
              value={logsDir}
              readOnly
              placeholder="请选择日志目录"
            />
            <button type="button" className="btn btn-outline" onClick={selectLogsDir}>
              选择
            </button>
          </div>
          <span className="form-hint">
            保存各 MCP 服务启动和运行日志。修改后会重启当前正在运行的 MCP 服务。
          </span>
        </div>

        <div className="settings-meta">
          <span>路径设置文件</span>
          <code>{settings.settingsFile}</code>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </form>
    </div>
  );
}
