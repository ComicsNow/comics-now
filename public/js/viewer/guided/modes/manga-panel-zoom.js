import { state } from '../../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

let active = false;
let currentZoom = null; // { type: 'panel' | 'bubble', box: [x,y,w,h], index: number }

export const MangaPanelZoomMode = {
  async enable() {
    if (!state.GuidedView.isFullscreenOpen()) return false;
    const comic = state.currentComic || window.currentComic;
    if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode) return false;
    const data = await state.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;

    active = true;
    currentZoom = null;
    state.GuidedView.refreshRender();
    this.updateUI();
    const showControls = state.showFullscreenControls || window.showFullscreenControls;
    if (typeof showControls === 'function') {
      showControls(false); // force show, no autohide
    }
    return true;
  },

  disable() {
    active = false;
    currentZoom = null;
    state.GuidedView.refreshRender();
    this.updateUI();
    const showControls = state.showFullscreenControls || window.showFullscreenControls;
    if (typeof showControls === 'function') {
      showControls(true); // restart autohide timer
    }
  },

  toggle() {
    return state.GuidedView.ModeRegistry.toggle('manga-panel-zoom');
  },

  updateUI() {
    state.GuidedView.updateMangaPanelZoomUI(active);
  },

  isActive() {
    return active;
  },

  getRenderState() {
    if (!active || !currentZoom) return { targetBox: null, isPanelZoom: false };
    return { targetBox: currentZoom.box, isPanelZoom: currentZoom.type === 'panel' };
  },

  tryAdvance(direction) {
    return false;
  },

  onPageRendered() {
    if (active) {
      currentZoom = null;
    }
  },

  handleImageClick(nx, ny) {
    if (!active) return false;

    // 1. Check speech bubbles first with expanded hit area (clicking a speech bubble zooms the speech bubble)
    const bubbles = (typeof state.GuidedView.mangaPageBubbles === 'function')
      ? state.GuidedView.mangaPageBubbles()
      : [];
    const findBubble = state.GuidedView.findBubbleAtPoint || (typeof window !== 'undefined' && window.GuidedView?.findBubbleAtPoint);
    let bestBubbleIdx = (typeof findBubble === 'function') ? findBubble(bubbles, nx, ny) : -1;
    if (bestBubbleIdx === -1 && typeof findBubble !== 'function') {
      let minBubbleArea = Infinity;
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          const area = bw * bh;
          if (area < minBubbleArea) { minBubbleArea = area; bestBubbleIdx = i; }
        }
      }
    }

    // 2. Check panels (clicking a panel zooms the panel)
    const pageIndex = (state.fullscreenPage !== undefined) ? state.fullscreenPage : (window.fullscreenPage || 0);
    const panels = (typeof state.GuidedView.classifyMangaPage === 'function')
      ? state.GuidedView.classifyMangaPage(pageIndex)
      : [];
    let bestPanelIdx = -1, minPanelArea = Infinity;
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      const [px, py, pw, ph] = Array.isArray(p) ? p : (p.box || [p.x, p.y, p.w, p.h]);
      if (nx >= px && nx <= px + pw && ny >= py && ny <= py + ph) {
        const area = pw * ph;
        if (area < minPanelArea) { minPanelArea = area; bestPanelIdx = i; }
      }
    }

    // Prioritize speech bubble zoom if clicked inside a bubble
    if (bestBubbleIdx !== -1) {
      if (currentZoom && currentZoom.type === 'bubble' && currentZoom.index === bestBubbleIdx) {
        currentZoom = null; // Toggle unzoom on same bubble
      } else {
        currentZoom = { type: 'bubble', box: bubbles[bestBubbleIdx], index: bestBubbleIdx };
      }
      state.GuidedView.refreshRender();
      return true;
    }

    // Otherwise zoom into the clicked panel
    if (bestPanelIdx !== -1) {
      const p = panels[bestPanelIdx];
      const box = Array.isArray(p) ? p : (p.box || [p.x, p.y, p.w, p.h]);
      if (currentZoom && currentZoom.type === 'panel' && currentZoom.index === bestPanelIdx) {
        currentZoom = null; // Toggle unzoom on same panel
      } else {
        currentZoom = { type: 'panel', box, index: bestPanelIdx };
      }
      state.GuidedView.refreshRender();
      return true;
    }

    // If clicked outside while zoomed in, unzoom back to full page
    if (currentZoom !== null) {
      currentZoom = null;
      state.GuidedView.refreshRender();
      return true;
    }

    return false;
  }
};

state.GuidedView.ModeRegistry.register('manga-panel-zoom', MangaPanelZoomMode);
