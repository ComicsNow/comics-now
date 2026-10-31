import { state } from '../../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

let active = false;
let mangaSpeechZoomIdx = -1;

export const MangaSpeechZoomMode = {
  async enable() {
    if (!state.GuidedView.isFullscreenOpen()) return false;
    const comic = state.currentComic || window.currentComic;
    if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode) return false;
    const data = await state.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;

    active = true;
    mangaSpeechZoomIdx = -1;
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
    mangaSpeechZoomIdx = -1;
    state.GuidedView.refreshRender();
    this.updateUI();
    const showControls = state.showFullscreenControls || window.showFullscreenControls;
    if (typeof showControls === 'function') {
      showControls(true); // restart autohide timer
    }
  },

  toggle() {
    return state.GuidedView.ModeRegistry.toggle('manga-speech-zoom');
  },

  updateUI() {
    state.GuidedView.updateMangaSpeechZoomUI(active);
  },

  isActive() {
    return active;
  },

  getRenderState() {
    if (!active) return { targetBox: null, isPanelZoom: false };

    const bubbles = (typeof state.GuidedView.mangaPageBubbles === 'function')
      ? state.GuidedView.mangaPageBubbles()
      : [];
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

    // Manga speech zoom only zooms speech bubbles (with expanded hit area)
    const bubbles = (typeof state.GuidedView.mangaPageBubbles === 'function')
      ? state.GuidedView.mangaPageBubbles()
      : [];
    const findBubble = state.GuidedView.findBubbleAtPoint || (typeof window !== 'undefined' && window.GuidedView?.findBubbleAtPoint);
    let bestIdx = (typeof findBubble === 'function') ? findBubble(bubbles, nx, ny) : -1;
    if (bestIdx === -1 && typeof findBubble !== 'function') {
      let minArea = Infinity;
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          const area = bw * bh;
          if (area < minArea) { minArea = area; bestIdx = i; }
        }
      }
    }

    if (bestIdx !== -1) {
      mangaSpeechZoomIdx = (mangaSpeechZoomIdx === bestIdx) ? -1 : bestIdx;
      state.GuidedView.refreshRender();
      return true;
    }

    if (mangaSpeechZoomIdx !== -1) {
      mangaSpeechZoomIdx = -1;
      state.GuidedView.refreshRender();
      return true;
    }

    return false;
  }
};

state.GuidedView.ModeRegistry.register('manga-speech-zoom', MangaSpeechZoomMode);
