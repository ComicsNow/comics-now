import { state } from '../../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

let active = false;
let mangaHotPanelIdx = -1;

export const MangaPanelZoomMode = {
  async enable() {
    if (!state.GuidedView.isFullscreenOpen()) return false;
    const comic = state.currentComic || window.currentComic;
    if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode) return false;
    const data = await state.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;

    active = true;
    mangaHotPanelIdx = -1;
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
    mangaHotPanelIdx = -1;
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
    if (!active) return { targetBox: null, isPanelZoom: false };

    const panels = state.GuidedView.classifyMangaPage();
    let targetBox = null;
    if (mangaHotPanelIdx >= 0 && panels[mangaHotPanelIdx]) {
      targetBox = panels[mangaHotPanelIdx].box;
    }

    return { targetBox, isPanelZoom: true };
  },

  tryAdvance(direction) {
    return false;
  },

  onPageRendered() {
    if (active) {
      mangaHotPanelIdx = -1;
    }
  },

  handleImageClick(nx, ny) {
    if (!active) return false;

    const panels = state.GuidedView.classifyMangaPage();
    if (panels.length === 0) return false;

    if (mangaHotPanelIdx >= 0) {
      mangaHotPanelIdx = -1;
      state.GuidedView.refreshRender();
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
      state.GuidedView.refreshRender();
      return true;
    }
    return false;
  }
};

state.GuidedView.ModeRegistry.register('manga-panel-zoom', MangaPanelZoomMode);
