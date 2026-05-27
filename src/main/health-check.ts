import { ChildManager } from './child-manager';
import { ProxyServer } from './proxy-server';
import { ConfigStore } from './config-store';
import { ServerState } from './types';

/**
 * Health check coordinator — runs periodic health checks on all child managers
 * and pushes state changes to the proxy server.
 */
export class HealthChecker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private childManagers: Map<string, ChildManager> = new Map();
  private proxyServer: ProxyServer;
  private onStateChange: (state: ServerState) => void;

  constructor(
    proxyServer: ProxyServer,
    onStateChange: (state: ServerState) => void,
  ) {
    this.proxyServer = proxyServer;
    this.onStateChange = onStateChange;
  }

  registerChildManager(cm: ChildManager): void {
    this.childManagers.set(cm.getId(), cm);
    cm.on('state-changed', (state) => {
      this.onStateChange(state);
      // If a backend's state changed, invalidate tool cache and notify
      if (state.status === 'READY' || state.status === 'ERROR') {
        this.proxyServer.invalidateCache();
        this.proxyServer.notifyToolsChanged();
      }
    });
  }

  unregisterChildManager(id: string): void {
    this.childManagers.delete(id);
  }

  start(intervalMs: number = 30_000): void {
    this.interval = setInterval(() => {
      this.checkAll();
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private checkAll(): void {
    for (const cm of this.childManagers.values()) {
      if (!cm.isEnabled()) continue;
      const health = cm.checkHealth();
      const currentStatus = cm.getState().status;

      if (health === 'ERROR' && currentStatus === 'READY') {
        // State inconsistency — push error state
        // This will trigger child-manager's internal error handling
        const state = cm.getState();
        this.onStateChange({ ...state, status: 'ERROR', error: 'Health check failed: process not responding' });
      }
    }
  }
}
