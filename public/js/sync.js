/**
 * Comics Now! - Sync Coordinator Facade
 *
 * Coordinates device identity, remote progress sync, conflict modals, and library status counts.
 */

import { state, debugLog } from './globals.js';
import { SyncManager } from './sync/manager.js';
import { updateLocalProgressAndCounts } from './sync/library-counts.js';

export {
  SyncManager,
  updateLocalProgressAndCounts
};

export const syncManager = new SyncManager();
export default syncManager;

if (typeof state !== 'undefined') {
  state.syncManager = syncManager;
}

if (typeof window !== 'undefined') {
  window.syncManager = syncManager;
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
      try {
        await syncManager.initialize();
        debugLog('SYNC', 'Sync manager initialization completed in background');

        const showBadgeFn = state.showUserBadge || (typeof window !== 'undefined' ? window.showUserBadge : null);
        if (typeof showBadgeFn === 'function') {
          showBadgeFn();
        }

        const hideAdminUIFn = state.hideAdminUI || (typeof window !== 'undefined' ? window.hideAdminUI : null);
        if (typeof hideAdminUIFn === 'function') {
          hideAdminUIFn();
        }
      } catch (_) {}
    }, 100);
  });
}
