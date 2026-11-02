import { state, global as canonicalGlobal } from './globals.js';
import { filterLibrary, goToInitialView, handleFilterClick } from './library/navigation.js';
import { initSmartScopeControls } from './library/smart-scope.js';
import { initSearchControls, initModeToggleControls, initDayRolloverWatcher } from './library/search-controls.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export function initializeLibraryUIControls() {
  if (global.filterButtonsDiv && !global.filterButtonsDiv._filterListener) {
    global.filterButtonsDiv._filterListener = handleFilterClick;
    global.filterButtonsDiv.addEventListener('click', global.filterButtonsDiv._filterListener);
  }

  if (typeof global.initSeriesSortControls === 'function') {
    global.initSeriesSortControls();
  }

  initSmartScopeControls();
  initSearchControls();
  initModeToggleControls();
  initDayRolloverWatcher();

  global.debugLog?.('UI', 'Library controls initialized');
}

export {
  filterLibrary,
  goToInitialView,
  handleFilterClick
};

state.filterLibrary = filterLibrary;
state.goToInitialView = goToInitialView;
state.handleFilterClick = handleFilterClick;
state.initializeLibraryUIControls = initializeLibraryUIControls;

if (typeof window !== 'undefined') {
  window.filterLibrary = filterLibrary;
  window.goToInitialView = goToInitialView;
  window.handleFilterClick = handleFilterClick;
  window.initializeLibraryUIControls = initializeLibraryUIControls;
}
