// Guided View — pan/zoom panel-by-panel navigation in **fullscreen** only.
// Loads the per-comic JSON sidecar of panel rectangles, then on each navigate
// step (next/prev/keyboard) advances `panelIndex`, animating a CSS transform
// on the existing #fullscreen-image so the panel fills the screen.

(function (global) {
  'use strict';

  function isFullscreenOpen() {
    const fv = document.getElementById('fullscreen-viewer');
    return !!(fv && !fv.classList.contains('hidden'));
  }

  function getStage() { return document.getElementById('fullscreen-viewer'); }
  function getImg() { return document.getElementById('fullscreen-image'); }

  /**
   * Internal helper to determine the current target box and zoom style 
   * based on active modes and indices.
   */
  function getRenderState() {
    const registry = global.GuidedView.ModeRegistry;
    const manualOverrideBox = registry.getManualOverrideBox();
    if (manualOverrideBox) {
      return { targetBox: manualOverrideBox, isPanelZoom: false };
    }

    const activeMode = registry.getActiveMode();
    if (activeMode) {
      return activeMode.getRenderState();
    }

    return { targetBox: null, isPanelZoom: false };
  }

  /**
   * Orchestrates the rendering by calling the refactored pure functions 
   * in global.GuidedView (from overlay.js).
   */
  function refreshRender() {
    const { targetBox, isPanelZoom } = getRenderState();
    const registry = global.GuidedView.ModeRegistry;
    const activeModeName = registry.getActiveModeName();
    
    // 1. Classes and CSS
    const isManga = global.GuidedView.isMangaComic();
    const needsMangaLayout = activeModeName === 'guided' && isManga;
    global.GuidedView.applyClasses(needsMangaLayout);

    const isAnyActive = !!activeModeName || !!registry.getManualOverrideBox();
    global.GuidedView.applyZoomCss(isAnyActive);

    // 2. Main image transform (Manga sequential only)
    if (needsMangaLayout) {
      const activeMode = registry.getActiveMode();
      const panels = global.GuidedView.currentPagePanels();
      const panelIndex = activeMode.getPanelIndex ? activeMode.getPanelIndex() : -1;
      const currentTarget = (panelIndex >= 0 && panelIndex < panels.length) ? panels[panelIndex] : null;
      global.GuidedView.applyTransform(currentTarget, isManga);
    } else {
      const img = getImg();
      if (img) img.style.transform = '';
    }

    // 3. Bubble overlay (Western sequential, Bubble Zoom, Hot Zoom)
    const isWesternSequential = activeModeName === 'guided' && !isManga;
    const manualOverrideBox = registry.getManualOverrideBox();
    if (isWesternSequential || activeModeName === 'bubble' || activeModeName === 'hot-zoom' || activeModeName === 'manga-bubble-hot' || manualOverrideBox) {
      global.GuidedView.applyBubbleOverlay(targetBox, isPanelZoom);
    } else {
      global.GuidedView.applyBubbleOverlay(null);
    }
  }

  function updateAllUI() {
    const registry = global.GuidedView.ModeRegistry;
    ['guided', 'bubble', 'hot-zoom', 'manga-bubble-hot'].forEach(name => {
      const mode = registry.get(name);
      if (mode) mode.updateUI();
    });
  }

  // True if guided/bubble consumed the navigation; false → caller advances page.
  // Index walk: -1 (full page) → 0 → 1 → ... → N-1 → page advance.
  // Reverse:    -1 (full page) → previous page; 0 → -1; 1 → 0; etc.
  function tryAdvance(direction) {
    const registry = global.GuidedView.ModeRegistry;
    const activeMode = registry.getActiveMode();
    if (!activeMode) return false;
    
    if (!isFullscreenOpen()) { 
      registry.disableAll();
      return false; 
    }
    
    return activeMode.tryAdvance(direction);
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

    requestAnimationFrame(refreshRender);
  }

  async function enable() { return global.GuidedView.ModeRegistry.enable('guided'); }
  function disable() { global.GuidedView.ModeRegistry.disable('guided'); }
  async function toggle() { return global.GuidedView.ModeRegistry.toggle('guided'); }
  function isActive() { return global.GuidedView.ModeRegistry.getActiveModeName() === 'guided'; }

  async function enableBubble() { return global.GuidedView.ModeRegistry.enable('bubble'); }
  function disableBubble() { global.GuidedView.ModeRegistry.disable('bubble'); }
  async function toggleBubble() { return global.GuidedView.ModeRegistry.toggle('bubble'); }
  function isBubbleActive() { return global.GuidedView.ModeRegistry.getActiveModeName() === 'bubble'; }

  async function enableHotZoom() { return global.GuidedView.ModeRegistry.enable('hot-zoom'); }
  function disableHotZoom() { global.GuidedView.ModeRegistry.disable('hot-zoom'); }
  async function toggleHotZoom() { return global.GuidedView.ModeRegistry.toggle('hot-zoom'); }
  function isHotZoomActive() { return global.GuidedView.ModeRegistry.getActiveModeName() === 'hot-zoom'; }

  async function enableMangaBubbleHot() { return global.GuidedView.ModeRegistry.enable('manga-bubble-hot'); }
  function disableMangaBubbleHot() { global.GuidedView.ModeRegistry.disable('manga-bubble-hot'); }
  async function toggleMangaBubbleHot() { return global.GuidedView.ModeRegistry.toggle('manga-bubble-hot'); }
  function isMangaBubbleHotActive() { return global.GuidedView.ModeRegistry.getActiveModeName() === 'manga-bubble-hot'; }

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
      updateAllUI();
      return;
    }
    
    const activeModeName = registry.getActiveModeName();
    const guidedModePref = !!(comic.guidedMode === true || comic.guidedMode == 1);
    const bubbleModePref = !!(comic.bubbleMode === true || comic.bubbleMode == 1);
    const hotZoomModePref = !!(comic.hotZoomMode === true || comic.hotZoomMode == 1);
    const mangaBubbleHotPref = !!(comic.mangaBubbleHotMode === true || comic.mangaBubbleHotMode == 1);

    if (isManga && processed && guidedModePref && activeModeName !== 'guided') {
      await enable();
    } else if (isManga && (!processed || !guidedModePref) && activeModeName === 'guided') {
      disable();
    }
    
    if (!isManga && processed && bubbleModePref && activeModeName !== 'bubble') {
      await enableBubble();
    } else if (!isManga && (!processed || !bubbleModePref) && activeModeName === 'bubble') {
      disableBubble();
    }

    if (processed && hotZoomModePref && activeModeName !== 'hot-zoom') {
      await enableHotZoom();
    } else if ((!processed || !hotZoomModePref) && activeModeName === 'hot-zoom') {
      disableHotZoom();
    }

    if (isManga && processed && mangaBubbleHotPref && activeModeName !== 'manga-bubble-hot') {
      await enableMangaBubbleHot();
    } else if (isManga && (!processed || !mangaBubbleHotPref) && activeModeName === 'manga-bubble-hot') {
      disableMangaBubbleHot();
    }

    updateAllUI();
  }

  function bindToggleButton() {
    const registry = global.GuidedView.ModeRegistry;

    const btn = document.getElementById('guided-toggle-btn');
    if (btn && !btn._guidedBound) {
      btn._guidedBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'guided';
        if (willActivate) await enable(); else disable();
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
        if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode || !isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'bubble';
        if (willActivate) await enableBubble(); else disableBubble();
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
        if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode || !isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'manga-bubble-hot';
        if (willActivate) await enableMangaBubbleHot(); else disableMangaBubbleHot();
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
        if (!comic || comic.guidedViewStatus !== 'completed' || !isFullscreenOpen()) return;
        const willActivate = registry.getActiveModeName() !== 'hot-zoom';
        if (willActivate) await enableHotZoom(); else disableHotZoom();
        comic.hotZoomMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { hotZoomMode: willActivate });
        registry.saveModePreference(comic.id, 'hot-zoom', willActivate);
      });
    }
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
    const activeMode = registry.getActiveMode();
    // Simplified check: if any mode is active, we assume it might be engaged 
    // but we can be more specific if needed.
    // Actually, we can just check if getRenderState().targetBox is set.
    return !!getRenderState().targetBox;
  }

  function isAnyGuidedActive() {
    return !!global.GuidedView.ModeRegistry.getActiveModeName();
  }

  function init() {
    bindToggleButton();
    watchFullscreenToggle();
    if (!document.getElementById('__guided_zoom_style')) {
      const style = document.createElement('style');
      style.id = '__guided_zoom_style';
      style.textContent = `
        .guided-zoom-no-touchmenu, .guided-zoom-no-touchmenu * {
          -webkit-touch-callout: none !important;
          -webkit-user-select: none !important;
          user-select: none !important;
        }
        .guided-zoom-no-touchmenu img { pointer-events: auto; }
      `;
      document.head.appendChild(style);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function disableAll() {
    global.GuidedView.ModeRegistry.disableAll();
  }

  Object.assign(global.GuidedView, {
    enable, disable, toggle, tryAdvance, onPageRendered, isActive, refreshGuidedToggle,
    enableBubble, disableBubble, toggleBubble, isBubbleActive,
    enableHotZoom, disableHotZoom, toggleHotZoom, isHotZoomActive,
    enableMangaBubbleHot, disableMangaBubbleHot, toggleMangaBubbleHot, isMangaBubbleHotActive,
    disableAll, isZoomEngaged, isAnyGuidedActive,
    isFullscreenOpen, refreshRender // Need these for modes to call back
  });
  global.tryGuidedAdvance = tryAdvance;
  global.onGuidedPageRendered = onPageRendered;
  global.toggleGuidedView = toggle;
  global.toggleBubbleView = toggleBubble;
  global.toggleHotZoomView = toggleHotZoom;
  global.refreshGuidedToggle = refreshGuidedToggle;

  window.addEventListener('resize', () => {
    if (isAnyGuidedActive()) {
      requestAnimationFrame(refreshRender);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
