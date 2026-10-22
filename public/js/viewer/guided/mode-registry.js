import { state } from '../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

const modes = new Map();
let activeModeName = null;
let manualOverrideBox = null;
let transitioning = false;

export const ModeRegistry = {
  register(name, mode) {
    modes.set(name, mode);
  },

  get(name) {
    return modes.get(name);
  },

  getActiveMode() {
    return activeModeName ? modes.get(activeModeName) : null;
  },

  getActiveModeName() {
    return activeModeName;
  },

  isTransitioning() {
    return transitioning;
  },

  async enable(name, { persist = true } = {}) {
    if (transitioning) return false;
    const mode = modes.get(name);
    if (!mode) return false;
    if (activeModeName === name) return true;

    transitioning = true;
    try {
      if (activeModeName) {
        // Synchronously clear the old state variables and internal flags without clearing preference
        this.disable(activeModeName, { persist: false });
      }

      // If continuous mode is currently active, automatically disable it as the two cannot work together
      const isContinuous = !!(state.isContinuousMode || (typeof window !== 'undefined' && window.isContinuousMode));
      if (isContinuous) {
        const disableContinuousMode = state.disableContinuousMode || (typeof window !== 'undefined' && window.disableContinuousMode);
        if (typeof disableContinuousMode === 'function') {
          await disableContinuousMode();
        }
        const currentComic = state.currentComic || (typeof window !== 'undefined' && window.currentComic);
        if (currentComic) {
          currentComic.continuousMode = false;
          const updateComic = state.updateComicInLibrary || (typeof window !== 'undefined' && window.updateComicInLibrary);
          updateComic?.(currentComic.id, { continuousMode: false });
        }
      }

      // Pre-set the active mode name so that any refreshRender() calls 
      // triggered inside mode.enable() correctly identify the new mode.
      activeModeName = name;

      // Persist the intent immediately so that concurrent lifecycle checks 
      // (e.g. from resize or orientation changes) don't try to revert us.
      if (persist) {
        const currentComic = state.currentComic || window.currentComic;
        this.persistOnlyMode(currentComic, name);
      }

      const success = await mode.enable();
      if (!success) {
        activeModeName = null;
        state.GuidedView.refreshRender?.();
      }
      return success;
    } finally {
      transitioning = false;
    }
  },

  disable(name, { persist = true } = {}) {
    const mode = modes.get(name);
    if (mode) {
      // IMPORTANT: Clear the state BEFORE calling the cleanup.
      // This ensures that the re-render triggered inside mode.disable()
      // correctly sees that there is NO active mode.
      if (activeModeName === name) {
        activeModeName = null;
        if (persist) {
          const currentComic = state.currentComic || window.currentComic;
          this.persistOnlyMode(currentComic, null);
        }
      }
      mode.disable();
    }
    manualOverrideBox = null;
  },

  disableAll({ persist = false } = {}) {
    const prevModeName = activeModeName;
    activeModeName = null;
    manualOverrideBox = null;

    if (persist) {
      const currentComic = state.currentComic || window.currentComic;
      this.persistOnlyMode(currentComic, null);
    }

    if (prevModeName) {
      const mode = modes.get(prevModeName);
      if (mode) mode.disable();
    }

    // Force complete cleanup of CSS classes and overlays
    if (typeof state.GuidedView?.refreshRender === 'function') {
      state.GuidedView.refreshRender();
    } else {
      const stage = document.getElementById('fullscreen-viewer');
      if (stage) {
        stage.classList.remove('guided-stage');
        stage.classList.remove('guided-zoom-no-touchmenu');
      }
      const overlay = document.getElementById('bubble-magnifier-overlay');
      if (overlay) {
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
      }
    }
  },

  toggle(name) {
    if (activeModeName === name) {
      this.disable(name, { persist: true });
      return false;
    }
    return this.enable(name, { persist: true });
  },

  setManualOverrideBox(box) {
    manualOverrideBox = box;
  },

  getManualOverrideBox() {
    return manualOverrideBox;
  },

  persistOnlyMode(comic, kept) {
    if (!comic) return;
    
    const modeMapping = {
      'guided': 'guidedMode',
      'bubble': 'bubbleMode',
      'western-speech-zoom': 'hotZoomMode',
      'manga-panel-zoom': 'hotZoomMode',
      'manga-speech-zoom': 'mangaBubbleHotMode'
    };

    const keptPrefKey = (kept && modeMapping[kept]) ? modeMapping[kept] : null;

    // Set the kept mode to true
    if (kept && modeMapping[kept]) {
      const prefKey = modeMapping[kept];
      comic[prefKey] = true;
      const updateComic = state.updateComicInLibrary || window.updateComicInLibrary;
      updateComic?.(comic.id, { [prefKey]: true });
      this.saveModePreference(comic.id, kept, true);
    } else if (kept === null || kept === 'none') {
      // User explicitly turned off guided mode
      this.saveModePreference(comic.id, null, false);
    }

    // Clear all other modes
    const allPrefKeys = new Set(Object.values(modeMapping));
    allPrefKeys.forEach(prefKey => {
      if (prefKey !== keptPrefKey && comic[prefKey]) {
        comic[prefKey] = false;
        const updateComic = state.updateComicInLibrary || window.updateComicInLibrary;
        updateComic?.(comic.id, { [prefKey]: false });
      }
    });
  },

  async saveModePreference(comicId, modeName, value) {
    // Local storage is the primary source of truth for "remembering"
    try {
      if (value && modeName) {
        localStorage.setItem(`guided_pref_${comicId}`, modeName);
        localStorage.setItem('guided_pref_last_mode', modeName);
        localStorage.setItem('guided_pref_global_active', 'true');
      } else {
        localStorage.setItem(`guided_pref_${comicId}`, 'none');
        localStorage.setItem('guided_pref_global_active', 'false');
      }
    } catch (e) { /* ignore */ }
  }
};

state.GuidedView.ModeRegistry = ModeRegistry;
if (typeof window !== 'undefined') {
  window.GuidedView.ModeRegistry = ModeRegistry;
}
