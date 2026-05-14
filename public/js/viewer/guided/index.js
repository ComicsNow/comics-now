// Guided View — pan/zoom panel-by-panel navigation in **fullscreen** only.
// Loads the per-comic JSON sidecar of panel rectangles, then on each navigate
// step (next/prev/keyboard) advances `panelIndex`, animating a CSS transform
// on the existing #fullscreen-image so the panel fills the screen.

(function (global) {
  'use strict';

  global.GuidedView = global.GuidedView || {};

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
    
    if (!global.GuidedView.isFullscreenOpen()) { 
      registry.disableAll();
      return false; 
    }
    
    return activeMode.tryAdvance(direction);
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

  function init() {
    if (typeof global.GuidedView.bindToggleButton === 'function') global.GuidedView.bindToggleButton();
    if (typeof global.GuidedView.watchFullscreenToggle === 'function') global.GuidedView.watchFullscreenToggle();
    
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
    getRenderState, refreshRender, updateAllUI, tryAdvance, 
    enable, disable, toggle, isActive,
    enableBubble, disableBubble, toggleBubble, isBubbleActive,
    enableHotZoom, disableHotZoom, toggleHotZoom, isHotZoomActive,
    enableMangaBubbleHot, disableMangaBubbleHot, toggleMangaBubbleHot, isMangaBubbleHotActive,
    disableAll
  });

  global.tryGuidedAdvance = tryAdvance;
  global.onGuidedPageRendered = (typeof global.GuidedView.onPageRendered === 'function') ? global.GuidedView.onPageRendered : null;
  global.toggleGuidedView = toggle;
  global.toggleBubbleView = toggleBubble;
  global.toggleHotZoomView = toggleHotZoom;
  global.refreshGuidedToggle = (typeof global.GuidedView.refreshGuidedToggle === 'function') ? global.GuidedView.refreshGuidedToggle : null;

})(typeof window !== 'undefined' ? window : globalThis);
