import { state } from '../globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

  const FULLSCREEN_CONTROLS_AUTOHIDE_DELAY = 2000;
  const FULLSCREEN_MIN_ZOOM_SCALE = 1;
  const FULLSCREEN_MAX_ZOOM_SCALE = 4;
  const FS_DOUBLE_TAP_MS = 300;
  const FS_DOUBLE_TAP_TOLERANCE = 32;

  let fullscreenControlsTimeoutId = null;
  let pendingUIToggleTimer = null;
  let isFullscreenPanning = false;
  let fullscreenPanPointerId = null;
  let fullscreenPanStartX = 0;
  let fullscreenPanStartY = 0;
  let fullscreenPanScrollLeft = 0;
  let fullscreenPanScrollTop = 0;
  let fullscreenPanPointerType = '';
  let fullscreenPanCurrentX = 0;
  let fullscreenPanCurrentY = 0;
  let fullscreenPanRAF = null;
  const fullscreenTouchPointers = new Map();
  let fullscreenInitialPinchDistance = 0;
  let fullscreenInitialPinchScale = 1;
  let fullscreenPinchRatioX = 0.5;
  let fullscreenPinchRatioY = 0.5;

  // Pending pan: on mouse pointerdown over the zoomed image we DON'T capture
  // the pointer or call preventDefault — that would swallow the dblclick the
  // user is in the middle of. We arm a pending state and only promote to a
  // real pan once they actually move past a threshold.
  let pendingPanPointerId = null;
  let pendingPanType = '';
  let pendingPanStartX = 0;
  let pendingPanStartY = 0;
  const PAN_START_THRESHOLD = 5; // px

  let hasDragged = false;
  const PAN_DRAG_THRESHOLD = 5;
  let fsStartX = 0;
  let fsStartY = 0;

  // Landscape free-pan: in landscape mode the image is CSS-rotated 90deg, so
  // native scroll-pan can't move it (the layout box doesn't reflect the
  // rotation). We track our own translate offset and combine it with the
  // rotation in an inline transform.
  let landscapePanTx = 0;
  let landscapePanTy = 0;
  let isLandscapePanning = false;
  let landscapePanPointerId = null;
  let landscapePanStartX = 0;
  let landscapePanStartY = 0;
  let landscapePanStartTx = 0;
  let landscapePanStartTy = 0;

  function isLandscapePanActive() {
    if (!global.isLandscapeOrientation) return false;
    if (global.isFullImageMode) return false;
    const gv = global.GuidedView;
    if (gv && (gv.isActive?.() || gv.isBubbleActive?.() || gv.isWesternSpeechZoomActive?.() || gv.isMangaPanelZoomActive?.() || gv.isMangaSpeechZoomActive?.())) {
      return false;
    }
    return true;
  }

  function applyLandscapeTransform() {
    const image = global.fullscreenImage;
    if (!image) return;
    if (global.isLandscapeOrientation) {
      image.style.transform = `translate(${landscapePanTx}px, ${landscapePanTy}px) rotate(90deg)`;
      image.style.transformOrigin = 'center center';
    }
  }

  function resetLandscapePan() {
    landscapePanTx = 0;
    landscapePanTy = 0;
    const image = global.fullscreenImage;
    if (image) {
      image.style.transform = '';
      image.style.transformOrigin = '';
    }
  }

  function beginLandscapePan(pointerId, clientX, clientY) {
    isLandscapePanning = true;
    landscapePanPointerId = pointerId;
    landscapePanStartX = clientX;
    landscapePanStartY = clientY;
    landscapePanStartTx = landscapePanTx;
    landscapePanStartTy = landscapePanTy;
    const image = global.fullscreenImage;
    if (image) {
      image.style.cursor = 'grabbing';
      image.style.touchAction = 'none';
    }
  }

  function updateLandscapePan(clientX, clientY) {
    if (!isLandscapePanning) return;
    landscapePanTx = landscapePanStartTx + (clientX - landscapePanStartX);
    landscapePanTy = landscapePanStartTy + (clientY - landscapePanStartY);
    applyLandscapeTransform();
  }

  function endLandscapePan() {
    if (!isLandscapePanning) return;
    isLandscapePanning = false;
    landscapePanPointerId = null;
    const image = global.fullscreenImage;
    if (image) {
      image.style.cursor = global.isLandscapeOrientation ? 'grab' : '';
    }
  }

  global.applyLandscapeTransform = applyLandscapeTransform;
  global.resetLandscapePan = resetLandscapePan;

  function syncFullscreenTitle() {
    const title = global.fullscreenTitle;
    if (!title) return;
    const comic = global.currentComic;
    title.textContent = comic ? (comic.name || comic.series || 'Untitled') : '';
  }

  function showFullscreenControls(autoHide = false) {
    const isMangaPanelZoom = global.GuidedView?.getActiveModeName?.() === 'manga-panel-zoom';
    if (global.isFullImageMode || isMangaPanelZoom) autoHide = false;
    const controls = global.fullscreenControls;
    const closeBtn = global.fullscreenCloseBtn;
    const title = global.fullscreenTitle;
    if (!controls) return;

    controls.classList.remove('hidden');
    if (closeBtn) closeBtn.classList.remove('hidden');
    if (title) {
      syncFullscreenTitle();
      title.classList.remove('hidden');
    }

    if (autoHide) {
      clearTimeout(fullscreenControlsTimeoutId);
      fullscreenControlsTimeoutId = setTimeout(() => {
        if (global.fullscreenControls) {
          global.fullscreenControls.classList.add('hidden');
        }
        if (global.fullscreenCloseBtn) {
          global.fullscreenCloseBtn.classList.add('hidden');
        }
        if (global.fullscreenTitle) {
          global.fullscreenTitle.classList.add('hidden');
        }
        fullscreenControlsTimeoutId = null;
      }, FULLSCREEN_CONTROLS_AUTOHIDE_DELAY);
    }
  }

  function hideFullscreenControls() {
    const isMangaPanelZoom = global.GuidedView?.getActiveModeName?.() === 'manga-panel-zoom';
    if (global.isFullImageMode || isMangaPanelZoom) return;
    const controls = global.fullscreenControls;
    const closeBtn = global.fullscreenCloseBtn;
    const title = global.fullscreenTitle;
    if (!controls) return;

    controls.classList.add('hidden');
    if (closeBtn) closeBtn.classList.add('hidden');
    if (title) title.classList.add('hidden');
    clearTimeout(fullscreenControlsTimeoutId);
    fullscreenControlsTimeoutId = null;
  }

  function openFullscreen() {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

    const currentImage = document.querySelector('.viewer-image');
    if (currentImage && currentImage.src && currentImage.src !== '') {
      image.removeAttribute('crossorigin');
      image.src = currentImage.src;
    } else {
      // Image will be set by renderPage when it updates
    }

    viewer.classList.remove('hidden');
    const totalPages = typeof getPageCounterTotal === 'function' ? getPageCounterTotal() : 0;
    updateFullscreenPageStatus(global.currentPageIndex + 1, totalPages);

    // Check if continuous mode should be enabled
    if (global.currentComic?.continuousMode && typeof global.enableContinuousMode === 'function') {
      // Enable continuous mode after a short delay to ensure fullscreen is ready
      setTimeout(async () => {
        await global.enableContinuousMode();
      }, 100);
    }

    hideFullscreenControls();
    if (typeof global.resetFullscreenZoom === 'function') {
      global.resetFullscreenZoom();
    }
    applyFullscreenFitMode();

    if (viewer.requestFullscreen) {
      viewer.requestFullscreen().catch((error) => {
        
      });
    }

    const closeBtn = global.fullscreenCloseBtn;
    if (closeBtn) {
      closeBtn.focus();
    }

    // If no image src was copied, trigger renderPage to load it
    if (!image.src || image.src === '') {
      if (typeof global.renderPage === 'function') {
        global.renderPage().catch((err) => {
          console.error('[openFullscreen] Error calling renderPage:', err);
        });
      }
    }
  }

  async function closeFullscreen() {
    // 1. HIDE IMMEDIATELY - Don't wait for anything
    const viewer = global.fullscreenViewer;
    if (viewer) {
      viewer.classList.add('hidden');
      viewer.style.display = 'none'; // Force hide even if CSS is fighting
    }
    
    hideFullscreenControls();

    // 2. CLEANUP IN BACKGROUND
    try {
      if (global.GuidedView && typeof global.GuidedView.disableAll === 'function') {
        global.GuidedView.disableAll();
      }
    } catch (e) {
      console.error('[closeFullscreen] GuidedView cleanup failed:', e);
    }

    try {
      if (global.isContinuousMode && typeof global.disableContinuousMode === 'function') {
        // Don't await, let it finish in background
        global.disableContinuousMode().catch(() => {});
      }
    } catch (e) {}

    const image = global.fullscreenImage;
    
    // Cancel RAF before releasing pointer capture
    if (fullscreenPanRAF) {
      cancelAnimationFrame(fullscreenPanRAF);
      fullscreenPanRAF = null;
    }

    if (fullscreenPanPointerId !== null && image && typeof image.releasePointerCapture === 'function') {
      try {
        image.releasePointerCapture(fullscreenPanPointerId);
      } catch (error) {}
    }

    isFullscreenPanning = false;
    fullscreenPanPointerId = null;
    
    try {
      if (typeof global.resetFullscreenZoom === 'function') {
        global.resetFullscreenZoom();
      }
    } catch (e) {}

    if (document.fullscreenElement === viewer && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    // 3. FINAL UI SYNC
    if (typeof global.renderPage === 'function') {
      // Don't await, just trigger
      global.renderPage().catch(() => {});
    }
  }

  // Pending side-nav state. Desktop single-click on a hotspot is deferred
  // briefly so a dblclick that includes the hotspot can cancel the nav and
  // run the dblclick-zoom path instead.
  let pendingSideNavTimer = null;
  function cancelPendingSideNav() {
    if (pendingSideNavTimer) {
      clearTimeout(pendingSideNavTimer);
      pendingSideNavTimer = null;
    }
  }
  global.cancelPendingSideNav = cancelPendingSideNav;

  function handleFullscreenImageClick(event) {
    if (hasDragged) return;
    if (global.isFullImageMode) {
      global.showFullscreenControls?.(false);
      return;
    }

    // Suppress the synthetic click that follows a long-press nav.
    if (longPressJustFired) {
      longPressJustFired = false;
      return;
    }

    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastDoubleTapAt < 500) return;

    // Only the centre of the page surfaces controls — taps elsewhere on the
    // image do nothing (side-nav hotspots own the left/right thirds, and
    // the user wants top/bottom of the page silent too).
    const image = event.currentTarget || global.fullscreenImage;
    if (image && typeof image.getBoundingClientRect === 'function') {
      const rect = image.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const halfW = rect.width / 6;  // central 1/3 horizontally
      const halfH = rect.height / 6; // central 1/3 vertically
      if (Math.abs(event.clientX - cx) > halfW) return;
      if (Math.abs(event.clientY - cy) > halfH) return;
    }

    clearTimeout(pendingUIToggleTimer);
    pendingUIToggleTimer = setTimeout(() => {
      pendingUIToggleTimer = null;
      global.showFullscreenControls?.(true);
    }, FS_DOUBLE_TAP_MS);
  }

  // ─── Long-press to navigate ────────────────────────────────────────────────
  // Press and hold near the left or right edge for ~450 ms to flip pages. Works
  // in every mode (normal, HotZoom, Bubble, MangaSpeechZoom, etc.) and removes
  // the dblclick-vs-side-tap conflict entirely.
  const LONG_PRESS_MS = 250;
  const LONG_PRESS_MOVE_TOLERANCE = 12; // pixels before we treat it as a drag
  let longPressTimer = null;
  let longPressPointerId = null;
  let longPressStartX = 0;
  let longPressStartY = 0;
  let longPressJustFired = false;

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressPointerId = null;
  }

  // Long-press handlers are attached directly to the side hotspots
  // (#fullscreen-nav-left / -right). Each hotspot owns its direction so we
  // don't need viewport-relative zone math.
  function makeLongPressHandlers(dir) {
    function down(event) {
      if (event.pointerType === 'touch' && fullscreenTouchPointers.size > 1) {
        clearLongPress();
        return;
      }
      if (global.isFullscreenZoomed) return;
      if (global.isFullImageMode) return;
      if (global.GuidedView?.isPanning) return;
      longPressPointerId = event.pointerId;
      longPressStartX = event.clientX;
      longPressStartY = event.clientY;
      clearLongPress();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (global.GuidedView?.isPanning) return;
        longPressJustFired = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(15); } catch (_) {}
        }
        global.hideFullscreenControls?.();
        if (global.isContinuousMode) {
          if (dir === -1 && typeof global.scrollToPreviousPage === 'function') {
            global.scrollToPreviousPage();
          } else if (dir === 1 && typeof global.scrollToNextPage === 'function') {
            global.scrollToNextPage();
          }
        } else {
          // Hotspots are physical (left/right). Get the logical direction.
          const logicalDir = global.getNavigationDirection ? global.getNavigationDirection(dir) : dir;
          global.navigatePage?.(logicalDir);
        }
      }, LONG_PRESS_MS);
    }
    function move(event) {
      if (longPressPointerId == null || event.pointerId !== longPressPointerId) return;
      const dx = event.clientX - longPressStartX;
      const dy = event.clientY - longPressStartY;
      if ((dx * dx + dy * dy) > (LONG_PRESS_MOVE_TOLERANCE * LONG_PRESS_MOVE_TOLERANCE)) {
        clearLongPress();
      }
    }
    function end(event) {
      if (longPressPointerId != null && event.pointerId !== longPressPointerId) return;
      clearLongPress();
    }
    // Click semantics: on desktop, a plain click navigates immediately (long-
    // press is reserved for touch). On touch we suppress the synthetic click
    // that follows a long-press so we never double-fire nav.
    function click(event) {
      if (longPressJustFired) {
        longPressJustFired = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const isDesktop = typeof global.isDesktopDevice === 'function'
        ? global.isDesktopDevice()
        : !((typeof global.matchMedia === 'function') && global.matchMedia('(pointer: coarse)').matches);
      // Removed: if (!isDesktop) return;
      if (global.isFullscreenZoomed) return;
      if (global.isFullImageMode) return;
      if (global.GuidedView?.isPanning) return;
      // Defer the navigation so a dblclick that lands (partly) on the hotspot
      // can cancel it via cancelPendingSideNav() and run the zoom path. The
      // delay is chosen to comfortably exceed a typical dblclick interval
      // without feeling sluggish on a single click.
      cancelPendingSideNav();
      pendingSideNavTimer = setTimeout(() => {
        pendingSideNavTimer = null;
        if (global.isFullscreenZoomed) return;
        if (global.isFullImageMode) return;
        if (global.isContinuousMode) {
          if (dir === -1 && typeof global.scrollToPreviousPage === 'function') {
            global.scrollToPreviousPage();
          } else if (dir === 1 && typeof global.scrollToNextPage === 'function') {
            global.scrollToNextPage();
          }
        } else {
          // Hotspots are physical (left/right). Get the logical direction.
          const logicalDir = global.getNavigationDirection ? global.getNavigationDirection(dir) : dir;
          global.navigatePage?.(logicalDir);
        }
      }, 280);
    }
    return { down, move, end, click };
  }

  // dblclick on a hotspot should zoom (centered on the click point), not
  // navigate. Cancels any deferred single-click nav from the click(s) that
  // led to this dblclick and runs the same zoom path as the image dblclick.
  function handleHotspotDblClick(event) {
    cancelPendingSideNav();
    triggerZoomAtClient(event.clientX, event.clientY);
  }

  // Shared zoom-toggle path used by native dblclick (image + hotspots) and the
  // manual touch double-tap detector below.
  function triggerZoomAtClient(clientX, clientY) {
    if (global.isFullImageMode) return;
    // Don't fight any active guided/bubble/hot-zoom mode — those own their own
    // zoom presentation. Their own pointerup-based dbltap detector handles it.
    if (global.GuidedView?.isAnyActive?.()) return;
    const image = global.fullscreenImage;
    if (!image) return;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratioX = clamp(rect.width ? (clientX - rect.left) / rect.width : 0.5, 0, 1);
    const ratioY = clamp(rect.height ? (clientY - rect.top) / rect.height : 0.5, 0, 1);
    if (typeof global.hideFullscreenControls === 'function') {
      global.hideFullscreenControls();
    }
    if (!global.isFullscreenZoomed) {
      global.applyFullscreenZoom?.(2, ratioX, ratioY);
    } else {
      global.endFullscreenPan?.();
      global.resetFullscreenZoom?.();
    }
  }

  // Manual double-tap detection for touch. The browser's native dblclick is
  // unreliable on touch devices (esp. after long-press wins or when synthetic
  // clicks are suppressed). This pointerup-based detector fires the same zoom
  // path regardless of pointer type, so taps work everywhere.
  let fsLastTapAt = 0;
  let fsLastTapX = 0;
  let fsLastTapY = 0;
  let fsLastTapTarget = null;
  let lastDoubleTapAt = 0;
  function handleFullscreenPointerUpForDblTap(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Skip if a guided mode owns the gesture — guided.js has its own detector.
    const gv = global.GuidedView;
    if (gv && (gv.isActive?.() || gv.isBubbleActive?.() || gv.isWesternSpeechZoomActive?.() || gv.isMangaPanelZoomActive?.() || gv.isMangaSpeechZoomActive?.())) {
      fsLastTapAt = 0;
      return;
    }
    // Skip taps on UI controls and the close button.
    if (event.target && typeof event.target.closest === 'function'
        && event.target.closest('button, input, a, select, #fullscreen-controls')) {
      fsLastTapAt = 0;
      return;
    }
    // Only count taps inside the fullscreen viewer.
    const viewer = global.fullscreenViewer;
    if (!viewer || viewer.classList.contains('hidden')) {
      fsLastTapAt = 0;
      return;
    }
    if (event.target && typeof event.target.closest === 'function' && !viewer.contains(event.target)) {
      fsLastTapAt = 0;
      return;
    }
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dx = event.clientX - fsLastTapX;
    const dy = event.clientY - fsLastTapY;
    const within = (now - fsLastTapAt) <= FS_DOUBLE_TAP_MS &&
                   (dx * dx + dy * dy) <= (FS_DOUBLE_TAP_TOLERANCE * FS_DOUBLE_TAP_TOLERANCE);
    if (within) {
      fsLastTapAt = 0;
      lastDoubleTapAt = now;
      clearTimeout(pendingUIToggleTimer);
      pendingUIToggleTimer = null;
      if (typeof global.hideFullscreenControls === 'function') {
        global.hideFullscreenControls();
      }
      cancelPendingSideNav();
      triggerZoomAtClient(event.clientX, event.clientY);
      return;
    }
    fsLastTapAt = now;
    fsLastTapX = event.clientX;
    fsLastTapY = event.clientY;
    fsLastTapTarget = event.target;
  }
  document.addEventListener('pointerup', handleFullscreenPointerUpForDblTap, { capture: true });

  // Desktop-only zoom toggle. Replaces the gesture conflict between dblclick
  // (which guided modes own) and the regular fullscreen zoom: clicking this
  // button toggles `applyFullscreenZoom(2) <-> resetFullscreenZoom`. Hidden on
  // touch devices via CSS @media (hover: none).
  function syncZoomToggleButton() {
    const btn = document.getElementById('fullscreen-zoom-toggle-btn');
    if (!btn) return;
    const on = !!global.isFullscreenZoomed;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  global.syncZoomToggleButton = syncZoomToggleButton;

  global.bindFullscreenZoomToggle = function () {
    const btn = document.getElementById('fullscreen-zoom-toggle-btn');
    if (!btn || btn._zoomBound) return;
    btn._zoomBound = true;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      // Don't fight guided/full-image modes — they own the image.
      if (global.isFullImageMode) return;
      const gv = global.GuidedView;
      if (gv && (gv.isActive?.() || gv.isBubbleActive?.() || gv.isWesternSpeechZoomActive?.() || gv.isMangaPanelZoomActive?.() || gv.isMangaSpeechZoomActive?.())) {
        return;
      }
      if (global.isFullscreenZoomed) {
        global.endFullscreenPan?.();
        global.resetFullscreenZoom?.();
      } else {
        global.applyFullscreenZoom?.(2, 0.5, 0.5);
      }
      syncZoomToggleButton();
    });
  };

  global.bindFullscreenLongPress = function () {
    const left = global.fullscreenNavLeft;
    const right = global.fullscreenNavRight;
    if (left && !left._longPressBound) {
      left._longPressBound = true;
      const h = makeLongPressHandlers(-1);
      left.addEventListener('pointerdown', h.down);
      left.addEventListener('pointermove', h.move);
      left.addEventListener('pointerup', h.end);
      left.addEventListener('pointercancel', h.end);
      left.addEventListener('pointerleave', h.end);
      left.addEventListener('click', h.click);
      left.addEventListener('dblclick', handleHotspotDblClick);
      left.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    if (right && !right._longPressBound) {
      right._longPressBound = true;
      const h = makeLongPressHandlers(1);
      right.addEventListener('pointerdown', h.down);
      right.addEventListener('pointermove', h.move);
      right.addEventListener('pointerup', h.end);
      right.addEventListener('pointercancel', h.end);
      right.addEventListener('pointerleave', h.end);
      right.addEventListener('click', h.click);
      right.addEventListener('dblclick', handleHotspotDblClick);
      right.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function ensureFullscreenZoomBaseSize() {
    const image = global.fullscreenImage;
    if (!image || global.fullscreenZoomBaseWidth || global.fullscreenZoomBaseHeight) {
      return;
    }

    const rect = image.getBoundingClientRect();
    global.fullscreenZoomBaseWidth = rect.width || image.naturalWidth || 0;
    global.fullscreenZoomBaseHeight = rect.height || image.naturalHeight || 0;
  }

  function updateFullscreenScrollFromRatios(ratioX, ratioY) {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

    const rect = image.getBoundingClientRect();
    const scrollWidth = Math.max(rect.width - viewer.clientWidth, 0);
    const scrollHeight = Math.max(rect.height - viewer.clientHeight, 0);

    viewer.scrollLeft = scrollWidth * ratioX;
    viewer.scrollTop = scrollHeight * ratioY;
  }

  function applyFullscreenZoom(scale, ratioX = 0.5, ratioY = 0.5) {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;
    if (global.isFullImageMode) return;

    // Disable native zoom/pan whenever any guided mode is active. Each mode
    // owns its own zoom presentation and stacking native zoom on top breaks
    // the overlay/transform math.
    const gv = global.GuidedView;
    if (gv && (gv.isActive?.() || gv.isBubbleActive?.() || gv.isWesternSpeechZoomActive?.() || gv.isMangaPanelZoomActive?.() || gv.isMangaSpeechZoomActive?.())) {
      return;
    }

    ensureFullscreenZoomBaseSize();

    const clampedScale = clamp(scale, FULLSCREEN_MIN_ZOOM_SCALE, FULLSCREEN_MAX_ZOOM_SCALE);
    if (clampedScale <= FULLSCREEN_MIN_ZOOM_SCALE) {
      if (!viewer.classList.contains('fullscreen-fit-mode')) {
        viewer.classList.add('fullscreen-fit-mode');
      }
      viewer.style.touchAction = 'manipulation';
      image.style.transform = '';
      image.style.transformOrigin = '';
      image.style.cursor = 'default';
      image.style.touchAction = 'manipulation';
      global.isFullscreenZoomed = false;
      global.fullscreenZoomScale = FULLSCREEN_MIN_ZOOM_SCALE;
      if (global.isLandscapeOrientation) {
        applyLandscapeTransform();
        image.style.cursor = 'grab';
        image.style.touchAction = 'none';
      }
      updateFullscreenViewerCentering();
      return;
    }

    viewer.classList.remove('fullscreen-fit-mode');

    global.isFullscreenZoomed = true;
    global.fullscreenZoomScale = clampedScale;

    const baseWidth = global.fullscreenZoomBaseWidth || image.naturalWidth || image.clientWidth || 0;
    const baseHeight = global.fullscreenZoomBaseHeight || image.naturalHeight || image.clientHeight || 0;

    image.style.width = `${baseWidth * clampedScale}px`;
    image.style.height = `${baseHeight * clampedScale}px`;
    image.style.maxWidth = 'none';
    image.style.maxHeight = 'none';
    image.style.cursor = 'grab';
    image.style.touchAction = 'none';
    image.style.margin = '0 auto';
    if (global.isLandscapeOrientation) {
      applyLandscapeTransform();
    }

    updateFullscreenScrollFromRatios(ratioX, ratioY);
    updateFullscreenViewerCentering();
    syncZoomToggleButton();
  }

  function animateFullscreenPan() {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image || !isFullscreenPanning) {
      fullscreenPanRAF = null;
      return;
    }

    const deltaX = fullscreenPanCurrentX - fullscreenPanStartX;
    const deltaY = fullscreenPanCurrentY - fullscreenPanStartY;

    const proposedScrollLeft = fullscreenPanScrollLeft - deltaX;
    const proposedScrollTop = fullscreenPanScrollTop - deltaY;

    // Use the viewer's actual scroll geometry so any padding (e.g. bottom
    // headroom when zoomed) is included in the scrollable range.
    const maxScrollLeft = viewer.scrollWidth - viewer.clientWidth;
    const maxScrollTop = viewer.scrollHeight - viewer.clientHeight;

    viewer.scrollLeft = clamp(proposedScrollLeft, 0, Math.max(maxScrollLeft, 0));
    viewer.scrollTop = clamp(proposedScrollTop, 0, Math.max(maxScrollTop, 0));

    // Continue the animation loop
    fullscreenPanRAF = requestAnimationFrame(animateFullscreenPan);
  }

  function beginFullscreenPan(pointerId, pointerType, clientX, clientY) {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer) return;

    isFullscreenPanning = true;
    fullscreenPanPointerId = pointerId;
    fullscreenPanPointerType = pointerType;
    fullscreenPanStartX = clientX;
    fullscreenPanStartY = clientY;
    fullscreenPanCurrentX = clientX;
    fullscreenPanCurrentY = clientY;
    fullscreenPanScrollLeft = viewer.scrollLeft;
    fullscreenPanScrollTop = viewer.scrollTop;

    if (viewer && typeof viewer.setPointerCapture === 'function') {
      try {
        viewer.setPointerCapture(pointerId);
      } catch (error) {

      }
    }

    if (image && (pointerType === 'mouse' || pointerType === 'pen')) {
      image.style.cursor = 'grabbing';
    }

    // Start the animation loop for smooth panning
    if (!fullscreenPanRAF) {
      fullscreenPanRAF = requestAnimationFrame(animateFullscreenPan);
    }
  }

  function updateFullscreenPanPosition(clientX, clientY) {
    if (!isFullscreenPanning) return;

    // Just update the current position, the RAF loop will handle the actual scrolling
    fullscreenPanCurrentX = clientX;
    fullscreenPanCurrentY = clientY;
  }

  function endFullscreenPan(pointerId) {
    const image = global.fullscreenImage;
    const viewer = global.fullscreenViewer;
    if (!isFullscreenPanning) return;

    // Use the provided pointerId or fallback to the stored one
    const pointerIdToRelease = typeof pointerId === 'number' ? pointerId : fullscreenPanPointerId;

    if (viewer && typeof pointerIdToRelease === 'number' && typeof viewer.releasePointerCapture === 'function') {
      try {
        viewer.releasePointerCapture(pointerIdToRelease);
      } catch (error) {

      }
    }

    isFullscreenPanning = false;
    fullscreenPanPointerId = null;
    fullscreenPanPointerType = '';

    // Cancel the animation loop
    if (fullscreenPanRAF) {
      cancelAnimationFrame(fullscreenPanRAF);
      fullscreenPanRAF = null;
    }

    if (image && (image.style.cursor === 'grabbing' || image.style.cursor === 'grab')) {
      image.style.cursor = global.isFullscreenZoomed ? 'grab' : 'default';
    }
  }

  function getDistanceBetweenPoints(pointA, pointB) {
    if (!pointA || !pointB) return 0;
    const dx = pointA.x - pointB.x;
    const dy = pointA.y - pointB.y;
    return Math.sqrt((dx * dx) + (dy * dy));
  }

  function handleFullscreenPointerDown(event) {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

    fsStartX = event.clientX;
    fsStartY = event.clientY;
    hasDragged = false;

    if (!event.target.closest('button, input, a, select')) {
      hideFullscreenControls();
    }

    if (event.pointerType === 'touch') {
      fullscreenTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (fullscreenTouchPointers.size === 2) {
        const touchPoints = Array.from(fullscreenTouchPointers.values());
        fullscreenInitialPinchDistance = getDistanceBetweenPoints(touchPoints[0], touchPoints[1]);
        fullscreenInitialPinchScale = global.fullscreenZoomScale || FULLSCREEN_MIN_ZOOM_SCALE;
        const rect = image.getBoundingClientRect();
        const centerX = (touchPoints[0].x + touchPoints[1].x) / 2;
        const centerY = (touchPoints[0].y + touchPoints[1].y) / 2;
        fullscreenPinchRatioX = rect.width ? (centerX - rect.left) / rect.width : 0.5;
        fullscreenPinchRatioY = rect.height ? (centerY - rect.top) / rect.height : 0.5;
        image.style.touchAction = 'none';
        endFullscreenPan();
        return;
      }

      if (fullscreenTouchPointers.size === 1 && isLandscapePanActive()
          && !event.target.closest('#fullscreen-nav-left, #fullscreen-nav-right, button, input, a, select')) {
        beginLandscapePan(event.pointerId, event.clientX, event.clientY);
      } else if (fullscreenTouchPointers.size === 1 && global.isFullscreenZoomed
          && !event.target.closest('button, input, a, select')) {
        beginFullscreenPan(event.pointerId, 'touch', event.clientX, event.clientY);
      }

      return;
    }

    if (isLandscapePanActive() && (event.pointerType === 'mouse' || event.pointerType === 'pen')
        && !event.target.closest('#fullscreen-nav-left, #fullscreen-nav-right, button, input, a, select')) {
      event.preventDefault();
      beginLandscapePan(event.pointerId, event.clientX, event.clientY);
      return;
    }

    if (!global.isFullscreenZoomed) {
      return;
    }

    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
      return;
    }

    if (event.target.closest('button, input, a, select')) {
      return;
    }

    // Arm a pending pan — defer the actual capture/preventDefault until the
    // user moves past PAN_START_THRESHOLD. Otherwise dblclick to zoom out
    // would never fire because the second mousedown captures the pointer.
    pendingPanPointerId = event.pointerId;
    pendingPanType = event.pointerType;
    pendingPanStartX = event.clientX;
    pendingPanStartY = event.clientY;
  }

  function handleFullscreenPointerMove(event) {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

    if (!hasDragged) {
      const dx = event.clientX - fsStartX;
      const dy = event.clientY - fsStartY;
      if (dx * dx + dy * dy > PAN_DRAG_THRESHOLD * PAN_DRAG_THRESHOLD) {
        hasDragged = true;
      }
    }

    if (event.pointerType === 'touch') {
      let touchPoint = fullscreenTouchPointers.get(event.pointerId);
      if (!touchPoint) {
        touchPoint = { x: event.clientX, y: event.clientY };
        fullscreenTouchPointers.set(event.pointerId, touchPoint);
      } else {
        touchPoint.x = event.clientX;
        touchPoint.y = event.clientY;
      }

      if (fullscreenTouchPointers.size === 2) {
        const touchPoints = Array.from(fullscreenTouchPointers.values());
        const currentDistance = getDistanceBetweenPoints(touchPoints[0], touchPoints[1]);
        if (!fullscreenInitialPinchDistance) {
          fullscreenInitialPinchDistance = currentDistance;
        }
        if (currentDistance > 0 && fullscreenInitialPinchDistance > 0) {
          const scaleRatio = currentDistance / fullscreenInitialPinchDistance;
          const targetScale = (fullscreenInitialPinchScale || FULLSCREEN_MIN_ZOOM_SCALE) * scaleRatio;
          applyFullscreenZoom(targetScale, fullscreenPinchRatioX, fullscreenPinchRatioY);
          event.preventDefault();
        }
        return;
      }

      if (isFullscreenPanning && event.pointerId === fullscreenPanPointerId) {
        updateFullscreenPanPosition(event.clientX, event.clientY);
        event.preventDefault();
      } else if (isLandscapePanning && event.pointerId === landscapePanPointerId) {
        updateLandscapePan(event.clientX, event.clientY);
        event.preventDefault();
      }

      return;
    }

    if (isLandscapePanning && event.pointerId === landscapePanPointerId) {
      updateLandscapePan(event.clientX, event.clientY);
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
        event.preventDefault();
      }
      return;
    }

    // Promote a pending pan to a real one once the mouse has moved enough.
    if (pendingPanPointerId !== null && event.pointerId === pendingPanPointerId) {
      const dx = event.clientX - pendingPanStartX;
      const dy = event.clientY - pendingPanStartY;
      if ((dx * dx + dy * dy) >= (PAN_START_THRESHOLD * PAN_START_THRESHOLD)) {
        const pid = pendingPanPointerId;
        const ptype = pendingPanType;
        pendingPanPointerId = null;
        pendingPanType = '';
        beginFullscreenPan(pid, ptype, pendingPanStartX, pendingPanStartY);
        updateFullscreenPanPosition(event.clientX, event.clientY);
        event.preventDefault();
      }
      return;
    }

    if (!isFullscreenPanning || event.pointerId !== fullscreenPanPointerId) return;

    updateFullscreenPanPosition(event.clientX, event.clientY);

    if (fullscreenPanPointerType === 'mouse' || fullscreenPanPointerType === 'pen') {
      event.preventDefault();
    }
  }

  function handleFullscreenPointerUp(event) {
    const image = global.fullscreenImage;

    if (event.pointerType === 'touch') {
      fullscreenTouchPointers.delete(event.pointerId);

      if (event.pointerId === fullscreenPanPointerId) {
        endFullscreenPan(event.pointerId);
      }

      if (event.pointerId === landscapePanPointerId) {
        endLandscapePan();
      }

      if (fullscreenTouchPointers.size < 2) {
        fullscreenInitialPinchDistance = 0;
        fullscreenInitialPinchScale = global.fullscreenZoomScale || FULLSCREEN_MIN_ZOOM_SCALE;
        if (!global.isFullscreenZoomed && image) {
          image.style.touchAction = 'manipulation';
        }
      }

      if (fullscreenTouchPointers.size === 1 && global.isFullscreenZoomed) {
        const [remainingId, remainingPoint] = fullscreenTouchPointers.entries().next().value || [];
        if (remainingPoint) {
          beginFullscreenPan(remainingId, 'touch', remainingPoint.x, remainingPoint.y);
        }
      }

      return;
    }

    if (isLandscapePanning && event.pointerId === landscapePanPointerId) {
      endLandscapePan();
      return;
    }

    // No-move release of a pending pan — leave click/dblclick to fire normally.
    if (pendingPanPointerId !== null && event.pointerId === pendingPanPointerId) {
      pendingPanPointerId = null;
      pendingPanType = '';
    }

    if (!isFullscreenPanning || event.pointerId !== fullscreenPanPointerId) return;

    endFullscreenPan(event.pointerId);
  }

  function onFullscreenReset() {
    const image = global.fullscreenImage;
    endFullscreenPan();
    endLandscapePan();
    fullscreenTouchPointers.clear();
    fullscreenInitialPinchDistance = 0;
    fullscreenInitialPinchScale = FULLSCREEN_MIN_ZOOM_SCALE;
    fullscreenPinchRatioX = 0.5;
    fullscreenPinchRatioY = 0.5;
    if (image) {
      image.style.cursor = 'default';
      image.style.touchAction = 'manipulation';
    }
  }

  function updateFullscreenPageStatus(currentPage, totalPages) {
    const progressIndicator = global.fullscreenProgressIndicator;
    const pageCounter = global.fullscreenPageCounter;

    if (!progressIndicator || !pageCounter) {
      return;
    }

    if (!totalPages || totalPages <= 0) {
      progressIndicator.textContent = '0% read';
      pageCounter.textContent = '-- / --';
      return;
    }

    const pageText = `${currentPage} / ${totalPages}`;
    const progressPercent = Math.round((currentPage / totalPages) * 100);
    progressIndicator.textContent = `${progressPercent}% read`;
    pageCounter.textContent = pageText;
  }

  function showFullscreenPageJumpInput() {
    const counter = global.fullscreenPageCounter;
    const input = global.fullscreenPageJumpInput;
    if (!counter || !input) return;

    counter.classList.add('hidden');
    input.classList.remove('hidden');
    input.value = '';

    // Focus with a slight delay to ensure it's visible
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }

  function hideFullscreenPageJumpInput() {
    const counter = global.fullscreenPageCounter;
    const input = global.fullscreenPageJumpInput;
    if (!counter || !input) return;

    input.classList.add('hidden');
    counter.classList.remove('hidden');
  }

  function commitFullscreenPageJump() {
    const input = global.fullscreenPageJumpInput;
    if (!input) return;

    const pages = global.getViewerPages?.() || [];
    const totalPages = pages.length;

    const targetPage = parseInt(input.value, 10);
    if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) {
      hideFullscreenPageJumpInput();
      return;
    }

    const targetIndex = targetPage - 1;
    global.currentPageIndex = targetIndex;
    hideFullscreenPageJumpInput();

    // Check if in continuous mode
    if (global.isContinuousMode) {
      // Scroll to the page in continuous view
      const continuousContainer = document.getElementById('fullscreen-pages-continuous');
      if (continuousContainer) {
        const targetContainer = continuousContainer.querySelector(
          `.page-container[data-index="${targetIndex}"]`
        );
        if (targetContainer) {
          targetContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    } else {
      // Single page mode - render the page
      if (typeof global.renderPage === 'function') {
        global.renderPage();
      }
    }
  }

  function updateFullscreenViewerCentering() {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

    const imageRect = image.getBoundingClientRect();
    const viewerRect = viewer.getBoundingClientRect();

    const needsHorizontalCentering = imageRect.width <= viewerRect.width;
    const needsVerticalCentering = imageRect.height <= viewerRect.height;

    // When image fits in viewport, use flexbox centering
    if (needsHorizontalCentering && needsVerticalCentering) {
      viewer.style.display = 'flex';
      viewer.style.alignItems = 'center';
      viewer.style.justifyContent = 'center';
      image.style.margin = 'auto';
    } else {
      // When image is larger than viewport (zoomed), allow scrolling
      viewer.style.display = 'block';
      viewer.style.alignItems = '';
      viewer.style.justifyContent = '';
      image.style.marginLeft = needsHorizontalCentering ? 'auto' : '0';
      image.style.marginRight = needsHorizontalCentering ? 'auto' : '0';
      image.style.marginTop = needsVerticalCentering ? 'auto' : '0';
      image.style.marginBottom = needsVerticalCentering ? 'auto' : '0';
    }
  }

  function applyFullscreenFitMode() {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

    if (global.isFullImageMode && typeof global.applyFullImageLayout === 'function') {
      global.applyFullImageLayout();
      return;
    }

    if (global.isFullscreenZoomed) {
      updateFullscreenViewerCentering();
      return;
    }

    viewer.classList.add('fullscreen-fit-mode');

    if (global.isFitToHeight) {
      image.style.width = 'auto';
      image.style.height = '100vh';
      image.style.maxWidth = '100%';
      image.style.maxHeight = '100vh';
    } else {
      image.style.width = '100%';
      image.style.height = 'auto';
      image.style.maxWidth = '100%';
      image.style.maxHeight = '100%';
    }
    image.style.cursor = 'default';
    image.style.touchAction = 'manipulation';
    if (global.isLandscapeOrientation) {
      applyLandscapeTransform();
      image.style.cursor = 'grab';
      image.style.touchAction = 'none';
    }
    updateFullscreenViewerCentering();
  }

  const ViewerFullscreen = {
    FULLSCREEN_CONTROLS_AUTOHIDE_DELAY,
    FULLSCREEN_MIN_ZOOM_SCALE,
    FULLSCREEN_MAX_ZOOM_SCALE,
    showFullscreenControls,
    hideFullscreenControls,
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
  };

  global.ViewerFullscreen = ViewerFullscreen;
  Object.assign(global, ViewerFullscreen);

  // Initialize event listeners for fullscreen navigation
  function initFullscreenNavigation() {
    // Prev/Next page buttons
    if (global.fullscreenPrevPageBtn && !global.fullscreenPrevPageBtn._navListener) {
      global.fullscreenPrevPageBtn._navListener = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof global.navigatePage === 'function') {
          const dir = global.getNavigationDirection ? global.getNavigationDirection(-1) : -1;
          global.navigatePage(dir);
        }
      };
      global.fullscreenPrevPageBtn.addEventListener('click', global.fullscreenPrevPageBtn._navListener);
    }

    if (global.fullscreenNextPageBtn && !global.fullscreenNextPageBtn._navListener) {
      global.fullscreenNextPageBtn._navListener = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof global.navigatePage === 'function') {
          const dir = global.getNavigationDirection ? global.getNavigationDirection(1) : 1;
          global.navigatePage(dir);
        }
      };
      global.fullscreenNextPageBtn.addEventListener('click', global.fullscreenNextPageBtn._navListener);
    }

    // Page counter click to show jump input
    if (global.fullscreenPageCounter && !global.fullscreenPageCounter._jumpListener) {
      global.fullscreenPageCounter._jumpListener = (event) => {
        event.preventDefault();
        event.stopPropagation();
        showFullscreenPageJumpInput();
      };
      global.fullscreenPageCounter.addEventListener('click', global.fullscreenPageCounter._jumpListener);
    }

    // Page jump input handlers
    if (global.fullscreenPageJumpInput && !global.fullscreenPageJumpInput._submitListener) {
      global.fullscreenPageJumpInput._submitListener = (event) => {
        if (event.type === 'keydown' && event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        commitFullscreenPageJump();
      };
      global.fullscreenPageJumpInput.addEventListener('keydown', global.fullscreenPageJumpInput._submitListener);
      global.fullscreenPageJumpInput.addEventListener('blur', () => {
        hideFullscreenPageJumpInput();
      });
    }
  }

  // Initialize on load
  initFullscreenNavigation();

