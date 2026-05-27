// Guided View — pan/zoom panel-by-panel navigation in **fullscreen** only.
// Loads the per-comic JSON sidecar of panel rectangles, then on each navigate
// step (next/prev/keyboard) advances `panelIndex`, animating a CSS transform
// on the existing #fullscreen-image so the panel fills the screen.

import { state } from '../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

function getImg() { return document.getElementById('fullscreen-image'); }

/**
 * Internal helper to determine the current target box and zoom style 
 * based on active modes and indices.
 */
export function getRenderState() {
  const registry = state.GuidedView.ModeRegistry;
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
 * in state.GuidedView (from overlay.js).
 */
export function refreshRender() {
  const { targetBox, isPanelZoom } = getRenderState();
  const registry = state.GuidedView.ModeRegistry;
  const activeModeName = registry.getActiveModeName();
  
  // 1. Classes and CSS
  const isManga = state.GuidedView.isMangaComic();
  const needsMangaLayout = activeModeName === 'guided' && isManga;
  state.GuidedView.applyClasses(needsMangaLayout);

  const isAnyActive = !!activeModeName || !!registry.getManualOverrideBox();
  state.GuidedView.applyZoomCss(isAnyActive);

  // 2. Main image transform (Manga sequential only)
  if (needsMangaLayout) {
    const activeMode = registry.getActiveMode();
    const panels = state.GuidedView.currentPagePanels();
    const panelIndex = activeMode.getPanelIndex ? activeMode.getPanelIndex() : -1;
    const currentTarget = (panelIndex >= 0 && panelIndex < panels.length) ? panels[panelIndex] : null;
    state.GuidedView.applyTransform(currentTarget, isManga);
  } else {
    const img = getImg();
    if (img) img.style.transform = '';
  }

  // 3. Bubble overlay (Western sequential, Bubble Zoom, Western Speech Zoom, Manga Panel Zoom)
  const isWesternSequential = activeModeName === 'guided' && !isManga;
  const manualOverrideBox = registry.getManualOverrideBox();
  if (isWesternSequential || activeModeName === 'bubble' || activeModeName === 'western-speech-zoom' || activeModeName === 'manga-panel-zoom' || activeModeName === 'manga-speech-zoom' || manualOverrideBox) {
    state.GuidedView.applyBubbleOverlay(targetBox, isPanelZoom);
  } else {
    state.GuidedView.applyBubbleOverlay(null);
  }
}

export function updateAllUI() {
  const registry = state.GuidedView.ModeRegistry;
  ['guided', 'bubble', 'western-speech-zoom', 'manga-panel-zoom', 'manga-speech-zoom'].forEach(name => {
    const mode = registry.get(name);
    if (mode) mode.updateUI();
  });
}

// True if guided/bubble consumed the navigation; false → caller advances page.
// Index walk: -1 (full page) → 0 → 1 → ... → N-1 → page advance.
// Reverse:    -1 (full page) → previous page; 0 → -1; 1 → 0; etc.
export function tryAdvance(direction) {
  const registry = state.GuidedView.ModeRegistry;
  const activeMode = registry.getActiveMode();
  if (!activeMode) return false;
  
  if (!state.GuidedView.isFullscreenOpen()) { 
    registry.disableAll();
    return false; 
  }
  
  const advanced = activeMode.tryAdvance(direction);
  if (advanced && typeof state.triggerEinkFlash === 'function') {
    state.triggerEinkFlash();
  }
  return advanced;
}

export async function enable() { return state.GuidedView.ModeRegistry.enable('guided'); }
export function disable() { state.GuidedView.ModeRegistry.disable('guided'); }
export async function toggle() { return state.GuidedView.ModeRegistry.toggle('guided'); }
export function isActive() { return state.GuidedView.ModeRegistry.getActiveModeName() === 'guided'; }

export async function enableBubble() { return state.GuidedView.ModeRegistry.enable('bubble'); }
export function disableBubble() { state.GuidedView.ModeRegistry.disable('bubble'); }
export async function toggleBubble() { return state.GuidedView.ModeRegistry.toggle('bubble'); }
export function isBubbleActive() { return state.GuidedView.ModeRegistry.getActiveModeName() === 'bubble'; }

export async function enableWesternSpeechZoom() { return state.GuidedView.ModeRegistry.enable('western-speech-zoom'); }
export function disableWesternSpeechZoom() { state.GuidedView.ModeRegistry.disable('western-speech-zoom'); }
export async function toggleWesternSpeechZoom() { return state.GuidedView.ModeRegistry.toggle('western-speech-zoom'); }
export function isWesternSpeechZoomActive() { return state.GuidedView.ModeRegistry.getActiveModeName() === 'western-speech-zoom'; }

export async function enableMangaPanelZoom() { return state.GuidedView.ModeRegistry.enable('manga-panel-zoom'); }
export function disableMangaPanelZoom() { state.GuidedView.ModeRegistry.disable('manga-panel-zoom'); }
export async function toggleMangaPanelZoom() { return state.GuidedView.ModeRegistry.toggle('manga-panel-zoom'); }
export function isMangaPanelZoomActive() { return state.GuidedView.ModeRegistry.getActiveModeName() === 'manga-panel-zoom'; }

export async function enableMangaSpeechZoom() { return state.GuidedView.ModeRegistry.enable('manga-speech-zoom'); }
export function disableMangaSpeechZoom() { state.GuidedView.ModeRegistry.disable('manga-speech-zoom'); }
export async function toggleMangaSpeechZoom() { return state.GuidedView.ModeRegistry.toggle('manga-speech-zoom'); }
export function isMangaSpeechZoomActive() { return state.GuidedView.ModeRegistry.getActiveModeName() === 'manga-speech-zoom'; }

function init() {
  if (typeof state.GuidedView.bindToggleButton === 'function') state.GuidedView.bindToggleButton();
  else if (typeof window.GuidedView?.bindToggleButton === 'function') window.GuidedView.bindToggleButton();
  if (typeof state.GuidedView.watchFullscreenToggle === 'function') state.GuidedView.watchFullscreenToggle();
  else if (typeof window.GuidedView?.watchFullscreenToggle === 'function') window.GuidedView.watchFullscreenToggle();
  
  if (!document.getElementById('__guided_zoom_style')) {
    const style = document.createElement('style');
    style.id = '__guided_zoom_style';
    style.textContent = `
      .guided-zoom-no-touchmenu, .guided-zoom-no-touchmenu * {
        -webkit-touch-callout: none !important;
        -webkit-user-select: none !important;
        user-select: none !important;
        touch-action: none !important;
      }
      .guided-zoom-no-touchmenu img { pointer-events: auto; }
    `;
    document.head.appendChild(style);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

export function disableAll() {
  state.GuidedView.ModeRegistry.disableAll();
}

export function getActiveModeName() { return state.GuidedView.ModeRegistry.getActiveModeName(); }

export function isAnyActive() {
  const registry = state.GuidedView.ModeRegistry;
  return !!registry.getActiveModeName() || !!registry.getManualOverrideBox();
}

Object.assign(state.GuidedView, {
  getRenderState, refreshRender, updateAllUI, tryAdvance, 
  getActiveModeName, isAnyActive,
  enable, disable, toggle, isActive,
  enableBubble, disableBubble, toggleBubble, isBubbleActive,
  enableWesternSpeechZoom, disableWesternSpeechZoom, toggleWesternSpeechZoom, isWesternSpeechZoomActive,
  enableMangaPanelZoom, disableMangaPanelZoom, toggleMangaPanelZoom, isMangaPanelZoomActive,
  enableMangaSpeechZoom, disableMangaSpeechZoom, toggleMangaSpeechZoom, isMangaSpeechZoomActive,
  disableAll
});

if (typeof window !== 'undefined') {
  Object.assign(window.GuidedView, {
    getRenderState, refreshRender, updateAllUI, tryAdvance, 
    getActiveModeName, isAnyActive,
    enable, disable, toggle, isActive,
    enableBubble, disableBubble, toggleBubble, isBubbleActive,
    enableWesternSpeechZoom, disableWesternSpeechZoom, toggleWesternSpeechZoom, isWesternSpeechZoomActive,
    enableMangaPanelZoom, disableMangaPanelZoom, toggleMangaPanelZoom, isMangaPanelZoomActive,
    enableMangaSpeechZoom, disableMangaSpeechZoom, toggleMangaSpeechZoom, isMangaSpeechZoomActive,
    disableAll
  });

  window.tryGuidedAdvance = tryAdvance;
  
  Object.defineProperty(window, 'onGuidedPageRendered', {
    get() {
      return (typeof state.GuidedView.onPageRendered === 'function') ? state.GuidedView.onPageRendered : null;
    },
    configurable: true
  });
  
  window.toggleGuidedView = toggle;
  window.toggleBubbleView = toggleBubble;
  window.toggleWesternSpeechZoomView = toggleWesternSpeechZoom;
  window.toggleMangaPanelZoomView = toggleMangaPanelZoom;
  window.toggleMangaSpeechZoomView = toggleMangaSpeechZoom;
  
  Object.defineProperty(window, 'refreshGuidedToggle', {
    get() {
      return (typeof state.GuidedView.refreshGuidedToggle === 'function') ? state.GuidedView.refreshGuidedToggle : null;
    },
    configurable: true
  });
}

// Ensure the same properties are exposed on state too for consistency
state.tryGuidedAdvance = tryAdvance;
Object.defineProperty(state, 'onGuidedPageRendered', {
  get() {
    return (typeof state.GuidedView.onPageRendered === 'function') ? state.GuidedView.onPageRendered : null;
  },
  configurable: true
});
state.toggleGuidedView = toggle;
state.toggleBubbleView = toggleBubble;
state.toggleWesternSpeechZoomView = toggleWesternSpeechZoom;
state.toggleMangaPanelZoomView = toggleMangaPanelZoom;
state.toggleMangaSpeechZoomView = toggleMangaSpeechZoom;
Object.defineProperty(state, 'refreshGuidedToggle', {
  get() {
    return (typeof state.GuidedView.refreshGuidedToggle === 'function') ? state.GuidedView.refreshGuidedToggle : null;
  },
  configurable: true
});
