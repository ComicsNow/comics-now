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
    const btn = document.getElementById('manga-guided-toggle-btn');
    const westernBtn = document.getElementById('western-guided-toggle-btn');
    const westernSpeechBtn = document.getElementById('western-speech-zoom');
    const mangaPanelBtn = document.getElementById('manga-panel-zoom');
    const mangaSpeechBtn = document.getElementById('manga-speech-zoom-btn');

    const comic = global.currentComic;
    if (!comic) {
      if (btn) btn.style.display = 'none';
      if (westernBtn) westernBtn.style.display = 'none';
      if (westernSpeechBtn) westernSpeechBtn.style.display = 'none';
      if (mangaPanelBtn) mangaPanelBtn.style.display = 'none';
      if (mangaSpeechBtn) mangaSpeechBtn.style.display = 'none';
      return;
    }

    const isManga = !!(comic && (comic.mangaMode === true || comic.mangaMode == 1));
    const processed = !!(comic && comic.guidedViewStatus === 'completed');
    const isContinuous = !!global.isContinuousMode;
    const isFullImage = !!global.isFullImageMode;
    const isLandscape = !!global.isLandscapeOrientation;
    const isDesktop = typeof global.isDesktopDevice === 'function' && global.isDesktopDevice();

    if (processed && !global.GuidedView.cache.has(comic.id)) {
      await global.GuidedView.loadGuidedView(comic.id);
    }

    const data = global.GuidedView.cache.get(comic.id);

    if (btn) {
      const hasPanels = data && data.pages && Object.values(data.pages).some(p => {
        if (Array.isArray(p)) return p.length > 0;
        return p && p.panels && p.panels.length > 0;
      });
      const ready = isManga && processed && hasPanels && !isContinuous && !isFullImage && !isLandscape;
      btn.style.display = ready ? 'flex' : 'none';
      btn.disabled = !ready;
    }

    if (westernBtn) {
      const hasBubbles = data && data.pages && Object.values(data.pages).some(p => p && p.bubbles && p.bubbles.length > 0);
      const hasSequence = data && data.pages && Object.values(data.pages).some(p => p && p.sequence && p.sequence.length > 0);
      const bubbleReady = !isManga && processed && (hasBubbles || hasSequence) && !isContinuous && !isFullImage && !isLandscape;
      westernBtn.style.display = bubbleReady ? 'flex' : 'none';
      westernBtn.disabled = !bubbleReady;
    }

    if (westernSpeechBtn) {
      const hasBubbles = data && data.pages && Object.values(data.pages).some(p => p && p.bubbles && p.bubbles.length > 0);
      const ready = !isManga && processed && hasBubbles && !isContinuous && !isFullImage && !isLandscape && !isDesktop;
      westernSpeechBtn.style.display = ready ? 'flex' : 'none';
      westernSpeechBtn.disabled = !ready;
    }

    if (mangaPanelBtn) {
      const hasMangaBoxes = data && data.pages && Object.values(data.pages).some(p => p && Array.isArray(p.panels) && p.panels.length > 0);
      const ready = isManga && processed && hasMangaBoxes && !isContinuous && !isFullImage && !isLandscape;
      mangaPanelBtn.style.display = ready ? 'flex' : 'none';
      mangaPanelBtn.disabled = !ready;
    }

    if (mangaSpeechBtn) {
      const hasMangaBoxes = data && data.pages && Object.values(data.pages).some(p => p && Array.isArray(p.panels) && p.panels.length > 0);
      const ready = isManga && processed && hasMangaBoxes && !isContinuous && !isFullImage && !isLandscape && !isDesktop;
      mangaSpeechBtn.style.display = ready ? 'flex' : 'none';
      mangaSpeechBtn.disabled = !ready;
    }

    const registry = global.GuidedView.ModeRegistry;
    if (registry.isTransitioning()) return;

    if (!isFullscreenOpen()) {
      registry.disableAll();
      if (typeof global.GuidedView.updateAllUI === 'function') global.GuidedView.updateAllUI();
      return;
    }
    
    const activeModeName = registry.getActiveModeName();
    
    // Load local preference to override database state
    try {
      const localPref = localStorage.getItem(`guided_pref_${comic.id}`);
      if (localPref) {
        // Reset all mode flags on the comic object to false first
        comic.guidedMode = false;
        comic.bubbleMode = false;
        comic.hotZoomMode = false;
        comic.mangaBubbleHotMode = false;

        // Apply the stored preference to the correct flag
        if (localPref === 'guided') comic.guidedMode = true;
        else if (localPref === 'bubble') comic.bubbleMode = true;
        else if (localPref === 'western-speech-zoom' || localPref === 'manga-panel-zoom') comic.hotZoomMode = true;
        else if (localPref === 'manga-speech-zoom') comic.mangaBubbleHotMode = true;
      }
    } catch (e) { /* ignore */ }

    const guidedModePref = !!(comic.guidedMode === true || comic.guidedMode == 1);
    const bubbleModePref = !!(comic.bubbleMode === true || comic.bubbleMode == 1);
    const hotZoomModePref = !!(comic.hotZoomMode === true || comic.hotZoomMode == 1);
    const mangaSpeechPref = !!(comic.mangaBubbleHotMode === true || comic.mangaBubbleHotMode == 1);

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

    if (!isManga && processed && hotZoomModePref && activeModeName !== 'western-speech-zoom' && !isDesktop) {
      if (global.GuidedView.enableWesternSpeechZoom) await global.GuidedView.enableWesternSpeechZoom();
    } else if (!isManga && (!processed || !hotZoomModePref || isDesktop) && activeModeName === 'western-speech-zoom') {
      if (global.GuidedView.disableWesternSpeechZoom) global.GuidedView.disableWesternSpeechZoom();
    }

    if (isManga && processed && hotZoomModePref && activeModeName !== 'manga-panel-zoom') {
      if (global.GuidedView.enableMangaPanelZoom) await global.GuidedView.enableMangaPanelZoom();
    } else if (isManga && (!processed || !hotZoomModePref) && activeModeName === 'manga-panel-zoom') {
      if (global.GuidedView.disableMangaPanelZoom) global.GuidedView.disableMangaPanelZoom();
    }

    if (isManga && processed && mangaSpeechPref && activeModeName !== 'manga-speech-zoom' && !isDesktop) {
      if (global.GuidedView.enableMangaSpeechZoom) await global.GuidedView.enableMangaSpeechZoom();
    } else if (isManga && (!processed || !mangaSpeechPref || isDesktop) && activeModeName === 'manga-speech-zoom') {
      if (global.GuidedView.disableMangaSpeechZoom) global.GuidedView.disableMangaSpeechZoom();
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
