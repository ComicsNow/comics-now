(function (global) {
  'use strict';

  global.GuidedView = global.GuidedView || {};

  function bindToggleButton() {
    const registry = global.GuidedView.ModeRegistry;

    const btn = document.getElementById('guided-toggle-btn');
    if (btn && !btn._guidedBound) {
      btn._guidedBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'guided';
        if (willActivate) await global.GuidedView.enable(); else global.GuidedView.disable();
        comic.guidedMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { guidedMode: willActivate });
        registry.saveModePreference(comic.id, 'guided', willActivate);
      });
    }

    const bubbleBtn = document.getElementById('bubble-toggle-btn');
    if (bubbleBtn && !bubbleBtn._bubbleBound) {
      bubbleBtn._bubbleBound = true;
      bubbleBtn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'bubble';
        if (willActivate) await global.GuidedView.enableBubble(); else global.GuidedView.disableBubble();
        comic.bubbleMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { bubbleMode: willActivate });
        registry.saveModePreference(comic.id, 'bubble', willActivate);
      });
    }

    const mangaBubbleHotBtn = document.getElementById('manga-bubble-hot-btn');
    if (mangaBubbleHotBtn && !mangaBubbleHotBtn._mangaBubbleHotBound) {
      mangaBubbleHotBtn._mangaBubbleHotBound = true;
      mangaBubbleHotBtn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'manga-bubble-hot';
        if (willActivate) await global.GuidedView.enableMangaBubbleHot(); else global.GuidedView.disableMangaBubbleHot();
        comic.mangaBubbleHotMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { mangaBubbleHotMode: willActivate });
        registry.saveModePreference(comic.id, 'manga-bubble-hot', willActivate);
      });
    }

    const hotZoomBtn = document.getElementById('hot-zoom-btn');
    if (hotZoomBtn && !hotZoomBtn._hotZoomBound) {
      hotZoomBtn._hotZoomBound = true;
      hotZoomBtn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !global.GuidedView.isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'hot-zoom';
        if (willActivate) await global.GuidedView.enableHotZoom(); else global.GuidedView.disableHotZoom();
        comic.hotZoomMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { hotZoomMode: willActivate });
        registry.saveModePreference(comic.id, 'hot-zoom', willActivate);
      });
    }
  }

  Object.assign(global.GuidedView, { bindToggleButton });

})(typeof window !== 'undefined' ? window : globalThis);
