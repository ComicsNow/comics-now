import { state, global as canonicalGlobal, actions } from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});
const actionsRef = (typeof actions !== 'undefined' && actions?.navigation) ? actions : global?.actions;

export function filterLibrary(originalLibrary, filter) {
  return originalLibrary;
}

export function goToInitialView() {
  if (typeof window.closeFullscreen === 'function') {
    try {
      window.closeFullscreen();
    } catch (e) {
      console.error('Failed to close fullscreen viewer:', e);
    }
  }

  if (typeof window.closeSettingsModal === 'function') {
    try {
      window.closeSettingsModal();
    } catch (e) {}
  }
  if (typeof window.closeCTModal === 'function') {
    try {
      window.closeCTModal();
    } catch (e) {}
  }
  if (typeof window.closeReadingListModal === 'function') {
    try {
      window.closeReadingListModal();
    } catch (e) {}
  }
  if (window.ReadingLists && typeof window.ReadingLists.closeAddToListModal === 'function') {
    try {
      window.ReadingLists.closeAddToListModal();
    } catch (e) {}
  }

  ['directory-selection-modal', 'settings-modal', 'ct-modal', 'reading-list-modal', 'add-to-list-modal'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  if (actionsRef?.navigation?.setFilter) {
    actionsRef.navigation.setFilter('smart', null);
    actionsRef.navigation.setFilter('status', 'all');
  } else {
    global.activeSmartFilter = null;
    global.activeFilter = 'all';
  }
  if (typeof window !== 'undefined') {
    window.activeSmartFilter = null;
    window.activeFilter = 'all';
  }

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active', 'bg-purple-600');
    btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
  });
  const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
  if (allBtn) {
    allBtn.classList.add('active', 'bg-purple-600');
    allBtn.classList.remove('bg-gray-700', 'hover:bg-gray-600');
  }

  if (typeof window !== 'undefined') {
    window.currentRootFolder = null;
    window.currentPublisher = null;
    window.currentSeries = null;
    window.currentFolderPath = null;
  }
  global.currentRootFolder = null;
  global.currentPublisher = null;
  global.currentSeries = null;
  global.currentFolderPath = null;

  if (typeof global.updateFilterButtonCounts === 'function') global.updateFilterButtonCounts();
  if (typeof global.showRootFolderList === 'function') {
    global.showRootFolderList({ force: true });
  }

  if (!global._isNavigatingFromRouter && global.router) {
    global.router.navigate('/', true);
  }
}

if (typeof window !== 'undefined') window.goToInitialView = goToInitialView;

export function handleFilterClick(event) {
  const button = event.target.closest('.filter-btn');
  if (!button) return;

  const allButtons = document.querySelectorAll('.filter-btn');
  allButtons.forEach(btn => {
    btn.classList.remove('active', 'bg-purple-600');
    btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
  });

  button.classList.add('active', 'bg-purple-600');
  button.classList.remove('bg-gray-700', 'hover:bg-gray-600');

  const filter = button.dataset.filter || 'all';
  if (actionsRef?.navigation?.setFilter) {
    actionsRef.navigation.setFilter('status', filter);
  } else {
    global.activeFilter = filter;
  }
  if (typeof window !== 'undefined') window.activeFilter = filter;

  if (filter === 'all') {
    if (typeof global.goToInitialView === 'function') {
      return global.goToInitialView();
    }
  }

  if (typeof global.updateFilterButtonCounts === 'function') {
    global.updateFilterButtonCounts();
  }
  
  const currentSmartFilter = global.activeSmartFilter || null;
  if (currentSmartFilter && typeof global._renderForActiveScope === 'function') {
    global._renderForActiveScope(currentSmartFilter);
  } else if (typeof global.applyFilterAndRender === 'function') {
    global.applyFilterAndRender();
  }
}
