/**
 * Unidirectional Action Dispatchers for the Comic Viewer state domain.
 * Coordinates mutations to currentPageIndex, currentComic, isContinuousMode, and zoom states.
 */
export function createViewerActions(store) {
  return {
    /**
     * Change current page index with safety clamping and event notification.
     */
    setPageIndex(index, { source = 'user_nav', triggerFlash = false } = {}) {
      const comic = store.get('currentComic');
      const maxPages = (comic && comic.progress && typeof comic.progress.totalPages === 'number')
        ? comic.progress.totalPages
        : Infinity;

      const validIndex = Math.max(0, Math.min(Number(index) || 0, maxPages === Infinity ? Number(index) || 0 : maxPages - 1));

      store.set('currentPageIndex', validIndex, `viewer.setPageIndex[${source}]`);

      if (triggerFlash && store.get('einkMode') && store.get('einkMode') !== 'none') {
        store.bus.emit('eink:flash');
      }

      store.bus.emit('viewer:pageChanged', { pageIndex: validIndex, comic });
      return validIndex;
    },

    /**
     * Load a comic into the viewer.
     */
    setCurrentComic(comic, { initialPage = 0 } = {}) {
      store.set('currentComic', comic, 'viewer.setCurrentComic');
      store.set('currentPageIndex', initialPage, 'viewer.setCurrentComic');
      store.bus.emit('viewer:comicLoaded', { comic, initialPage });
    },

    /**
     * Toggle or set vertical continuous reading mode.
     */
    setContinuousMode(enabled) {
      const boolVal = !!enabled;
      store.set('isContinuousMode', boolVal, 'viewer.setContinuousMode');
      store.bus.emit('viewer:continuousToggled', { enabled: boolVal });
      return boolVal;
    },

    /**
     * Update fullscreen zoom parameters.
     */
    setZoom(isZoomed, { scale = 1, baseWidth = 0, baseHeight = 0 } = {}) {
      store.set('isFullscreenZoomed', !!isZoomed, 'viewer.setZoom');
      store.set('fullscreenZoomScale', scale, 'viewer.setZoom');
      store.set('fullscreenZoomBaseWidth', baseWidth, 'viewer.setZoom');
      store.set('fullscreenZoomBaseHeight', baseHeight, 'viewer.setZoom');
      store.bus.emit('viewer:zoomChanged', { isZoomed: !!isZoomed, scale, baseWidth, baseHeight });
    },

    /**
     * Close the viewer and restore previous navigation context.
     */
    closeViewer() {
      const returnContext = store.get('viewerReturnContext');
      store.set('currentComic', null, 'viewer.close');
      store.set('currentView', returnContext?.view || 'root', 'viewer.close');
      store.bus.emit('viewer:closed', { returnContext });
    }
  };
}
