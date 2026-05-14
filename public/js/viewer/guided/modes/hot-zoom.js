(function (global) {
  'use strict';

  let active = false;
  let hotZoomIndex = -1;
  let mangaHotPanelIdx = -1;

  const HotZoomMode = {
    async enable() {
      if (!global.GuidedView.isFullscreenOpen()) return false;
      const comic = global.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed') return false;
      const data = await global.GuidedView.loadGuidedView(comic.id);
      if (!data) return false;

      active = true;
      hotZoomIndex = -1;
      mangaHotPanelIdx = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
      return true;
    },

    disable() {
      active = false;
      hotZoomIndex = -1;
      mangaHotPanelIdx = -1;
      global.GuidedView.refreshRender();
      this.updateUI();
    },

    toggle() {
      return global.GuidedView.ModeRegistry.toggle('hot-zoom');
    },

    updateUI() {
      global.GuidedView.updateHotZoomToggleUI(active);
    },

    isActive() {
      return active;
    },

    getRenderState() {
      if (!active) return { targetBox: null, isPanelZoom: false };

      let targetBox = null;
      let isPanelZoom = false;

      if (global.GuidedView.isMangaComic()) {
        const panels = global.GuidedView.classifyMangaPage();
        if (mangaHotPanelIdx >= 0 && panels[mangaHotPanelIdx]) {
          targetBox = panels[mangaHotPanelIdx].box;
          isPanelZoom = true;
        }
      } else {
        const bubbles = global.GuidedView.currentPageBubbles();
        if (hotZoomIndex >= 0 && hotZoomIndex < bubbles.length) {
          targetBox = bubbles[hotZoomIndex];
        }
      }

      return { targetBox, isPanelZoom };
    },

    tryAdvance(direction) {
      // Hot Zoom doesn't typically handle sequential advance, 
      // but it could if we wanted it to. index.js didn't have it.
      return false;
    },

    onPageRendered() {
      if (active) {
        hotZoomIndex = -1;
        mangaHotPanelIdx = -1;
      }
    },

    handleImageClick(nx, ny) {
      if (!active) return false;

      if (global.GuidedView.isMangaComic()) {
        const panels = global.GuidedView.classifyMangaPage();
        if (panels.length === 0) return false;

        if (mangaHotPanelIdx >= 0) {
          mangaHotPanelIdx = -1;
          global.GuidedView.refreshRender();
          return true;
        }

        let bestIdx = -1, bestArea = Infinity;
        for (let i = 0; i < panels.length; i++) {
          const [px, py, pw, ph] = panels[i].box;
          if (nx >= px && nx <= px + pw && ny >= py && ny <= py + ph) {
            const area = pw * ph;
            if (area < bestArea) { bestArea = area; bestIdx = i; }
          }
        }
        if (bestIdx >= 0) {
          mangaHotPanelIdx = bestIdx;
          global.GuidedView.refreshRender();
          return true;
        }
      } else {
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
      }
      return false;
    }
  };

  global.GuidedView.ModeRegistry.register('hot-zoom', HotZoomMode);

})(typeof window !== 'undefined' ? window : globalThis);
