import { state, actions } from '../globals.js';
import { continuousState } from './state.js';
import {
  updateContinuousModeUI,
  scrollToNextPage,
  scrollToPreviousPage,
  updateContinuousModeInCache
} from './progress.js';
import {
  initIntersectionObserver,
  renderContinuousMode
} from './virtualizer.js';

/**
 * Enable continuous scroll mode (fullscreen only)
 */
export async function enableContinuousMode() {
  const GuidedView = state.GuidedView || window.GuidedView;
  const registry = GuidedView?.ModeRegistry || state.GuidedView?.ModeRegistry;
  if (registry && typeof registry.disableAll === 'function') {
    registry.disableAll({ persist: true });
  } else if (typeof GuidedView?.disableAll === 'function') {
    GuidedView.disableAll({ persist: true });
  }

  const currentComic = state.currentComic || window.currentComic;
  if (currentComic) {
    currentComic.continuousMode = true;
    currentComic.guidedMode = false;
    currentComic.bubbleMode = false;
    currentComic.hotZoomMode = false;
    currentComic.mangaBubbleHotMode = false;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem(`guided_pref_${currentComic.id}`, 'none');
        localStorage.setItem('guided_pref_global_active', 'false');
      }
    } catch (_) {}

    const updateComicInLibrary = state.updateComicInLibrary || window.updateComicInLibrary;
    if (typeof updateComicInLibrary === 'function') {
      updateComicInLibrary(currentComic.id, {
        continuousMode: true,
        guidedMode: false,
        bubbleMode: false,
        hotZoomMode: false,
        mangaBubbleHotMode: false
      });
    }
  }

  if (typeof GuidedView?.updateAllUI === 'function') {
    GuidedView.updateAllUI();
  }

  continuousState.isContinuousMode = true;
  const actionsRef = (typeof actions !== 'undefined' ? actions : (typeof state !== 'undefined' ? state?.actions : null));
  if (actionsRef?.viewer?.setContinuousMode) {
    actionsRef.viewer.setContinuousMode(true);
  } else {
    state.isContinuousMode = true;
  }

  const refreshGuidedToggle = state.refreshGuidedToggle || window.refreshGuidedToggle;
  if (typeof refreshGuidedToggle === 'function') {
    try { refreshGuidedToggle().catch?.(() => {}); } catch (_) {}
  }

  const fullscreenViewer = document.getElementById('fullscreen-viewer');
  const isFullscreen = fullscreenViewer && !fullscreenViewer.classList.contains('hidden');

  if (!isFullscreen) {
    return;
  }

  fullscreenViewer.classList.add('continuous-active');
  fullscreenViewer.classList.remove('guided-stage');
  fullscreenViewer.classList.remove('guided-zoom-no-touchmenu');

  const bubbleOverlay = document.getElementById('bubble-magnifier-overlay');
  if (bubbleOverlay) {
    bubbleOverlay.style.display = 'none';
    bubbleOverlay.style.opacity = '0';
    bubbleOverlay.style.pointerEvents = 'none';
  }

  const fullscreenImage = document.getElementById('fullscreen-image');
  if (fullscreenImage) {
    fullscreenImage.classList.add('hidden');
  }

  continuousState.continuousContainer = document.getElementById('fullscreen-pages-continuous');
  const continuousContainer = continuousState.continuousContainer;
  if (continuousContainer) {
    continuousContainer.classList.remove('hidden');

    const showFullscreenControls = state.showFullscreenControls || window.showFullscreenControls;
    continuousState.continuousClickHandler = () => {
      if (typeof showFullscreenControls === 'function') {
        showFullscreenControls(true);
      }
    };
    continuousContainer.addEventListener('click', continuousState.continuousClickHandler);
  }

  await renderContinuousMode();

  const prevBtn = document.getElementById('fullscreen-prev-page-btn');
  const nextBtn = document.getElementById('fullscreen-next-page-btn');
  const navLeft = document.getElementById('fullscreen-nav-left');
  const navRight = document.getElementById('fullscreen-nav-right');
  const originalNavigationState = continuousState.originalNavigationState;

  if (prevBtn && nextBtn) {
    if (!originalNavigationState.prevBtnHandler) {
      originalNavigationState.prevBtnText = prevBtn.textContent;
      originalNavigationState.nextBtnText = nextBtn.textContent;
      originalNavigationState.prevBtnHandler = prevBtn._navListener;
      originalNavigationState.nextBtnHandler = nextBtn._navListener;
    }

    prevBtn.textContent = '↑';
    nextBtn.textContent = '↓';

    if (prevBtn._navListener) {
      prevBtn.removeEventListener('click', prevBtn._navListener);
    }
    if (nextBtn._navListener) {
      nextBtn.removeEventListener('click', nextBtn._navListener);
    }

    prevBtn._continuousListener = (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToPreviousPage();
    };
    nextBtn._continuousListener = (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToNextPage();
    };

    prevBtn.addEventListener('click', prevBtn._continuousListener);
    nextBtn.addEventListener('click', nextBtn._continuousListener);

    prevBtn.setAttribute('title', 'Previous page (scroll up)');
    prevBtn.setAttribute('aria-label', 'Previous page (scroll up)');
    nextBtn.setAttribute('title', 'Next page (scroll down)');
    nextBtn.setAttribute('aria-label', 'Next page (scroll down)');
  }

  if (navLeft && navRight) {
    if (!originalNavigationState.navLeftHandler) {
      originalNavigationState.navLeftHandler = navLeft.onclick;
      originalNavigationState.navRightHandler = navRight.onclick;
    }

    navLeft.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToPreviousPage();
    };
    navRight.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToNextPage();
    };
  }

  updateContinuousModeUI(true);
}

