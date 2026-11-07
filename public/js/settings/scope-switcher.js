/**
 * Comics Now! - Mobile-First Settings Scope Switcher
 *
 * Partitions settings into 3 logical scopes:
 * 1. My Reader (Personal preferences: Reading Defaults, Downloads, Devices)
 * 2. Server Admin (Admin only: Storage/Folders, Users & Access, Diagnostics Logs)
 * 3. AI Engines (Admin only: Story Arcs & Reading Orders, Guided View)
 */
import { state } from '../globals.js';

export function initSettingsScopeSwitcher() {
  const scopeBar = document.getElementById('settings-scope-bar');
  if (!scopeBar) return;

  const userRole = (typeof state !== 'undefined' && state?.syncManager && state.syncManager.userRole) ||
                   (typeof window !== 'undefined' && window.syncManager && window.syncManager.userRole);
  const isAuthEnabled = (typeof state !== 'undefined' && typeof state.isAuthEnabled === 'function') ? state.isAuthEnabled() : true;
  const isAdmin = userRole === 'admin' || !isAuthEnabled;

  const doc = (typeof document !== 'undefined' ? document : null) || (typeof window !== 'undefined' ? window.document : null);
  const adminButtons = doc ? doc.querySelectorAll('.admin-only-scope') : [];
  adminButtons.forEach(btn => {
    btn.classList.toggle('hidden', !isAdmin);
  });

  const scopeButtons = scopeBar.querySelectorAll('button[data-scope]');
  scopeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const scope = btn.getAttribute('data-scope');
      setSettingsScope(scope);
    });
  });

  // If active tab belongs to a specific scope, ensure that scope is visible
  syncScopeWithActiveTab();

  initSettingsBridges();
}

export function initSettingsBridges() {
  const bridgeToTagger = document.getElementById('bridge-to-tagger-btn');
  if (bridgeToTagger && !bridgeToTagger.__bridgeBound) {
    bridgeToTagger.__bridgeBound = true;
    bridgeToTagger.addEventListener('click', () => {
      const g = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {});
      g.closeSettingsModal?.();
      g.openCTModal?.();
      document.getElementById('ct-tab-settings')?.click();
    });
  }

  const bridgeToStoryArcs = document.getElementById('bridge-to-story-arcs-settings-btn');
  if (bridgeToStoryArcs && !bridgeToStoryArcs.__bridgeBound) {
    bridgeToStoryArcs.__bridgeBound = true;
    bridgeToStoryArcs.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const g = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {});
      g.closeCTModal?.();
      g.openSettingsModal?.();
      setSettingsScope('engines');
      document.getElementById('settings-tab-story-arcs')?.click();
    });
  }
}

export function setSettingsScope(scope) {
  const scopeBar = document.getElementById('settings-scope-bar');
  if (!scopeBar) return;

  const buttons = scopeBar.querySelectorAll('button[data-scope]');
  buttons.forEach(btn => {
    const isCurrent = btn.getAttribute('data-scope') === scope;
    if (isCurrent) {
      btn.classList.add('bg-amber-500', 'text-black', 'shadow-xs');
      btn.classList.remove('text-gray-300');
    } else {
      btn.classList.remove('bg-amber-500', 'text-black', 'shadow-xs');
      btn.classList.add('text-gray-300');
    }
  });

  const readerTabs = document.getElementById('settings-scope-reader-tabs');
  const serverTabs = document.getElementById('settings-scope-server-tabs');
  const enginesTabs = document.getElementById('settings-scope-engines-tabs');

  if (readerTabs) readerTabs.classList.toggle('hidden', scope !== 'reader');
  if (serverTabs) serverTabs.classList.toggle('hidden', scope !== 'server');
  if (enginesTabs) enginesTabs.classList.toggle('hidden', scope !== 'engines');

  // Activate first tab in the scope if none in this scope is currently active
  const targetGroup = scope === 'server' ? serverTabs : (scope === 'engines' ? enginesTabs : readerTabs);
  if (targetGroup) {
    const activeTab = targetGroup.querySelector('.tab-button.active');
    if (!activeTab) {
      const firstTab = targetGroup.querySelector('.tab-button');
      if (firstTab) firstTab.click();
    }
  }
}

export function syncScopeWithActiveTab() {
  const activeTab = document.querySelector('#settings-tabs-row .tab-button.active');
  if (!activeTab) {
    setSettingsScope('reader');
    return;
  }

  const parentGroup = activeTab.closest('.scope-tabs-group');
  if (parentGroup) {
    if (parentGroup.id === 'settings-scope-server-tabs') {
      setSettingsScope('server');
    } else if (parentGroup.id === 'settings-scope-engines-tabs') {
      setSettingsScope('engines');
    } else {
      setSettingsScope('reader');
    }
  }
}
