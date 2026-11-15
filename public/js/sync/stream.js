import { state } from '../globals.js';

export class SyncStream {
  constructor(manager) {
    this.manager = manager;
    this.eventSource = null;
    this.active = false;
    this.consecutiveErrors = 0;
    this.listenersAttached = false;
    this._onVisibility = () => this.handleVisibility();
    this._onFreeze = () => this.close();
    this._onResume = () => this.openIfVisible();
    this._onOnline = () => {
      this.consecutiveErrors = 0;
      this.openIfVisible();
    };
  }

  attachLifecycleListeners() {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibility);
      document.addEventListener('freeze', this._onFreeze);
      document.addEventListener('resume', this._onResume);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', this._onFreeze);
      window.addEventListener('pageshow', this._onResume);
      window.addEventListener('online', this._onOnline);
    }
  }

  detachLifecycleListeners() {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;

    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this._onVisibility);
      document.removeEventListener('freeze', this._onFreeze);
      document.removeEventListener('resume', this._onResume);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pagehide', this._onFreeze);
      window.removeEventListener('pageshow', this._onResume);
      window.removeEventListener('online', this._onOnline);
    }
  }

  handleVisibility() {
    if (typeof document !== 'undefined' && document.hidden) {
      this.close();
    } else {
      this.openIfVisible();
    }
  }

  start() {
    this.active = true;
    this.consecutiveErrors = 0;
    this.attachLifecycleListeners();
    this.openIfVisible();
  }

  stop() {
    this.active = false;
    this.consecutiveErrors = 0;
    this.detachLifecycleListeners();
    this.close();
  }

  openIfVisible() {
    if (!this.active) return;
    if (this.eventSource) return;
    if (this.manager.isImpersonating) return;
    if (!this.manager.deviceId || !this.manager.currentComicId) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const EventSourceCtor = typeof EventSource !== 'undefined'
      ? EventSource
      : (typeof window !== 'undefined' ? window.EventSource : null);
    if (typeof EventSourceCtor !== 'function') return;

    const apiBaseUrl = (state && state.API_BASE_URL) || '';
    const url = `${apiBaseUrl}/api/v1/sync/stream?deviceId=${encodeURIComponent(this.manager.deviceId)}`;

    try {
      const es = new EventSourceCtor(url);
      this.eventSource = es;

      es.addEventListener('sync-update', (event) => {
        this.consecutiveErrors = 0;
        this.handleSyncEvent(event);
      });

      es.addEventListener('open', () => {
        this.consecutiveErrors = 0;
      });

      es.addEventListener('error', () => {
        this.consecutiveErrors += 1;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (offline || this.consecutiveErrors >= 3) {
          this.close();
          const offlineStatus = state?.OfflineStatus || (typeof window !== 'undefined' ? window.OfflineStatus : null);
          offlineStatus?.markAppOffline?.();
          offlineStatus?.scheduleConnectivityProbe?.();
        }
      });
    } catch {
      this.close();
    }
  }

  handleSyncEvent(event) {
    if (!event || !event.data) return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    const mgr = this.manager;
    if (!data || data.comicId !== mgr.currentComicId) return;
    if (data.lastSyncDeviceId && data.lastSyncDeviceId === mgr.deviceId) return;
    if (typeof data.lastReadPage !== 'number' || data.lastReadPage === mgr.lastKnownPage) return;

    const incomingTs = Number(data.lastSyncTimestamp) || 0;
    const knownTs = Number(mgr.lastKnownTimestamp) || 0;
    if (incomingTs <= knownTs) return;

    if (mgr.isSyncPointIgnored(data.comicId, incomingTs, data.lastReadPage, data.lastSyncDeviceId)) {
      return;
    }

    mgr.showSyncNotification({
      comicId: data.comicId,
      serverProgress: data,
      clientProgress: { lastReadPage: mgr.lastKnownPage }
    });
  }

  close() {
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
      this.eventSource = null;
    }
  }
}
