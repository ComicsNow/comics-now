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
    registry.disableAll({ persist: false });
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
    const ready = !isManga && processed && hasBubbles && !isContinuous && !isFullImage && !isLandscape;
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
    const ready = isManga && processed && hasMangaBoxes && !isContinuous && !isFullImage && !isLandscape;
    mangaSpeechBtn.style.display = ready ? 'flex' : 'none';
    mangaSpeechBtn.disabled = !ready;
  }

  const registry = state.GuidedView.ModeRegistry;
  if (registry.isTransitioning()) return;

  if (!isFullscreenOpen()) {
    registry.disableAll({ persist: false });
    if (typeof state.GuidedView.updateAllUI === 'function') state.GuidedView.updateAllUI();
    return;
  }
  
  const activeModeName = registry.getActiveModeName();
  
  // Resolve preferred mode from localStorage / comic properties / global defaults
  let preferredMode = null;
  try {
    const localPref = localStorage.getItem(`guided_pref_${comic.id}`);
    if (localPref === 'none') {
      preferredMode = null;
    } else if (localPref) {
      preferredMode = localPref;
    } else {
      // Check comic properties first
      if (comic.guidedMode) preferredMode = 'guided';
      else if (comic.bubbleMode) preferredMode = 'bubble';
      else if (comic.hotZoomMode) preferredMode = isManga ? 'manga-panel-zoom' : 'western-speech-zoom';
      else if (comic.mangaBubbleHotMode) preferredMode = 'manga-speech-zoom';
      else if (localStorage.getItem('guided_pref_global_active') === 'true') {
        const lastMode = localStorage.getItem('guided_pref_last_mode');
        if (isManga) {
          if (lastMode === 'guided' || lastMode === 'manga-panel-zoom' || lastMode === 'manga-speech-zoom') {
            preferredMode = lastMode;
          } else if (lastMode === 'western-speech-zoom') {
            preferredMode = 'manga-speech-zoom';
          } else {
            preferredMode = 'guided';
          }
        } else {
          if (lastMode === 'bubble' || lastMode === 'western-speech-zoom') {
            preferredMode = lastMode;
          } else if (lastMode === 'manga-speech-zoom') {
            preferredMode = 'western-speech-zoom';
          } else {
            preferredMode = 'bubble';
          }
        }
      }
    }
  } catch (e) { /* ignore */ }

  // Normalize preferredMode to match comic mangaMode
  if (preferredMode) {
    if (isManga) {
      if (preferredMode === 'bubble') preferredMode = 'guided';
      else if (preferredMode === 'western-speech-zoom') preferredMode = 'manga-speech-zoom';
    } else {
      if (preferredMode === 'guided' || preferredMode === 'manga-panel-zoom') preferredMode = 'bubble';
      else if (preferredMode === 'manga-speech-zoom') preferredMode = 'western-speech-zoom';
    }
  }

  // Sync comic object flags with preferredMode
  comic.guidedMode = preferredMode === 'guided';
  comic.bubbleMode = preferredMode === 'bubble';
  comic.hotZoomMode = preferredMode === 'western-speech-zoom' || preferredMode === 'manga-panel-zoom';
  comic.mangaBubbleHotMode = preferredMode === 'manga-speech-zoom';

  if (!isContinuous && !isFullImage && !isLandscape && processed) {
    if (isManga && preferredMode === 'guided' && activeModeName !== 'guided') {
      if (state.GuidedView.enable) await state.GuidedView.enable({ persist: false });
    } else if (!isManga && preferredMode === 'bubble' && activeModeName !== 'bubble') {
      if (state.GuidedView.enableBubble) await state.GuidedView.enableBubble({ persist: false });
    } else if (!isManga && preferredMode === 'western-speech-zoom' && activeModeName !== 'western-speech-zoom') {
      if (state.GuidedView.enableWesternSpeechZoom) await state.GuidedView.enableWesternSpeechZoom({ persist: false });
    } else if (isManga && preferredMode === 'manga-panel-zoom' && activeModeName !== 'manga-panel-zoom') {
      if (state.GuidedView.enableMangaPanelZoom) await state.GuidedView.enableMangaPanelZoom({ persist: false });
    } else if (isManga && preferredMode === 'manga-speech-zoom' && activeModeName !== 'manga-speech-zoom') {
      if (state.GuidedView.enableMangaSpeechZoom) await state.GuidedView.enableMangaSpeechZoom({ persist: false });
    } else if (!preferredMode && activeModeName) {
      registry.disableAll({ persist: false });
    }
  } else if (activeModeName) {
    registry.disableAll({ persist: false });
  }

  if (typeof state.GuidedView.updateAllUI === 'function') state.GuidedView.updateAllUI();
}

export function watchFullscreenToggle() {
  const fv = document.getElementById('fullscreen-viewer');
  if (!fv || fv._guidedObserver) return;
  const observer = new MutationObserver(() => {
    const open = isFullscreenOpen();
    if (open) refreshGuidedToggle();
    else state.GuidedView.ModeRegistry.disableAll({ persist: false });
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
