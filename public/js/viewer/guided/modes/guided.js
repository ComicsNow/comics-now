(function (global) {
  'use strict';

  let active = false;
  let panelIndex = -1;

  const GuidedMode = {
    async enable() {
      if (!global.GuidedView.isFullscreenOpen()) return false;
      const comic = global.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed') return false;
      const data = await global.GuidedView.loadGuidedView(comic.id);
      if (!data) return false;

      active = true;
      panelIndex = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
      return true;
    },

    disable() {
      active = false;
      panelIndex = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
    },

    toggle() {
      return global.GuidedView.ModeRegistry.toggle('guided');
    },

    updateUI() {
      global.GuidedView.updateToggleUI(active);
    },

    isActive() {
      return active;
    },

    getRenderState() {
      if (!active) return { targetBox: null, isPanelZoom: false };

      let targetBox = null;
      let isPanelZoom = false;

      if (!global.GuidedView.isMangaComic()) {
        const sequence = global.GuidedView.currentPagePanels();
        if (panelIndex >= 0 && panelIndex < sequence.length) {
          targetBox = sequence[panelIndex];
        }
      }
      // For Manga, the target box is handled by applyTransform in refreshRender,
      // but we still need to know if we are in a panel zoom state for some UI/overlay logic if needed.
      // Actually, looking at index.js:
      // if (needsMangaLayout) {
      //   const panels = global.GuidedView.currentPagePanels();
      //   const currentTarget = (panelIndex >= 0 && panelIndex < panels.length) ? panels[panelIndex] : null;
      //   global.GuidedView.applyTransform(currentTarget, isManga);
      // }
      
      return { targetBox, isPanelZoom };
    },

    getPanelIndex() {
      return panelIndex;
    },

    tryAdvance(direction) {
      if (!active) return false;
      if (!global.GuidedView.isFullscreenOpen()) {
        this.disable();
        return false;
      }

      const panels = global.GuidedView.currentPagePanels();
      if (panels.length === 0) return false;

      if (direction > 0) {
        if (panelIndex >= panels.length - 1) return false;
        panelIndex += 1;
        global.GuidedView.refreshRender();
        return true;
      }
      if (direction < 0) {
        if (panelIndex <= -1) return false;
        panelIndex -= 1;
        global.GuidedView.refreshRender();
        return true;
      }
      return false;
    },

    onPageRendered() {
      if (active) {
        panelIndex = -1;
      }
    },

    handleImageClick(nx, ny) {
      // Guided sequential mode usually doesn't have specific click-to-zoom 
      // in the same way Hot Zoom does, but it consumes clicks if needed.
      // In index.js, handleImageClick didn't have specific logic for 'active'
      // other than checking if any mode is active to potentially consume/ignore.
    }
  };

  global.GuidedView.ModeRegistry.register('guided', GuidedMode);

})(typeof window !== 'undefined' ? window : globalThis);
