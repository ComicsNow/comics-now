/**
 * Settings Scope Switcher (Approach A - Material Design 3 Segmented Control)
 *
 * Partitions settings into 3 focused scopes:
 *   1. 'reader': Personal reading experience, offline downloads, synced devices.
 *   2. 'server': Core storage, libraries, users & permissions, server diagnostics.
 *   3. 'engines': Background pipelines (Story Arcs crawler, Guided View GPU runner).
 */

export const SCOPES = {
  reader: {
    id: 'reader',
    label: 'My Reader',
    icon: '📖',
    adminOnly: false,
    defaultTab: 'comics-defaults',
    tabs: ['comics-defaults', 'downloads', 'devices']
  },
  server: {
    id: 'server',
    label: 'Server Admin',
    icon: '⚙️',
    adminOnly: true,
    defaultTab: 'general',
    tabs: ['general', 'users', 'logs']
  },
  engines: {
    id: 'engines',
    label: 'AI Engines',
    icon: '⚡',
    adminOnly: true,
    defaultTab: 'story-arcs',
    tabs: ['story-arcs', 'guided-reader']
  }
};

export const TAB_TO_SCOPE = {
  'comics-defaults': 'reader',
  'downloads': 'reader',
  'devices': 'reader',
  'general': 'server',
  'users': 'server',
  'logs': 'server',
  'story-arcs': 'engines',
  'guided-reader': 'engines'
};

let currentScope = 'reader';

export function getSettingsScope() {
  return currentScope;
}

export function setSettingsScope(scopeId, opts = {}) {
  if (!SCOPES[scopeId]) return;
  currentScope = scopeId;

  // 1. Update Scope buttons trade dress
  const scopeBtns = document.querySelectorAll('#settings-scope-bar .scope-btn');
  scopeBtns.forEach(btn => {
    const isTarget = btn.getAttribute('data-scope') === scopeId;
    if (isTarget) {
      btn.classList.add('bg-amber-500', 'text-black', 'shadow-xs', 'font-bold');
      btn.classList.remove('text-gray-300', 'hover:text-white', 'hover:bg-gray-800');
    } else {
      btn.classList.remove('bg-amber-500', 'text-black', 'shadow-xs', 'font-bold');
      btn.classList.add('text-gray-300', 'hover:text-white', 'hover:bg-gray-800');
    }
  });

  // 2. Toggle visible tab groups
  Object.keys(SCOPES).forEach(id => {
    const groupEl = document.getElementById(`settings-scope-${id}-tabs`);
    if (groupEl) {
      if (id === scopeId) {
        groupEl.classList.remove('hidden');
        groupEl.style.display = 'flex';
      } else {
        groupEl.classList.add('hidden');
        groupEl.style.display = 'none';
      }
    }
  });

  // 3. Switch to default tab if specified or current tab is outside this scope
  if (opts.activateDefaultTab) {
    const scopeDef = SCOPES[scopeId];
    if (scopeDef && scopeDef.defaultTab) {
      const targetTabBtn = document.getElementById(`settings-tab-${scopeDef.defaultTab}`);
      if (targetTabBtn && typeof targetTabBtn.click === 'function') {
        targetTabBtn.click();
      }
    }
  }
}

export function syncScopeWithActiveTab(tabName) {
  if (!tabName) return;
  const targetScope = TAB_TO_SCOPE[tabName];
  if (targetScope && targetScope !== currentScope) {
    setSettingsScope(targetScope, { activateDefaultTab: false });
  }
}

export function initSettingsScopeSwitcher() {
  const scopeBar = document.getElementById('settings-scope-bar');
  if (!scopeBar || scopeBar.dataset.scopeInitialized === 'true') return;

  scopeBar.dataset.scopeInitialized = 'true';
  const scopeBtns = scopeBar.querySelectorAll('.scope-btn');

  scopeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const scope = btn.getAttribute('data-scope');
      if (scope) {
        setSettingsScope(scope, { activateDefaultTab: true });
      }
    });
  });

  // Set initial scope
  setSettingsScope('reader', { activateDefaultTab: false });
}
