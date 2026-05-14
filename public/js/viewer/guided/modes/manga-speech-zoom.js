(function (global) {
  'use strict';

  let active = false;
  let mangaSpeechZoomIdx = -1;

  const MangaSpeechZoomMode = {
    async enable() {
      if (!global.GuidedView.isFullscreenOpen()) return false;
      const comic = global.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed') return false;
      if (!comic.mangaMode) return false;
      const data = await global.GuidedView.loadGuidedView(comic.id);
      if (!data) return false;

      active = true;
      mangaSpeechZoomIdx = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
      return true;
    },

    disable() {
      active = false;
      mangaSpeechZoomIdx = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
    },

    toggle() {
      return global.GuidedView.ModeRegistry.toggle('manga-speech-zoom');
    },

    updateUI() {
      global.GuidedView.updateMangaSpeechZoomUI(active);
    },

    isActive() {
      return active;
    },

    getRenderState() {
      if (!active) return { targetBox: null, isPanelZoom: false };

      const bubbles = global.GuidedView.mangaPageBubbles();
      let targetBox = null;
      if (mangaSpeechZoomIdx >= 0 && mangaSpeechZoomIdx < bubbles.length) {
        targetBox = bubbles[mangaSpeechZoomIdx];
      }
      return { targetBox, isPanelZoom: false };
    },

    tryAdvance(direction) {
      return false;
    },

    onPageRendered() {
      if (active) {
        mangaSpeechZoomIdx = -1;
      }
    },

    handleImageClick(nx, ny) {
      if (!active) return false;

      const bubbles = global.GuidedView.mangaPageBubbles();
      let bestIdx = -1, minArea = Infinity;
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          const area = bw * bh;
          if (area < minArea) { minArea = area; bestIdx = i; }
        }
      }
      if (bestIdx !== -1) {
        mangaSpeechZoomIdx = (mangaSpeechZoomIdx === bestIdx) ? -1 : bestIdx;
        global.GuidedView.refreshRender();
        return true;
      }
      if (mangaSpeechZoomIdx !== -1) {
        mangaSpeechZoomIdx = -1;
        global.GuidedView.refreshRender();
        return true;
      }
      return false;
    }
  };

  global.GuidedView.ModeRegistry.register('manga-speech-zoom', MangaSpeechZoomMode);

})(typeof window !== 'undefined' ? window : globalThis);
