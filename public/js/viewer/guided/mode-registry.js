(function (global) {
  'use strict';

  if (!global.GuidedView) global.GuidedView = {};

  const modes = new Map();
  let activeModeName = null;
  let manualOverrideBox = null;
  let transitioning = false;

  const ModeRegistry = {
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
        this.persistOnlyMode(global.currentComic, name);

        const success = await mode.enable();
        if (!success) {
          activeModeName = null;
          global.GuidedView.refreshRender?.();
        }
        return success;
      } finally {
        transitioning = false;
      }
    },

    disable(name) {
      const mode = modes.get(name);
      if (mode) {
        mode.disable();
        if (activeModeName === name) {
          activeModeName = null;
          this.persistOnlyMode(global.currentComic, null);
        }
      }
      manualOverrideBox = null;
    },

    disableAll() {
      if (activeModeName) {
        this.disable(activeModeName);
      }
      this.persistOnlyMode(global.currentComic, null);
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
          global.updateComicInLibrary?.(comic.id, { [prefKey]: true });
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
          global.updateComicInLibrary?.(comic.id, { [prefKey]: false });
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

  global.GuidedView.ModeRegistry = ModeRegistry;

})(typeof window !== 'undefined' ? window : globalThis);
