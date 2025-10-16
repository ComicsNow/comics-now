(function (global) {
  'use strict';

  const FULLSCREEN_CONTROLS_AUTOHIDE_DELAY = 3000;
  const FULLSCREEN_MIN_ZOOM_SCALE = 1;
  const FULLSCREEN_MAX_ZOOM_SCALE = 4;

  let fullscreenControlsTimeoutId = null;
  let isFullscreenPanning = false;
  let fullscreenPanPointerId = null;
  let fullscreenPanStartX = 0;
  let fullscreenPanStartY = 0;
  let fullscreenPanScrollLeft = 0;
  let fullscreenPanScrollTop = 0;
  let fullscreenPanPointerType = '';
  const fullscreenTouchPointers = new Map();
  let fullscreenInitialPinchDistance = 0;
  let fullscreenInitialPinchScale = 1;
  let fullscreenPinchRatioX = 0.5;
  let fullscreenPinchRatioY = 0.5;

  function showFullscreenControls(autoHide = false) {
    const controls = global.fullscreenControls;
    const closeBtn = global.fullscreenCloseBtn;
    if (!controls) return;

    controls.classList.remove('hidden');
    if (closeBtn) {
      closeBtn.classList.remove('hidden');
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
        fullscreenControlsTimeoutId = null;
      }, FULLSCREEN_CONTROLS_AUTOHIDE_DELAY);
    }
  }

  function hideFullscreenControls() {
    const controls = global.fullscreenControls;
    const closeBtn = global.fullscreenCloseBtn;
    if (!controls) return;

    controls.classList.add('hidden');
    if (closeBtn) {
      closeBtn.classList.add('hidden');
    }
    clearTimeout(fullscreenControlsTimeoutId);
    fullscreenControlsTimeoutId = null;
  }

  function openFullscreen() {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

    const currentImage = document.querySelector('.viewer-image');
    if (currentImage) {
      image.src = currentImage.src;
    }

    viewer.classList.remove('hidden');
    if (typeof updateFullscreenPageStatus === 'function') {
      const totalPages = typeof getPageCounterTotal === 'function' ? getPageCounterTotal() : 0;
      updateFullscreenPageStatus(global.currentPageIndex + 1, totalPages);
    }

    hideFullscreenControls();
    if (typeof global.resetFullscreenZoom === 'function') {
      global.resetFullscreenZoom();
    }
    if (typeof applyFullscreenFitMode === 'function') {
      applyFullscreenFitMode();
    }

    if (viewer.requestFullscreen) {
      viewer.requestFullscreen().catch((error) => {
        
      });
    }

    const closeBtn = global.fullscreenCloseBtn;
    if (closeBtn) {
      closeBtn.focus();
    }
  }

  function closeFullscreen() {
    hideFullscreenControls();
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer) return;

    viewer.classList.add('hidden');

    if (fullscreenPanPointerId !== null && image && typeof image.releasePointerCapture === 'function') {
      try {
        image.releasePointerCapture(fullscreenPanPointerId);
      } catch (error) {
        
      }
    }

    isFullscreenPanning = false;
    fullscreenPanPointerId = null;
    if (typeof global.resetFullscreenZoom === 'function') {
      global.resetFullscreenZoom();
    }

    if (document.fullscreenElement === viewer && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function handleFullscreenImageClick(event) {
    const viewer = global.fullscreenViewer;
    if (!viewer) return;

    const rect = viewer.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const width = rect.width;
    const navZone = width * 0.3;

    if (!global.isFullscreenZoomed) {
      if (relativeX <= navZone) {
        global.hideFullscreenControls?.();
        // Note: navigatePage handles manga mode direction internally
        global.navigatePage?.(-1);
        return;
      }
      if (relativeX >= width - navZone) {
        global.hideFullscreenControls?.();
        // Note: navigatePage handles manga mode direction internally
        global.navigatePage?.(1);
        return;
      }
    }

    global.showFullscreenControls?.(true);
  }

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

    ensureFullscreenZoomBaseSize();

    const clampedScale = clamp(scale, FULLSCREEN_MIN_ZOOM_SCALE, FULLSCREEN_MAX_ZOOM_SCALE);
    if (clampedScale <= FULLSCREEN_MIN_ZOOM_SCALE) {
      if (!viewer.classList.contains('fullscreen-fit-mode')) {
        viewer.classList.add('fullscreen-fit-mode');
      }
      image.style.transform = '';
      image.style.transformOrigin = '';
      image.style.cursor = 'zoom-in';
      image.style.touchAction = '';
      global.isFullscreenZoomed = false;
      global.fullscreenZoomScale = FULLSCREEN_MIN_ZOOM_SCALE;
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

    updateFullscreenScrollFromRatios(ratioX, ratioY);
    updateFullscreenViewerCentering();
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
    fullscreenPanScrollLeft = viewer.scrollLeft;
    fullscreenPanScrollTop = viewer.scrollTop;

    if (image && typeof image.setPointerCapture === 'function') {
      try {
        image.setPointerCapture(pointerId);
      } catch (error) {
        
      }
    }

    if (image && (pointerType === 'mouse' || pointerType === 'pen')) {
      image.style.cursor = 'grabbing';
    }
  }

  function updateFullscreenPanPosition(clientX, clientY) {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

    const deltaX = clientX - fullscreenPanStartX;
    const deltaY = clientY - fullscreenPanStartY;

    const proposedScrollLeft = fullscreenPanScrollLeft - deltaX;
    const proposedScrollTop = fullscreenPanScrollTop - deltaY;

    const maxScrollLeft = image.scrollWidth - viewer.clientWidth;
    const maxScrollTop = image.scrollHeight - viewer.clientHeight;

    viewer.scrollLeft = clamp(proposedScrollLeft, 0, Math.max(maxScrollLeft, 0));
    viewer.scrollTop = clamp(proposedScrollTop, 0, Math.max(maxScrollTop, 0));
  }

  function endFullscreenPan(pointerId) {
    const image = global.fullscreenImage;
    if (!isFullscreenPanning) return;

    // Use the provided pointerId or fallback to the stored one
    const pointerIdToRelease = typeof pointerId === 'number' ? pointerId : fullscreenPanPointerId;

    if (image && typeof pointerIdToRelease === 'number' && typeof image.releasePointerCapture === 'function') {
      try {
        image.releasePointerCapture(pointerIdToRelease);
      } catch (error) {

      }
    }

    isFullscreenPanning = false;
    fullscreenPanPointerId = null;
    fullscreenPanPointerType = '';

    if (image && (image.style.cursor === 'grabbing' || image.style.cursor === 'grab')) {
      image.style.cursor = global.isFullscreenZoomed ? 'grab' : 'zoom-in';
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

    hideFullscreenControls();

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

      if (fullscreenTouchPointers.size === 1 && global.isFullscreenZoomed) {
        beginFullscreenPan(event.pointerId, 'touch', event.clientX, event.clientY);
      }

      return;
    }

    if (!global.isFullscreenZoomed) {
      return;
    }

    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
      return;
    }

    beginFullscreenPan(event.pointerId, event.pointerType, event.clientX, event.clientY);
  }

  function handleFullscreenPointerMove(event) {
    const viewer = global.fullscreenViewer;
    const image = global.fullscreenImage;
    if (!viewer || !image) return;

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

      if (fullscreenTouchPointers.size < 2) {
        fullscreenInitialPinchDistance = 0;
        fullscreenInitialPinchScale = global.fullscreenZoomScale || FULLSCREEN_MIN_ZOOM_SCALE;
        if (!global.isFullscreenZoomed && image) {
          image.style.touchAction = '';
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

    if (!isFullscreenPanning || event.pointerId !== fullscreenPanPointerId) return;

    endFullscreenPan(event.pointerId);
  }

  function onFullscreenReset() {
    const image = global.fullscreenImage;
    endFullscreenPan();
    fullscreenTouchPointers.clear();
    fullscreenInitialPinchDistance = 0;
    fullscreenInitialPinchScale = FULLSCREEN_MIN_ZOOM_SCALE;
    fullscreenPinchRatioX = 0.5;
    fullscreenPinchRatioY = 0.5;
    if (image) {
      image.style.cursor = 'zoom-in';
      image.style.touchAction = '';
    }
  }

  function updateFullscreenPageStatus(currentPage, totalPages) {
    const progressIndicator = global.fullscreenProgressIndicator;
    const pageIndicator = global.fullscreenPageIndicator;

    if (!progressIndicator || !pageIndicator) {
      return;
    }

    if (!totalPages || totalPages <= 0) {
      pageIndicator.textContent = '-- / --';
      progressIndicator.textContent = '0% read';
      return;
    }

    pageIndicator.textContent = `${currentPage} / ${totalPages}`;
    const progressPercent = Math.round((currentPage / totalPages) * 100);
    progressIndicator.textContent = `${progressPercent}% read`;
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
    image.style.cursor = 'zoom-in';
    image.style.touchAction = '';
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
  };

  global.ViewerFullscreen = ViewerFullscreen;
  Object.assign(global, ViewerFullscreen);
})(typeof window !== 'undefined' ? window : globalThis);
