import { state } from '../../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

let active = false;
let panelIndex = -1;

export const GuidedMode = {
  async enable() {
    if (!state.GuidedView.isFullscreenOpen()) return false;
    const comic = state.currentComic || window.currentComic;
    if (!comic || comic.guidedViewStatus !== 'completed') return false;
    const data = await state.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;

    active = true;
    panelIndex = -1;
    state.GuidedView.refreshRender();
    this.updateUI();
    return true;
  },

  disable() {
    active = false;
    panelIndex = -1;
    state.GuidedView.refreshRender();
    this.updateUI();
  },

  toggle() {
    return state.GuidedView.ModeRegistry.toggle('guided');
  },

  updateUI() {
    state.GuidedView.updateToggleUI(active);
  },

  isActive() {
    return active;
  },

  getRenderState() {
    if (!active) return { targetBox: null, isPanelZoom: false };

    let targetBox = null;
    let isPanelZoom = false;

    if (!state.GuidedView.isMangaComic()) {
      const sequence = state.GuidedView.currentPagePanels();
      if (panelIndex >= 0 && panelIndex < sequence.length) {
        targetBox = sequence[panelIndex];
      }
    }
    // For Manga, the target box is handled by applyTransform in refreshRender,
    // but we still need to know if we are in a panel zoom state for some UI/overlay logic if needed.
    
    return { targetBox, isPanelZoom };
  },

  getPanelIndex() {
    return panelIndex;
  },

  tryAdvance(direction) {
    if (!active) return false;
    if (!state.GuidedView.isFullscreenOpen()) {
      this.disable();
      return false;
    }

    const panels = state.GuidedView.currentPagePanels();
    if (panels.length === 0) return false;

    if (direction > 0) {
      if (panelIndex >= panels.length - 1) return false;
      panelIndex += 1;
      state.GuidedView.refreshRender();
      return true;
    }
    if (direction < 0) {
      if (panelIndex <= -1) return false;
      panelIndex -= 1;
      state.GuidedView.refreshRender();
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
    // Navigation is owned by the dedicated side-nav hotspots
    // (#fullscreen-nav-left / -right), which route through tryGuidedAdvance.
    // Image clicks should not navigate — return false so the menu surfaces.
    return false;
  }
};

state.GuidedView.ModeRegistry.register('guided', GuidedMode);