/**
 * Disable continuous mode and return to page-by-page
 */
export async function disableContinuousMode() {
  continuousState.isContinuousMode = false;
  const actionsRef = (typeof actions !== 'undefined' ? actions : (typeof state !== 'undefined' ? state?.actions : null));
  if (actionsRef?.viewer?.setContinuousMode) {
    actionsRef.viewer.setContinuousMode(false);
  } else {
    state.isContinuousMode = false;
  }

  const currentComic = state.currentComic || window.currentComic;
  if (currentComic) {
    currentComic.continuousMode = false;
    const updateComicInLibrary = state.updateComicInLibrary || window.updateComicInLibrary;
    if (typeof updateComicInLibrary === 'function') {
      updateComicInLibrary(currentComic.id, { continuousMode: false });
    }
  }

  const refreshGuidedToggle = state.refreshGuidedToggle || window.refreshGuidedToggle;
  if (typeof refreshGuidedToggle === 'function') {
    try { refreshGuidedToggle().catch?.(() => {}); } catch (_) {}
  }

  const fullscreenViewer = document.getElementById('fullscreen-viewer');
  const isFullscreen = fullscreenViewer && !fullscreenViewer.classList.contains('hidden');
  const continuousContainer = continuousState.continuousContainer;

  if (isFullscreen) {
    if (fullscreenViewer) {
      fullscreenViewer.classList.remove('continuous-active');
    }
    const fullscreenImage = document.getElementById('fullscreen-image');
    if (fullscreenImage) {
      fullscreenImage.classList.remove('hidden');
    }

    if (continuousContainer) {
      if (continuousState.continuousClickHandler) {
        continuousContainer.removeEventListener('click', continuousState.continuousClickHandler);
        continuousState.continuousClickHandler = null;
      }

      continuousContainer.classList.add('hidden');
    }

    const renderPage = state.renderPage || window.renderPage;
    if (typeof renderPage === 'function') {
      await renderPage();
    }
  } else {
    if (continuousContainer) {
      if (continuousState.continuousClickHandler) {
        continuousContainer.removeEventListener('click', continuousState.continuousClickHandler);
        continuousState.continuousClickHandler = null;
      }
    }
  }

  if (continuousState.intersectionObserver) {
    continuousState.intersectionObserver.disconnect();
  }

  const prevBtn = document.getElementById('fullscreen-prev-page-btn');
  const nextBtn = document.getElementById('fullscreen-next-page-btn');
  const navLeft = document.getElementById('fullscreen-nav-left');
  const navRight = document.getElementById('fullscreen-nav-right');
  const originalNavigationState = continuousState.originalNavigationState;

  if (prevBtn && nextBtn) {
    if (prevBtn._continuousListener) {
      prevBtn.removeEventListener('click', prevBtn._continuousListener);
      prevBtn._continuousListener = null;
    }
    if (nextBtn._continuousListener) {
      nextBtn.removeEventListener('click', nextBtn._continuousListener);
      nextBtn._continuousListener = null;
    }

    prevBtn.textContent = originalNavigationState.prevBtnText;
    nextBtn.textContent = originalNavigationState.nextBtnText;

    if (originalNavigationState.prevBtnHandler) {
      prevBtn.addEventListener('click', originalNavigationState.prevBtnHandler);
    }
    if (originalNavigationState.nextBtnHandler) {
      nextBtn.addEventListener('click', originalNavigationState.nextBtnHandler);
    }

    prevBtn.setAttribute('title', 'Previous page');
    prevBtn.setAttribute('aria-label', 'Previous page');
    nextBtn.setAttribute('title', 'Next page');
    nextBtn.setAttribute('aria-label', 'Next page');
  }

  if (navLeft && navRight) {
    navLeft.onclick = originalNavigationState.navLeftHandler;
    navRight.onclick = originalNavigationState.navRightHandler;
  }

  updateContinuousModeUI(false);
}