export {
  FULLSCREEN_CONTROLS_AUTOHIDE_DELAY,
  FULLSCREEN_MIN_ZOOM_SCALE,
  FULLSCREEN_MAX_ZOOM_SCALE,
  showFullscreenControls,
  hideFullscreenControls,
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
  ViewerFullscreen,
  applyLandscapeTransform,
  resetLandscapePan,
  initFullscreenNavigation
};

state.FULLSCREEN_CONTROLS_AUTOHIDE_DELAY = FULLSCREEN_CONTROLS_AUTOHIDE_DELAY;
state.FULLSCREEN_MIN_ZOOM_SCALE = FULLSCREEN_MIN_ZOOM_SCALE;
state.FULLSCREEN_MAX_ZOOM_SCALE = FULLSCREEN_MAX_ZOOM_SCALE;
state.showFullscreenControls = showFullscreenControls;
state.hideFullscreenControls = hideFullscreenControls;
state.openFullscreen = openFullscreen;
state.closeFullscreen = closeFullscreen;
state.handleFullscreenImageClick = handleFullscreenImageClick;
state.clamp = clamp;
state.ensureFullscreenZoomBaseSize = ensureFullscreenZoomBaseSize;
state.updateFullscreenScrollFromRatios = updateFullscreenScrollFromRatios;
state.applyFullscreenZoom = applyFullscreenZoom;
state.beginFullscreenPan = beginFullscreenPan;
state.updateFullscreenPanPosition = updateFullscreenPanPosition;
state.endFullscreenPan = endFullscreenPan;
state.getDistanceBetweenPoints = getDistanceBetweenPoints;
state.handleFullscreenPointerDown = handleFullscreenPointerDown;
state.handleFullscreenPointerMove = handleFullscreenPointerMove;
state.handleFullscreenPointerUp = handleFullscreenPointerUp;
state.onFullscreenReset = onFullscreenReset;
state.updateFullscreenPageStatus = updateFullscreenPageStatus;
state.updateFullscreenViewerCentering = updateFullscreenViewerCentering;
state.applyFullscreenFitMode = applyFullscreenFitMode;
state.showFullscreenPageJumpInput = showFullscreenPageJumpInput;
state.hideFullscreenPageJumpInput = hideFullscreenPageJumpInput;
state.commitFullscreenPageJump = commitFullscreenPageJump;
state.ViewerFullscreen = ViewerFullscreen;
state.applyLandscapeTransform = applyLandscapeTransform;
state.resetLandscapePan = resetLandscapePan;
state.initFullscreenNavigation = initFullscreenNavigation;

