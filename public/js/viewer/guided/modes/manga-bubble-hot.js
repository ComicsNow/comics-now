(function (global) {
  'use strict';

  let active = false;
  let mangaBubbleHotIdx = -1;

  const MangaBubbleHotMode = {
    async enable() {
      if (!global.GuidedView.isFullscreenOpen()) return false;
      const comic = global.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed') return false;
      if (!comic.mangaMode) return false;
      const data = await global.GuidedView.loadGuidedView(comic.id);
      if (!data) return false;

      active = true;
      mangaBubbleHotIdx = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
      return true;
    },

    disable() {
      active = false;
      mangaBubbleHotIdx = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
    },

    toggle() {
      return global.GuidedView.ModeRegistry.toggle('manga-bubble-hot');
    },

    updateUI() {
      global.GuidedView.updateMangaBubbleHotUI(active);
    },

    isActive() {
      return active;
    },

    getRenderState() {
      if (!active) return { targetBox: null, isPanelZoom: false };

      const bubbles = global.GuidedView.mangaPageBubbles();
      let targetBox = null;
      if (mangaBubbleHotIdx >= 0 && mangaBubbleHotIdx < bubbles.length) {
        targetBox = bubbles[mangaBubbleHotIdx];
      }
      return { targetBox, isPanelZoom: false };
    },

    tryAdvance(direction) {
      return false;
    },

    onPageRendered() {
      if (active) {
        mangaBubbleHotIdx = -1;
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
        mangaBubbleHotIdx = (mangaBubbleHotIdx === bestIdx) ? -1 : bestIdx;
        global.GuidedView.refreshRender();
        return true;
      }
      if (mangaBubbleHotIdx !== -1) {
        mangaBubbleHotIdx = -1;
        global.GuidedView.refreshRender();
        return true;
      }
      return false;
    }
  };

  global.GuidedView.ModeRegistry.register('manga-bubble-hot', MangaBubbleHotMode);

})(typeof window !== 'undefined' ? window : globalThis);
