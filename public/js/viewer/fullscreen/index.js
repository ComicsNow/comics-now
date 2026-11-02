import { state, global as canonicalGlobal } from '../../globals.js';

import {
  isLandscapePanActive,
  applyLandscapeTransform,
  resetLandscapePan,
  beginLandscapePan,
  updateLandscapePan,
  endLandscapePan,
  getLandscapePanState
} from './landscape-pan.js';

import {
  FULLSCREEN_CONTROLS_AUTOHIDE_DELAY,
  sanitizeComicTitleLocal,
  getCleanComicTitle,
  syncFullscreenTitle,
  showFullscreenControls,
  hideFullscreenControls,
  setupControlsAutohide
} from './controls.js';

import {
  showFullscreenPageJumpInput,
  hideFullscreenPageJumpInput,
  commitFullscreenPageJump,
  updateFullscreenViewerCentering,
  applyFullscreenFitMode
} from './fit.js';

import {
  isCinemaPanningActive,
  stopCinemaPan,
  checkSpreadCinemaStatus,
  maybeAutoPanCinema,
  startCinemaPan,
  toggleCinemaPan
} from './cinema-pan.js';

import {
  handleFullscreenImageClick,
  clearLongPress,
  makeLongPressHandlers,
  handleHotspotDblClick,
  triggerZoomAtClient,
  handleFullscreenPointerUpForDblTap,
  syncZoomToggleButton,
  bindFullscreenZoomToggle,
  bindFullscreenLongPress,
  cancelPendingSideNav
} from './gestures.js';

import {
  FULLSCREEN_MIN_ZOOM_SCALE,
  FULLSCREEN_MAX_ZOOM_SCALE,
  clamp,
  ensureFullscreenZoomBaseSize,
  updateFullscreenScrollFromRatios,
  applyFullscreenZoom,
  animateFullscreenPan,
  beginFullscreenPan,
  updateFullscreenPanPosition,
  endFullscreenPan,
  getDistanceBetweenPoints,
  handleFullscreenPointerDown,
  handleFullscreenPointerMove,
  handleFullscreenPointerUp,
  onFullscreenReset
} from './zoom-pan.js';

import {
  openFullscreen,
  closeFullscreen,
  updateFullscreenPageStatus,
  initFullscreenNavigation
} from './lifecycle.js';

export {
  FULLSCREEN_CONTROLS_AUTOHIDE_DELAY,
  FULLSCREEN_MIN_ZOOM_SCALE,
  FULLSCREEN_MAX_ZOOM_SCALE,
  showFullscreenControls,
  hideFullscreenControls,
  syncFullscreenTitle,
  getCleanComicTitle,
  openFullscreen,
  closeFullscreen,
  handleFullscreenImageClick,
  clamp,
  ensureFullscreenZoomBaseSize,
  updateFullscreenScrollFromRatios,
  applyFullscreenZoom,
  beginFullscreenPan,
  updateFullscreenPanPosition,
  endFullscreenPan,
  getDistanceBetweenPoints,
  handleFullscreenPointerDown,
  handleFullscreenPointerMove,
  handleFullscreenPointerUp,
  onFullscreenReset,
  updateFullscreenPageStatus,
  updateFullscreenViewerCentering,
  applyFullscreenFitMode,
  showFullscreenPageJumpInput,
  hideFullscreenPageJumpInput,
  commitFullscreenPageJump,
  applyLandscapeTransform,
  resetLandscapePan,
  initFullscreenNavigation,
  toggleCinemaPan,
  stopCinemaPan,
  checkSpreadCinemaStatus,
  isLandscapePanActive,
  beginLandscapePan,
  updateLandscapePan,
  endLandscapePan,
  getLandscapePanState,
  sanitizeComicTitleLocal,
  setupControlsAutohide,
  isCinemaPanningActive,
  maybeAutoPanCinema,
  startCinemaPan,
  clearLongPress,
  makeLongPressHandlers,
  handleHotspotDblClick,
  triggerZoomAtClient,
  handleFullscreenPointerUpForDblTap,
  syncZoomToggleButton,
  bindFullscreenZoomToggle,
  bindFullscreenLongPress,
  cancelPendingSideNav,
  animateFullscreenPan
};

export const ViewerFullscreen = {
  FULLSCREEN_CONTROLS_AUTOHIDE_DELAY,
  FULLSCREEN_MIN_ZOOM_SCALE,
  FULLSCREEN_MAX_ZOOM_SCALE,
  showFullscreenControls,
  hideFullscreenControls,
  syncFullscreenTitle,
  getCleanComicTitle,
  openFullscreen,
  closeFullscreen,
  handleFullscreenImageClick,
  clamp,
  ensureFullscreenZoomBaseSize,
  updateFullscreenScrollFromRatios,
  applyFullscreenZoom,
  beginFullscreenPan,
  updateFullscreenPanPosition,
  endFullscreenPan,
  getDistanceBetweenPoints,
  handleFullscreenPointerDown,
  handleFullscreenPointerMove,
  handleFullscreenPointerUp,
  onFullscreenReset,
  updateFullscreenPageStatus,
  updateFullscreenViewerCentering,
  applyFullscreenFitMode,
  showFullscreenPageJumpInput,
  hideFullscreenPageJumpInput,
  commitFullscreenPageJump,
  toggleCinemaPan,
  stopCinemaPan,
  checkSpreadCinemaStatus,
  applyLandscapeTransform,
  resetLandscapePan,
  initFullscreenNavigation
};

if (state) {
  state.ViewerFullscreen = ViewerFullscreen;
  Object.assign(state, ViewerFullscreen);
}

if (typeof window !== 'undefined') {
  window.ViewerFullscreen = ViewerFullscreen;
  Object.assign(window, ViewerFullscreen);
}

if (typeof canonicalGlobal !== 'undefined') {
  canonicalGlobal.ViewerFullscreen = ViewerFullscreen;
  Object.assign(canonicalGlobal, ViewerFullscreen);
}

initFullscreenNavigation();

export default ViewerFullscreen;
