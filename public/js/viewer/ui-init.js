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

  function initializeViewerUIControls() {
    // Check if required functions are available, if not retry later
    if (typeof global.navigateBackFromViewer !== 'function' ||
        typeof global.setFitToHeightMode !== 'function' ||
        typeof global.setOrientationMode !== 'function' ||
        typeof global.openFullscreen !== 'function' ||
        typeof global.closeFullscreen !== 'function' ||
        typeof global.navigatePage !== 'function') {
      setTimeout(initializeViewerUIControls, 100);
      return;
    }

    if (typeof global.refreshToolbarLabels === 'function') {
      global.refreshToolbarLabels();
    }

    // Tab switching logic
    if (global.viewerTabBtn && !global.viewerTabBtn._tabListener) {
      global.viewerTabBtn._tabListener = (e) => {
        if (e) e.preventDefault();
        global.viewerTabBtn.classList.add('active');
        global.metadataTabBtn?.classList.remove('active');
        global.viewerContent?.classList.remove('hidden');
        global.metadataContent?.classList.add('hidden');
      };
      global.viewerTabBtn.addEventListener('click', global.viewerTabBtn._tabListener);
    }

    if (global.metadataTabBtn && !global.metadataTabBtn._tabListener) {
      global.metadataTabBtn._tabListener = (e) => {
        if (e) e.preventDefault();

        // Security check: Only admins can access metadata
        const isAdmin = window.syncManager && window.syncManager.userRole === 'admin';
        if (!isAdmin) {
          console.warn('[Viewer] Non-admin user tried to access metadata view');
          return;
        }

        global.metadataTabBtn.classList.add('active');
        global.viewerTabBtn?.classList.remove('active');
        global.metadataContent?.classList.remove('hidden');
        global.viewerContent?.classList.add('hidden');
        if (typeof global.loadMetadata === 'function') {
          global.loadMetadata();
        }
      };
      global.metadataTabBtn.addEventListener('click', global.metadataTabBtn._tabListener);
    }

    if (global.viewerLibrariesBtn && !global.viewerLibrariesBtn._navListener) {
      global.viewerLibrariesBtn._navListener = (event) => {
        event.preventDefault();
        global.navigateBackFromViewer(null);
      };
      global.viewerLibrariesBtn.addEventListener('click', global.viewerLibrariesBtn._navListener);
    }

    if (global.viewerPublisherBtn && !global.viewerPublisherBtn._navListener) {
      global.viewerPublisherBtn._navListener = (event) => {
        event.preventDefault();
        if (global.currentRootFolder) {
          global.navigateBackFromViewer({ view: 'publishers', rootFolder: global.currentRootFolder });
        } else {
          global.navigateBackFromViewer(null);
        }
      };
      global.viewerPublisherBtn.addEventListener('click', global.viewerPublisherBtn._navListener);
    }

    if (global.viewerSeriesBtn && !global.viewerSeriesBtn._navListener) {
      global.viewerSeriesBtn._navListener = (event) => {
        event.preventDefault();
        if (global.currentRootFolder && global.currentPublisher) {
          global.navigateBackFromViewer({
            view: 'series',
            rootFolder: global.currentRootFolder,
            publisher: global.currentPublisher,
          });
        } else if (global.currentRootFolder) {
          global.navigateBackFromViewer({ view: 'publishers', rootFolder: global.currentRootFolder });
        } else {
          global.navigateBackFromViewer(null);
        }
      };
      global.viewerSeriesBtn.addEventListener('click', global.viewerSeriesBtn._navListener);
    }

    if (global.fitHeightBtn && !global.fitHeightBtn._toggleListener) {
      global.fitHeightBtn._toggleListener = () => {
        global.setFitToHeightMode(!global.isFitToHeight);
      };
      global.fitHeightBtn.addEventListener('click', global.fitHeightBtn._toggleListener);
      global.setFitToHeightMode(global.isFitToHeight);
    }


    if (global.orientationToggleBtn && !global.orientationToggleBtn._toggleListener) {
      global.orientationToggleBtn._toggleListener = () => {
        global.setOrientationMode(global.isLandscapeOrientation ? 'portrait' : 'landscape');
      };
      global.orientationToggleBtn.addEventListener('click', global.orientationToggleBtn._toggleListener);
    }

    if (global.fullscreenOrientationBtn && !global.fullscreenOrientationBtn._toggleListener) {
      global.fullscreenOrientationBtn._toggleListener = () => {
        global.setOrientationMode(global.isLandscapeOrientation ? 'portrait' : 'landscape');
      };
      global.fullscreenOrientationBtn.addEventListener('click', global.fullscreenOrientationBtn._toggleListener);
    }

    const einkBtn = document.getElementById('fullscreen-eink-toggle-btn');
    if (einkBtn && !einkBtn._clickListener) {
      const applyEinkVisuals = (mode) => {
        document.body.classList.remove('eink-mode', 'eink-color-mode');
        einkBtn.classList.remove('active', 'active-monochrome', 'active-color');
        
        if (mode === 'monochrome') {
          document.body.classList.add('eink-mode');
          einkBtn.classList.add('active', 'active-monochrome');
          einkBtn.setAttribute('aria-pressed', 'true');
          einkBtn.title = "E-Ink Anti-Ghosting Mode (Monochrome)";
        } else if (mode === 'color') {
          document.body.classList.add('eink-color-mode');
          einkBtn.classList.add('active', 'active-color');
          einkBtn.setAttribute('aria-pressed', 'true');
          einkBtn.title = "E-Ink Anti-Ghosting Mode (Color)";
        } else {
          einkBtn.setAttribute('aria-pressed', 'false');
          einkBtn.title = "E-Ink Anti-Ghosting Mode (Off)";
        }
      };

      // Set initial state on load
      applyEinkVisuals(global.einkMode);

      einkBtn._clickListener = () => {
        let nextMode = 'none';
        if (global.einkMode === 'none') {
          nextMode = 'monochrome';
        } else if (global.einkMode === 'monochrome') {
          nextMode = 'color';
        } else {
          nextMode = 'none';
        }

        global.einkMode = nextMode;
        localStorage.setItem('eink_mode', nextMode);
        applyEinkVisuals(nextMode);

        if (nextMode !== 'none' && typeof global.triggerEinkFlash === 'function') {
          global.triggerEinkFlash();
        }
      };
      einkBtn.addEventListener('click', einkBtn._clickListener);
    }

    if (global.fullscreenBtn && !global.fullscreenBtn._openListener) {
      global.fullscreenBtn._openListener = (event) => {
        event.preventDefault();
        global.openFullscreen();
      };
      global.fullscreenBtn.addEventListener('click', global.fullscreenBtn._openListener);
    }

    if (global.fullscreenCloseBtn && !global.fullscreenCloseBtn._closeListener) {
      global.fullscreenCloseBtn._closeListener = (event) => {
        event.preventDefault();
        global.closeFullscreen();
      };
      global.fullscreenCloseBtn.addEventListener('click', global.fullscreenCloseBtn._closeListener);
    }

    if (global.fullscreenCloseBtnBottom && !global.fullscreenCloseBtnBottom._closeListener) {
      global.fullscreenCloseBtnBottom._closeListener = (event) => {
        event.preventDefault();
        global.closeFullscreen();
      };
      global.fullscreenCloseBtnBottom.addEventListener('click', global.fullscreenCloseBtnBottom._closeListener);
    }

    // Side-nav hotspots (#fullscreen-nav-left / -right) are exclusively long-press
    // triggers — no single-click navigation. Long-press is handled by
    // bindFullscreenLongPress on the viewer; the overlay divs let pointer events
    // through to the viewer (and CSS gates them off entirely when zoomed).

    const fullscreenImage = global.fullscreenImage;
    const fullscreenViewer = global.fullscreenViewer;
    if (fullscreenViewer && !fullscreenViewer._viewerPointerListenersAttached) {
      fullscreenViewer.addEventListener('pointerdown', global.handleFullscreenPointerDown);
      fullscreenViewer.addEventListener('pointermove', global.handleFullscreenPointerMove);
      fullscreenViewer.addEventListener('pointerup', global.handleFullscreenPointerUp);
      fullscreenViewer.addEventListener('pointercancel', global.handleFullscreenPointerUp);
      fullscreenViewer._viewerPointerListenersAttached = true;
    }
    if (typeof global.bindFullscreenLongPress === 'function') {
      global.bindFullscreenLongPress();
    }
    if (typeof global.bindFullscreenZoomToggle === 'function') {
      global.bindFullscreenZoomToggle();
    }
    if (fullscreenImage && !fullscreenImage._viewerListenersAttached) {
      fullscreenImage.addEventListener('click', global.handleFullscreenImageClick);
      fullscreenImage._viewerListenersAttached = true;
    }

    // Tapping the viewer background (the dark borders above / below / beside
    // the comic page) should also surface controls — same behaviour as a
    // single tap on the image itself.
    if (fullscreenViewer && !fullscreenViewer._bgClickAttached) {
      fullscreenViewer._bgClickAttached = true;
      fullscreenViewer.addEventListener('click', (event) => {
        if (event.target !== fullscreenViewer) return;
        global.showFullscreenControls?.(true);
      });
    }

    if (!document._viewerEscListener) {
      document._viewerEscListener = (event) => {
        if (event.key === 'Escape' && global.fullscreenViewer && !global.fullscreenViewer.classList.contains('hidden')) {
          event.preventDefault();
          if (typeof global.closeFullscreen === 'function') {
            global.closeFullscreen();
          }
        }
      };
      document.addEventListener('keydown', document._viewerEscListener);
    }

    if (!document._viewerFullscreenListener) {
      document._viewerFullscreenListener = () => {
        if (!document.fullscreenElement && global.fullscreenViewer && !global.fullscreenViewer.classList.contains('hidden')) {
          if (typeof global.closeFullscreen === 'function') {
            global.closeFullscreen();
          }
        }
      };
      document.addEventListener('fullscreenchange', document._viewerFullscreenListener);
    }

    if (global.comicSummaryToggle && !global.comicSummaryToggle._toggleListener) {
      global.comicSummaryToggle._toggleListener = () => {
        const isExpanded = global.comicSummaryToggle.getAttribute('aria-expanded') === 'true';
        global.comicSummaryToggle.setAttribute('aria-expanded', String(!isExpanded));
        if (isExpanded) {
          global.comicSummaryContent?.classList.add('hidden');
          global.comicSummaryToggle.textContent = 'Show Summary';
        } else {
          global.comicSummaryContent?.classList.remove('hidden');
          global.comicSummaryToggle.textContent = 'Hide Summary';
        }
      };
      global.comicSummaryToggle.addEventListener('click', global.comicSummaryToggle._toggleListener);
    }

    if (typeof global.setOrientationMode === 'function') {
      global.setOrientationMode(global.isLandscapeOrientation ? 'landscape' : 'portrait');
    }
    global.debugLog?.('UI', 'Viewer controls initialized');
  }

  global.initializeViewerUIControls = initializeViewerUIControls;

export {
  initializeViewerUIControls
};

state.initializeViewerUIControls = initializeViewerUIControls;

if (typeof window !== 'undefined') {
  window.initializeViewerUIControls = initializeViewerUIControls;
}
