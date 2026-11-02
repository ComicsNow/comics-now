/**
 * Continuous Mode - Vertical scroll through all pages like webtoon/manga reader
 * Facade module delegating to state, progress, virtualizer, and lifecycle submodules.
 */

import { state } from './globals.js';
import { continuousState } from './continuous/state.js';
import {
  updateContinuousModeUI,
  scrollToNextPage,
  scrollToPreviousPage,
  updateContinuousModeInCache
} from './continuous/progress.js';
import {
  renderContinuousMode,
  applyContinuousOrientation
} from './continuous/virtualizer.js';
import {
  enableContinuousMode,
  disableContinuousMode,
  toggleContinuousMode,
  initializeContinuousMode
} from './continuous/lifecycle.js';

export {
  renderContinuousMode,
  enableContinuousMode,
  disableContinuousMode,
  updateContinuousModeUI,
  scrollToNextPage,
  scrollToPreviousPage,
  toggleContinuousMode,
  updateContinuousModeInCache,
  initializeContinuousMode,
  applyContinuousOrientation
};

window.addEventListener('resize', () => {
  const isContinuousModeVal = state.isContinuousMode || window.isContinuousMode;
  if (isContinuousModeVal && continuousState.continuousContainer) {
    applyContinuousOrientation();
  }
});

export const ContinuousMode = {
  enableContinuousMode,
  disableContinuousMode,
  toggleContinuousMode,
  renderContinuousMode,
  initializeContinuousMode,
  updateContinuousModeInCache,
  updateContinuousModeUI,
  applyContinuousOrientation,
  scrollToNextPage,
  scrollToPreviousPage
};

state.scrollToNextPage = scrollToNextPage;
state.scrollToPreviousPage = scrollToPreviousPage;
state.applyContinuousOrientation = applyContinuousOrientation;
state.ContinuousMode = ContinuousMode;
state.enableContinuousMode = enableContinuousMode;
state.disableContinuousMode = disableContinuousMode;
state.toggleContinuousMode = toggleContinuousMode;
state.initializeContinuousMode = initializeContinuousMode;
state.updateContinuousModeUI = updateContinuousModeUI;
state.updateContinuousModeInCache = updateContinuousModeInCache;
state.isContinuousMode = continuousState.isContinuousMode;

if (typeof window !== 'undefined') {
  window.scrollToNextPage = scrollToNextPage;
  window.scrollToPreviousPage = scrollToPreviousPage;
  window.applyContinuousOrientation = applyContinuousOrientation;
  window.ContinuousMode = ContinuousMode;
  window.enableContinuousMode = enableContinuousMode;
  window.disableContinuousMode = disableContinuousMode;
  window.toggleContinuousMode = toggleContinuousMode;
  window.initializeContinuousMode = initializeContinuousMode;
  window.updateContinuousModeUI = updateContinuousModeUI;
  window.updateContinuousModeInCache = updateContinuousModeInCache;
  window.isContinuousMode = continuousState.isContinuousMode;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContinuousMode);
} else {
  initializeContinuousMode();
}
