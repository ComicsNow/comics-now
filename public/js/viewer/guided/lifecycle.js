import { state } from '../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

export function isFullscreenOpen() {
  const fv = document.getElementById('fullscreen-viewer');
  return !!(fv && !fv.classList.contains('hidden'));
}

export function onPageRendered() {
  const registry = state.GuidedView.ModeRegistry;
  if (!registry.getActiveModeName()) return;
  
  if (!isFullscreenOpen()) { 
    registry.disableAll();
    return; 
  }
  
  const activeMode = registry.getActiveMode();
  if (activeMode) activeMode.onPageRendered();

  requestAnimationFrame(state.GuidedView.refreshRender);
}

// Refresh button enabled state and auto-enable per saved preference.
export async function refreshGuidedToggle() {
  const btn = document.getElementById('manga-guided-toggle-btn');
  const westernBtn = document.getElementById('western-guided-toggle-btn');
  const westernSpeechBtn = document.getElementById('western-speech-zoom');
  const mangaPanelBtn = document.getElementById('manga-panel-zoom');
  const mangaSpeechBtn = document.getElementById('manga-speech-zoom-btn');

  const comic = state.currentComic || window.currentComic;
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
  const isContinuous = !!(state.isContinuousMode || window.isContinuousMode);
  const isFullImage = !!(state.isFullImageMode || window.isFullImageMode);
  const isLandscape = !!(state.isLandscapeOrientation || window.isLandscapeOrientation);
  
  const getIsDesktop = state.isDesktopDevice || window.isDesktopDevice;
  const isDesktop = typeof getIsDesktop === 'function' && getIsDesktop();

  if (processed && !state.GuidedView.cache.has(comic.id)) {
    await state.GuidedView.loadGuidedView(comic.id);
  }

  const data = state.GuidedView.cache.get(comic.id);

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

  const registry = state.GuidedView.ModeRegistry;
  if (registry.isTransitioning()) return;

  if (!isFullscreenOpen()) {
    registry.disableAll();
    if (typeof state.GuidedView.updateAllUI === 'function') state.GuidedView.updateAllUI();
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
    if (state.GuidedView.enable) await state.GuidedView.enable();
  } else if (isManga && (!processed || !guidedModePref) && activeModeName === 'guided') {
    if (state.GuidedView.disable) state.GuidedView.disable();
  }
  
  if (!isManga && processed && bubbleModePref && activeModeName !== 'bubble') {
    if (state.GuidedView.enableBubble) await state.GuidedView.enableBubble();
  } else if (!isManga && (!processed || !bubbleModePref) && activeModeName === 'bubble') {
    if (state.GuidedView.disableBubble) state.GuidedView.disableBubble();
  }

  if (!isManga && processed && hotZoomModePref && activeModeName !== 'western-speech-zoom' && !isDesktop) {
    if (state.GuidedView.enableWesternSpeechZoom) await state.GuidedView.enableWesternSpeechZoom();
  } else if (!isManga && (!processed || !hotZoomModePref || isDesktop) && activeModeName === 'western-speech-zoom') {
    if (state.GuidedView.disableWesternSpeechZoom) state.GuidedView.disableWesternSpeechZoom();
  }

  if (isManga && processed && hotZoomModePref && activeModeName !== 'manga-panel-zoom') {
    if (state.GuidedView.enableMangaPanelZoom) await state.GuidedView.enableMangaPanelZoom();
  } else if (isManga && (!processed || !hotZoomModePref) && activeModeName === 'manga-panel-zoom') {
    if (state.GuidedView.disableMangaPanelZoom) state.GuidedView.disableMangaPanelZoom();
  }

  if (isManga && processed && mangaSpeechPref && activeModeName !== 'manga-speech-zoom' && !isDesktop) {
    if (state.GuidedView.enableMangaSpeechZoom) await state.GuidedView.enableMangaSpeechZoom();
  } else if (isManga && (!processed || !mangaSpeechPref || isDesktop) && activeModeName === 'manga-speech-zoom') {
    if (state.GuidedView.disableMangaSpeechZoom) state.GuidedView.disableMangaSpeechZoom();
  }

  if (typeof state.GuidedView.updateAllUI === 'function') state.GuidedView.updateAllUI();
}

export function watchFullscreenToggle() {
  const fv = document.getElementById('fullscreen-viewer');
  if (!fv || fv._guidedObserver) return;
  const observer = new MutationObserver(() => {
    const open = isFullscreenOpen();
    if (open) refreshGuidedToggle();
    else state.GuidedView.ModeRegistry.disableAll();
  });
  observer.observe(fv, { attributes: true, attributeFilter: ['class'] });
  fv._guidedObserver = observer;
}

export function isZoomEngaged() {
  const registry = state.GuidedView.ModeRegistry;
  if (registry.getManualOverrideBox()) return true;
  
  // Check if any mode is active and providing a targetBox
  if (typeof state.GuidedView.getRenderState === 'function') {
    return !!state.GuidedView.getRenderState().targetBox;
  }
  return false;
}

export function isAnyGuidedActive() {
  return !!state.GuidedView.ModeRegistry.getActiveModeName();
}

Object.assign(state.GuidedView, {
  isFullscreenOpen,
  onPageRendered,
  watchFullscreenToggle,
  refreshGuidedToggle,
  isZoomEngaged,
  isAnyGuidedActive
});

if (typeof window !== 'undefined') {
  Object.assign(window.GuidedView, {
    isFullscreenOpen,
    onPageRendered,
    watchFullscreenToggle,
    refreshGuidedToggle,
    isZoomEngaged,
    isAnyGuidedActive
  });
}

window.addEventListener('resize', () => {
  if (isAnyGuidedActive()) {
    requestAnimationFrame(state.GuidedView.refreshRender);
  }
});