/**
 * Toggle continuous mode (local state only)
 * @param {string} comicId - The comic ID
 * @param {boolean} currentMode - Current continuous mode state
 * @returns {boolean} - New continuous mode state
 */
export function toggleContinuousMode(comicId, currentMode) {
  return !currentMode;
}

/**
 * Setup click handler for continuous mode button
 * @param {HTMLElement} button - Button element
 */
export function setupContinuousModeButtonHandler(button) {
  if (!button || button._continuousAttached) return;
  button._continuousAttached = true;

  button.addEventListener('click', async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (continuousState.isSwitchingContinuousMode) return;
    continuousState.isSwitchingContinuousMode = true;

    const currentComic = state.currentComic || window.currentComic;
    if (!currentComic) {
      continuousState.isSwitchingContinuousMode = false;
      return;
    }

    try {
      const currentMode = currentComic.continuousMode || false;
      const newMode = toggleContinuousMode(currentComic.id, currentMode);

      currentComic.continuousMode = newMode;
      updateContinuousModeUI(newMode);

      if (newMode) {
        await enableContinuousMode();
      } else {
        await disableContinuousMode();
      }

      const updateComicInLibrary = state.updateComicInLibrary || window.updateComicInLibrary;
      if (typeof updateComicInLibrary === 'function') {
        updateComicInLibrary(currentComic.id, { continuousMode: newMode });
      }

      updateContinuousModeInCache(currentComic.id, newMode).catch(() => {});

      const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds;
      const updateDownloadedComicInfo = state.updateDownloadedComicInfo || window.updateDownloadedComicInfo;
      const isDownloaded = downloadedComicIds?.has(currentComic.id);
      if (isDownloaded && typeof updateDownloadedComicInfo === 'function') {
        updateDownloadedComicInfo(currentComic.id, { continuousMode: newMode }).catch(() => {});
      }

      const updateDownloadedSmartListComic = state.updateDownloadedSmartListComic || window.updateDownloadedSmartListComic;
      if (typeof updateDownloadedSmartListComic === 'function') {
        updateDownloadedSmartListComic(currentComic.id, { continuousMode: newMode });
      }
    } catch (error) {
      console.error('[CONTINUOUS] Error toggling continuous mode:', error);
      alert('Failed to toggle continuous mode. Please try again.');
    } finally {
      continuousState.isSwitchingContinuousMode = false;
    }
  });
}

/**
 * Initialize continuous mode - setup observers and button handlers (fullscreen only)
 */
export function initializeContinuousMode() {
  initIntersectionObserver();
  setupContinuousModeButtonHandler(document.getElementById('fullscreen-continuous-mode-btn'));
}
