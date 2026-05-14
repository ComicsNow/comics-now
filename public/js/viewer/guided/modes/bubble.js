(function (global) {
  'use strict';

  let active = false;
  let bubbleIndex = -1;

  const BubbleMode = {
    async enable() {
      if (!global.GuidedView.isFullscreenOpen()) return false;
      const comic = global.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed') return false;
      if (comic.mangaMode) return false;
      const data = await global.GuidedView.loadGuidedView(comic.id);
      if (!data) return false;

      active = true;
      bubbleIndex = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
      return true;
    },

    disable() {
      active = false;
      bubbleIndex = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
    },

    toggle() {
      return global.GuidedView.ModeRegistry.toggle('bubble');
    },

    updateUI() {
      global.GuidedView.updateBubbleToggleUI(active);
    },

    isActive() {
      return active;
    },

    getRenderState() {
      if (!active) return { targetBox: null, isPanelZoom: false };

      const bubbles = global.GuidedView.currentPageBubbles();
      let targetBox = null;
      if (bubbleIndex >= 0 && bubbleIndex < bubbles.length) {
        targetBox = bubbles[bubbleIndex];
      }
      return { targetBox, isPanelZoom: false };
    },

    tryAdvance(direction) {
      if (!active) return false;
      if (!global.GuidedView.isFullscreenOpen()) {
        this.disable();
        return false;
      }

      const bubbles = global.GuidedView.currentPageBubbles();
      if (bubbles.length === 0) return false;

      if (direction > 0) {
        if (bubbleIndex >= bubbles.length - 1) return false;
        bubbleIndex += 1;
        global.GuidedView.refreshRender();
        return true;
      }
      if (direction < 0) {
        if (bubbleIndex <= -1) return false;
        bubbleIndex -= 1;
        global.GuidedView.refreshRender();
        return true;
      }
      return false;
    },

    onPageRendered() {
      if (active) {
        bubbleIndex = -1;
      }
    },

    handleImageClick(nx, ny) {
      if (!active) return false;
      const bubbles = global.GuidedView.currentPageBubbles();
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          bubbleIndex = i;
          global.GuidedView.refreshRender();
          return true;
        }
      }
      return false;
    }
  };

  global.GuidedView.ModeRegistry.register('bubble', BubbleMode);

})(typeof window !== 'undefined' ? window : globalThis);