if (typeof window !== 'undefined') {
  window.FULLSCREEN_CONTROLS_AUTOHIDE_DELAY = FULLSCREEN_CONTROLS_AUTOHIDE_DELAY;
  window.FULLSCREEN_MIN_ZOOM_SCALE = FULLSCREEN_MIN_ZOOM_SCALE;
  window.FULLSCREEN_MAX_ZOOM_SCALE = FULLSCREEN_MAX_ZOOM_SCALE;
  window.showFullscreenControls = showFullscreenControls;
  window.hideFullscreenControls = hideFullscreenControls;
  window.openFullscreen = openFullscreen;
  window.closeFullscreen = closeFullscreen;
  window.handleFullscreenImageClick = handleFullscreenImageClick;
  window.clamp = clamp;
  window.ensureFullscreenZoomBaseSize = ensureFullscreenZoomBaseSize;
  window.updateFullscreenScrollFromRatios = updateFullscreenScrollFromRatios;
  window.applyFullscreenZoom = applyFullscreenZoom;
  window.beginFullscreenPan = beginFullscreenPan;
  window.updateFullscreenPanPosition = updateFullscreenPanPosition;
  window.endFullscreenPan = endFullscreenPan;
  window.getDistanceBetweenPoints = getDistanceBetweenPoints;
  window.handleFullscreenPointerDown = handleFullscreenPointerDown;
  window.handleFullscreenPointerMove = handleFullscreenPointerMove;
  window.handleFullscreenPointerUp = handleFullscreenPointerUp;
  window.onFullscreenReset = onFullscreenReset;
  window.updateFullscreenPageStatus = updateFullscreenPageStatus;
  window.updateFullscreenViewerCentering = updateFullscreenViewerCentering;
  window.applyFullscreenFitMode = applyFullscreenFitMode;
  window.showFullscreenPageJumpInput = showFullscreenPageJumpInput;
  window.hideFullscreenPageJumpInput = hideFullscreenPageJumpInput;
  window.commitFullscreenPageJump = commitFullscreenPageJump;
  window.ViewerFullscreen = ViewerFullscreen;
  window.applyLandscapeTransform = applyLandscapeTransform;
  window.resetLandscapePan = resetLandscapePan;
  window.initFullscreenNavigation = initFullscreenNavigation;
}
