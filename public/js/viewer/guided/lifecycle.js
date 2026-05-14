(function (global) {
  'use strict';

  global.GuidedView = global.GuidedView || {};

  function isFullscreenOpen() {
    const fv = document.getElementById('fullscreen-viewer');
    return !!(fv && !fv.classList.contains('hidden'));
  }

  function onPageRendered() {
    const registry = global.GuidedView.ModeRegistry;
    if (!registry.getActiveModeName()) return;
    
    if (!isFullscreenOpen()) { 
      registry.disableAll();
      return; 
    }
    
    const activeMode = registry.getActiveMode();
    if (activeMode) activeMode.onPageRendered();

    requestAnimationFrame(global.GuidedView.refreshRender);
  }

  // Refresh button enabled state and auto-enable per saved preference.
  async function refreshGuidedToggle() {
    const btn = document.getElementById('guided-toggle-btn');
    const bubbleBtn = document.getElementById('bubble-toggle-btn');
    const hotZoomBtn = document.getElementById('hot-zoom-btn');
    const mangaBubbleHotBtn = document.getElementById('manga-bubble-hot-btn');

    const comic = global.currentComic;
    if (!comic) {
      if (btn) btn.style.display = 'none';
      if (bubbleBtn) bubbleBtn.style.display = 'none';
      if (hotZoomBtn) hotZoomBtn.style.display = 'none';
      if (mangaBubbleHotBtn) mangaBubbleHotBtn.style.display = 'none';
      return;
    }

    const isManga = !!(comic && (comic.mangaMode === true || comic.mangaMode == 1));
    const processed = !!(comic && comic.guidedViewStatus === 'completed');
    const isContinuous = !!global.isContinuousMode;

    if (processed && !global.GuidedView.cache.has(comic.id)) {
      await global.GuidedView.loadGuidedView(comic.id);
    }

    const data = global.GuidedView.cache.get(comic.id);

    if (btn) {
      const hasPanels = data && data.pages && Object.values(data.pages).some(p => {
        if (Array.isArray(p)) return p.length > 0;
        return p && p.panels && p.panels.length > 0;
      });
      const ready = isManga && processed && hasPanels && !isContinuous;
      btn.style.display = ready ? 'flex' : 'none';
      btn.disabled = !ready;
    }

    if (bubbleBtn) {
      const hasBubbles = data && data.pages && Object.values(data.pages).some(p => p && p.bubbles && p.bubbles.length > 0);
      const hasSequence = data && data.pages && Object.values(data.pages).some(p => p && p.sequence && p.sequence.length > 0);
      const bubbleReady = !isManga && processed && (hasBubbles || hasSequence) && !isContinuous;
      bubbleBtn.style.display = bubbleReady ? 'flex' : 'none';
      bubbleBtn.disabled = !bubbleReady;
    }

    if (hotZoomBtn) {
      const hasBubbles = data && data.pages && Object.values(data.pages).some(p => p && p.bubbles && p.bubbles.length > 0);
      const hasMangaBoxes = data && data.pages && Object.values(data.pages).some(p => p && Array.isArray(p.panels) && p.panels.length > 0);
      const hotZoomReady = processed && (isManga ? hasMangaBoxes : hasBubbles) && !isContinuous;
      hotZoomBtn.style.display = hotZoomReady ? 'flex' : 'none';
      hotZoomBtn.disabled = !hotZoomReady;
    }

    if (mangaBubbleHotBtn) {
      const hasMangaBoxes = data && data.pages && Object.values(data.pages).some(p => p && Array.isArray(p.panels) && p.panels.length > 0);
      const ready = isManga && processed && hasMangaBoxes;
      mangaBubbleHotBtn.style.display = ready ? 'flex' : 'none';
      mangaBubbleHotBtn.disabled = !ready;
    }

    const registry = global.GuidedView.ModeRegistry;
    if (!isFullscreenOpen()) {
      registry.disableAll();
      if (typeof global.GuidedView.updateAllUI === 'function') global.GuidedView.updateAllUI();
      return;
    }
    
    const activeModeName = registry.getActiveModeName();
    const guidedModePref = !!(comic.guidedMode === true || comic.guidedMode == 1);
    const bubbleModePref = !!(comic.bubbleMode === true || comic.bubbleMode == 1);
    const hotZoomModePref = !!(comic.hotZoomMode === true || comic.hotZoomMode == 1);
    const mangaBubbleHotPref = !!(comic.mangaBubbleHotMode === true || comic.mangaBubbleHotMode == 1);

    if (isManga && processed && guidedModePref && activeModeName !== 'guided') {
      if (global.GuidedView.enable) await global.GuidedView.enable();
    } else if (isManga && (!processed || !guidedModePref) && activeModeName === 'guided') {
      if (global.GuidedView.disable) global.GuidedView.disable();
    }
    
    if (!isManga && processed && bubbleModePref && activeModeName !== 'bubble') {
      if (global.GuidedView.enableBubble) await global.GuidedView.enableBubble();
    } else if (!isManga && (!processed || !bubbleModePref) && activeModeName === 'bubble') {
      if (global.GuidedView.disableBubble) global.GuidedView.disableBubble();
    }

    if (processed && hotZoomModePref && activeModeName !== 'hot-zoom') {
      if (global.GuidedView.enableHotZoom) await global.GuidedView.enableHotZoom();
    } else if ((!processed || !hotZoomModePref) && activeModeName === 'hot-zoom') {
      if (global.GuidedView.disableHotZoom) global.GuidedView.disableHotZoom();
    }

    if (isManga && processed && mangaBubbleHotPref && activeModeName !== 'manga-bubble-hot') {
      if (global.GuidedView.enableMangaBubbleHot) await global.GuidedView.enableMangaBubbleHot();
    } else if (isManga && (!processed || !mangaBubbleHotPref) && activeModeName === 'manga-bubble-hot') {
      if (global.GuidedView.disableMangaBubbleHot) global.GuidedView.disableMangaBubbleHot();
    }

    if (typeof global.GuidedView.updateAllUI === 'function') global.GuidedView.updateAllUI();
  }

  function watchFullscreenToggle() {
    const fv = document.getElementById('fullscreen-viewer');
    if (!fv || fv._guidedObserver) return;
    const observer = new MutationObserver(() => {
      const open = isFullscreenOpen();
      if (open) refreshGuidedToggle();
      else global.GuidedView.ModeRegistry.disableAll();
    });
    observer.observe(fv, { attributes: true, attributeFilter: ['class'] });
    fv._guidedObserver = observer;
  }

  function isZoomEngaged() {
    const registry = global.GuidedView.ModeRegistry;
    if (registry.getManualOverrideBox()) return true;
    
    // Check if any mode is active and providing a targetBox
    if (typeof global.GuidedView.getRenderState === 'function') {
      return !!global.GuidedView.getRenderState().targetBox;
    }
    return false;
  }

  function isAnyGuidedActive() {
    return !!global.GuidedView.ModeRegistry.getActiveModeName();
  }

  Object.assign(global.GuidedView, {
    isFullscreenOpen,
    onPageRendered,
    watchFullscreenToggle,
    refreshGuidedToggle,
    isZoomEngaged,
    isAnyGuidedActive
  });

  window.addEventListener('resize', () => {
    if (isAnyGuidedActive()) {
      requestAnimationFrame(global.GuidedView.refreshRender);
    }
  });

})(typeof window !== 'undefined' ? window : globalThis);
