(function (global) {
  'use strict';

  let active = false;
  let hotZoomIndex = -1;

  const WesternSpeechZoomMode = {
    async enable() {
      if (!global.GuidedView.isFullscreenOpen()) return false;
      const comic = global.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode) return false;
      const data = await global.GuidedView.loadGuidedView(comic.id);
      if (!data) return false;

      active = true;
      hotZoomIndex = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
      return true;
    },

    disable() {
      active = false;
      hotZoomIndex = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
    },

    toggle() {
      return global.GuidedView.ModeRegistry.toggle('western-speech-zoom');
    },

    updateUI() {
      global.GuidedView.updateWesternSpeechZoomUI(active);
    },

    isActive() {
      return active;
    },

    getRenderState() {
      if (!active) return { targetBox: null, isPanelZoom: false };

      const bubbles = global.GuidedView.currentPageBubbles();
      let targetBox = null;
      if (hotZoomIndex >= 0 && hotZoomIndex < bubbles.length) {
        targetBox = bubbles[hotZoomIndex];
      }

      return { targetBox, isPanelZoom: false };
    },

    tryAdvance(direction) {
      return false;
    },

    onPageRendered() {
      if (active) {
        hotZoomIndex = -1;
      }
    },

    handleImageClick(nx, ny) {
      if (!active) return false;

      const bubbles = global.GuidedView.currentPageBubbles();
      let bestIndex = -1, minArea = Infinity;
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          const area = bw * bh;
          if (area < minArea) { minArea = area; bestIndex = i; }
        }
      }
      if (bestIndex !== -1) {
        hotZoomIndex = (hotZoomIndex === bestIndex) ? -1 : bestIndex;
        global.GuidedView.refreshRender();
        return true;
      } else if (hotZoomIndex !== -1) {
        hotZoomIndex = -1;
        global.GuidedView.refreshRender();
        return true;
      }
      return false;
    }
  };

  global.GuidedView.ModeRegistry.register('western-speech-zoom', WesternSpeechZoomMode);

})(typeof window !== 'undefined' ? window : globalThis);
