/**
 * Tag Comics Now! Scope Switcher (Material Design 3 Segmented Control)
 *
 * Partitions tagger management into 3 focused admin scopes:
 *   1. 'scanner': Active scanning loop, live output, interactive matches review, and scan history.
 *   2. 'sources': Pipeline configuration, metadata sources, confidence thresholds, and Gemini AI.
 *   3. 'organize': Inbox operations, naming rules, folder hierarchy, and session error diagnostics.
 */

export const CT_SCOPES = {
  scanner: {
    id: 'scanner',
    label: 'Scanner & Review',
    icon: '🔍',
    defaultTab: 'output',
    tabs: ['output', 'matches', 'logs']
  },
  sources: {
    id: 'sources',
    label: 'Sources & AI',
    icon: '⚙️',
    defaultTab: 'settings',
    tabs: ['settings', 'story-arcs', 'gemini']
  },
  organize: {
    id: 'organize',
    label: 'File Organization',
    icon: '🗂️',
    defaultTab: 'operations',
    tabs: ['operations', 'name', 'folder', 'errors']
  }
};

export const CT_TAB_TO_SCOPE = {
  'output': 'scanner',
  'matches': 'scanner',
  'logs': 'scanner',
  'settings': 'sources',
  'story-arcs': 'sources',
  'gemini': 'sources',
  'management': 'organize',
  'operations': 'organize',
  'name': 'organize',
  'folder': 'organize',
  'errors': 'organize'
};

let currentCtScope = 'scanner';

export function getCtScope() {
  return currentCtScope;
}

export function setCtScope(scopeId, opts = {}) {
  if (!CT_SCOPES[scopeId]) return;
  currentCtScope = scopeId;

  // 1. Update Scope buttons trade dress
  const scopeBtns = document.querySelectorAll('#ct-scope-bar .ct-scope-btn');
  scopeBtns.forEach(btn => {
    const isTarget = btn.getAttribute('data-ct-scope') === scopeId;
    if (isTarget) {
      btn.classList.add('bg-amber-500', 'text-black', 'shadow-xs', 'font-bold');
      btn.classList.remove('text-gray-300', 'hover:text-white', 'hover:bg-gray-800');
    } else {
      btn.classList.remove('bg-amber-500', 'text-black', 'shadow-xs', 'font-bold');
      btn.classList.add('text-gray-300', 'hover:text-white', 'hover:bg-gray-800');
    }
  });

  // 2. Toggle visible tab groups
  Object.keys(CT_SCOPES).forEach(id => {
    const groupEl = document.getElementById(`ct-scope-${id}-tabs`);
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
    const scopeDef = CT_SCOPES[scopeId];
    if (scopeDef && scopeDef.defaultTab) {
      const targetTabBtn = scopeDef.id === 'organize'
        ? document.getElementById(`mgmt-tab-${scopeDef.defaultTab}`)
        : document.getElementById(`ct-tab-${scopeDef.defaultTab}`);
      if (targetTabBtn && typeof targetTabBtn.click === 'function') {
        targetTabBtn.click();
      }
    }
  }
}

export function syncCtScopeWithActiveTab(tabName) {
  if (!tabName) return;
  const targetScope = CT_TAB_TO_SCOPE[tabName];
  if (targetScope && targetScope !== currentCtScope) {
    setCtScope(targetScope, { activateDefaultTab: false });
  }
}

export function initCtScopeSwitcher() {
  const scopeBtns = document.querySelectorAll('#ct-scope-bar .ct-scope-btn');
  scopeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const scopeId = btn.getAttribute('data-ct-scope');
      if (scopeId) {
        setCtScope(scopeId, { activateDefaultTab: true });
      }
    });
  });

  setCtScope(currentCtScope, { activateDefaultTab: false });
}
