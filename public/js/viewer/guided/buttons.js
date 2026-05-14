(function (global) {
  'use strict';

  global.GuidedView = global.GuidedView || {};

  function bindToggleButton() {
    const registry = global.GuidedView.ModeRegistry;

    const btn = document.getElementById('manga-guided-toggle-btn');
    if (btn && !btn._guidedBound) {
      btn._guidedBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'guided';
        if (willActivate) await global.GuidedView.enable(); else global.GuidedView.disable('guided');
      });
    }

    const westernBtn = document.getElementById('western-guided-toggle-btn');
    if (westernBtn && !westernBtn._bubbleBound) {
      westernBtn._bubbleBound = true;
      westernBtn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'bubble';
        if (willActivate) await global.GuidedView.enableBubble(); else global.GuidedView.disable('bubble');
      });
    }

    const mangaSpeechBtn = document.getElementById('manga-speech-zoom-btn');
    if (mangaSpeechBtn && !mangaSpeechBtn._mangaSpeechBound) {
      mangaSpeechBtn._mangaSpeechBound = true;
      mangaSpeechBtn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'manga-speech-zoom';
        if (willActivate) await global.GuidedView.enableMangaSpeechZoom(); else global.GuidedView.disable('manga-speech-zoom');
      });
    }

    const westernSpeechBtn = document.getElementById('western-speech-zoom');
    if (westernSpeechBtn && !westernSpeechBtn._hotZoomBound) {
      westernSpeechBtn._hotZoomBound = true;
      westernSpeechBtn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'western-speech-zoom';
        if (willActivate) await global.GuidedView.enableWesternSpeechZoom(); else global.GuidedView.disable('western-speech-zoom');
      });
    }

    const mangaPanelBtn = document.getElementById('manga-panel-zoom');
    if (mangaPanelBtn && !mangaPanelBtn._hotZoomBound) {
      mangaPanelBtn._hotZoomBound = true;
      mangaPanelBtn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'manga-panel-zoom';
        if (willActivate) await global.GuidedView.enableMangaPanelZoom(); else global.GuidedView.disable('manga-panel-zoom');
      });
    }
  }

  Object.assign(global.GuidedView, { bindToggleButton });

})(typeof window !== 'undefined' ? window : globalThis);
