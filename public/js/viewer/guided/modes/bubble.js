import { state } from '../../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

let active = false;
let bubbleIndex = -1;

export const BubbleMode = {
  async enable() {
    if (!state.GuidedView.isFullscreenOpen()) return false;
    const comic = state.currentComic || window.currentComic;
    if (!comic || comic.guidedViewStatus !== 'completed') return false;
    if (comic.mangaMode) return false;
    const data = await state.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;

    active = true;
    bubbleIndex = -1;
    state.GuidedView.refreshRender();
    this.updateUI();
    return true;
  },

  disable() {
    active = false;
    bubbleIndex = -1;
    state.GuidedView.refreshRender();
    this.updateUI();
  },

  toggle() {
    return state.GuidedView.ModeRegistry.toggle('bubble');
  },

  updateUI() {
    state.GuidedView.updateBubbleToggleUI(active);
  },

  isActive() {
    return active;
  },

  getRenderState() {
    if (!active) return { targetBox: null, isPanelZoom: false };

    const bubbles = state.GuidedView.currentPageBubbles();
    let targetBox = null;
    if (bubbleIndex >= 0 && bubbleIndex < bubbles.length) {
      targetBox = bubbles[bubbleIndex];
    }
    return { targetBox, isPanelZoom: false };
  },

  tryAdvance(direction) {
    if (!active) return false;
    if (!state.GuidedView.isFullscreenOpen()) {
      this.disable();
      return false;
    }

    const bubbles = state.GuidedView.currentPageBubbles();
    if (bubbles.length === 0) return false;

    if (direction > 0) {
      if (bubbleIndex >= bubbles.length - 1) return false;
      bubbleIndex += 1;
      state.GuidedView.refreshRender();
      return true;
    }
    if (direction < 0) {
      if (bubbleIndex <= -1) return false;
      bubbleIndex -= 1;
      state.GuidedView.refreshRender();
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
    const bubbles = state.GuidedView.currentPageBubbles();
    for (let i = 0; i < bubbles.length; i++) {
      const [bx, by, bw, bh] = bubbles[i];
      if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
        bubbleIndex = i;
        state.GuidedView.refreshRender();
        return true;
      }
    }
    return false;
  }
};

state.GuidedView.ModeRegistry.register('bubble', BubbleMode);
