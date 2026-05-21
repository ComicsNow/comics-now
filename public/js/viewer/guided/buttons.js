import { state } from '../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

export function bindToggleButton() {
  const registry = state.GuidedView.ModeRegistry;

  const btn = document.getElementById('manga-guided-toggle-btn');
  if (btn && !btn._guidedBound) {
    btn._guidedBound = true;
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const comic = state.currentComic || window.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed' || !state.GuidedView.isFullscreenOpen()) return;
      const willActivate = registry.getActiveModeName() !== 'guided';
      if (willActivate) await state.GuidedView.enable(); else state.GuidedView.disable('guided');
    });
  }

  const westernBtn = document.getElementById('western-guided-toggle-btn');
  if (westernBtn && !westernBtn._bubbleBound) {
    westernBtn._bubbleBound = true;
    westernBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const comic = state.currentComic || window.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode || !state.GuidedView.isFullscreenOpen()) return;
      const willActivate = registry.getActiveModeName() !== 'bubble';
      if (willActivate) await state.GuidedView.enableBubble(); else state.GuidedView.disableBubble();
    });
  }

  const mangaSpeechBtn = document.getElementById('manga-speech-zoom-btn');
  if (mangaSpeechBtn && !mangaSpeechBtn._mangaSpeechBound) {
    mangaSpeechBtn._mangaSpeechBound = true;
    mangaSpeechBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const comic = state.currentComic || window.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode || !state.GuidedView.isFullscreenOpen()) return;
      const willActivate = registry.getActiveModeName() !== 'manga-speech-zoom';
      if (willActivate) await state.GuidedView.enableMangaSpeechZoom(); else state.GuidedView.disableMangaSpeechZoom();
    });
  }

  const westernSpeechBtn = document.getElementById('western-speech-zoom');
  if (westernSpeechBtn && !westernSpeechBtn._hotZoomBound) {
    westernSpeechBtn._hotZoomBound = true;
    westernSpeechBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const comic = state.currentComic || window.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode || !state.GuidedView.isFullscreenOpen()) return;
      const willActivate = registry.getActiveModeName() !== 'western-speech-zoom';
      if (willActivate) await state.GuidedView.enableWesternSpeechZoom(); else state.GuidedView.disableWesternSpeechZoom();
    });
  }

  const mangaPanelBtn = document.getElementById('manga-panel-zoom');
  if (mangaPanelBtn && !mangaPanelBtn._hotZoomBound) {
    mangaPanelBtn._hotZoomBound = true;
    mangaPanelBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const comic = state.currentComic || window.currentComic;
      if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode || !state.GuidedView.isFullscreenOpen()) return;
      const willActivate = registry.getActiveModeName() !== 'manga-panel-zoom';
      if (willActivate) await state.GuidedView.enableMangaPanelZoom(); else state.GuidedView.disableMangaPanelZoom();
    });
  }
}

state.GuidedView.bindToggleButton = bindToggleButton;
if (typeof window !== 'undefined') {
  window.GuidedView.bindToggleButton = bindToggleButton;
}
