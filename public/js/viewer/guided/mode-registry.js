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

  async enable(name) {
    if (transitioning) return false;
    const mode = modes.get(name);
    if (!mode) return false;
    if (activeModeName === name) return true;

    transitioning = true;
    try {
      if (activeModeName) {
        // Synchronously clear the old state variables and internal flags
        this.disable(activeModeName);
      }

      // Pre-set the active mode name so that any refreshRender() calls 
      // triggered inside mode.enable() correctly identify the new mode.
      activeModeName = name;

      // Persist the intent immediately so that concurrent lifecycle checks 
      // (e.g. from resize or orientation changes) don't try to revert us.
      const currentComic = state.currentComic || window.currentComic;
      this.persistOnlyMode(currentComic, name);

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

  disable(name) {
    const mode = modes.get(name);
    if (mode) {
      // IMPORTANT: Clear the state BEFORE calling the cleanup.
      // This ensures that the re-render triggered inside mode.disable()
      // correctly sees that there is NO active mode.
      if (activeModeName === name) {
        activeModeName = null;
        const currentComic = state.currentComic || window.currentComic;
        this.persistOnlyMode(currentComic, null);
      }
      mode.disable();
    }
    manualOverrideBox = null;
  },

  disableAll() {
    if (activeModeName) {
      this.disable(activeModeName);
    }
    const currentComic = state.currentComic || window.currentComic;
    this.persistOnlyMode(currentComic, null);
  },

  toggle(name) {
    if (activeModeName === name) {
      this.disable(name);
      return false;
    }
    return this.enable(name);
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

    // Set the kept mode to true
    if (kept && modeMapping[kept]) {
      const prefKey = modeMapping[kept];
      if (!comic[prefKey]) {
        comic[prefKey] = true;
        const updateComic = state.updateComicInLibrary || window.updateComicInLibrary;
        updateComic?.(comic.id, { [prefKey]: true });
        this.saveModePreference(comic.id, kept, true);
      }
      // Persist to local storage per-comic
      try {
        localStorage.setItem(`guided_pref_${comic.id}`, kept);
      } catch (e) { /* ignore */ }
    } else if (kept === null) {
      // Clear preference if disabling all
      try {
        localStorage.removeItem(`guided_pref_${comic.id}`);
      } catch (e) { /* ignore */ }
    }

    // Clear all other modes
    Object.entries(modeMapping).forEach(([key, prefKey]) => {
      if (kept !== key && comic[prefKey]) {
        comic[prefKey] = false;
        const updateComic = state.updateComicInLibrary || window.updateComicInLibrary;
        updateComic?.(comic.id, { [prefKey]: false });
        this.saveModePreference(comic.id, key, false);
      }
    });
  },

  async saveModePreference(comicId, modeName, value) {
    // Local storage is the primary source of truth for "remembering"
    try {
      if (value) {
        localStorage.setItem(`guided_pref_${comicId}`, modeName);
      } else {
        const current = localStorage.getItem(`guided_pref_${comicId}`);
        if (current === modeName) {
          localStorage.removeItem(`guided_pref_${comicId}`);
        }
      }
    } catch (e) { /* ignore */ }
  }
};

state.GuidedView.ModeRegistry = ModeRegistry;
if (typeof window !== 'undefined') {
  window.GuidedView.ModeRegistry = ModeRegistry;
}
