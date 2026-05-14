(function (global) {
  'use strict';

  if (!global.GuidedView) global.GuidedView = {};

  const modes = new Map();
  let activeModeName = null;
  let manualOverrideBox = null;

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

    async enable(name) {
      const mode = modes.get(name);
      if (!mode) return false;

      if (activeModeName && activeModeName !== name) {
        this.disable(activeModeName);
      }

      const success = await mode.enable();
      if (success) {
        activeModeName = name;
        this.persistOnlyMode(global.currentComic, name);
      }
      return success;
    },

    disable(name) {
      const mode = modes.get(name);
      if (mode) {
        mode.disable();
        if (activeModeName === name) {
          activeModeName = null;
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
        'hot-zoom': 'hotZoomMode',
        'manga-bubble-hot': 'mangaBubbleHotMode'
      };

      Object.entries(modeMapping).forEach(([key, prefKey]) => {
        if (kept !== key && comic[prefKey]) {
          comic[prefKey] = false;
          global.updateComicInLibrary?.(comic.id, { [prefKey]: false });
          this.saveModePreference(comic.id, key, false);
        }
      });
    },

    async saveModePreference(comicId, modeName, value) {
      const endpointMap = {
        'guided': 'guided-mode',
        'bubble': 'bubble-mode',
        'hot-zoom': 'hot-zoom-mode',
        'manga-bubble-hot': 'manga-bubble-hot-mode'
      };
      
      const endpoint = endpointMap[modeName];
      if (!endpoint) return;

      try {
        const body = {};
        const prefKey = modeName === 'guided' ? 'guidedMode' : 
                        modeName === 'bubble' ? 'bubbleMode' :
                        modeName === 'hot-zoom' ? 'hotZoomMode' : 'mangaBubbleHotMode';
        body[prefKey] = !!value;

        await fetch(global.GuidedView.api(`/api/v1/comics/${encodeURIComponent(comicId)}/${endpoint}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch (_) { /* non-fatal */ }
    }
  };

  global.GuidedView.ModeRegistry = ModeRegistry;

})(typeof window !== 'undefined' ? window : globalThis);
