/**
 * Unidirectional Action Dispatchers for Navigation and Filter states.
 * Coordinates mutations to currentView, breadcrumb context, filters, and series sorting.
 */
export function createNavigationActions(store) {
  return {
    /**
     * Change current application view with hierarchical context.
     * @param {string} view - 'root' | 'publisher' | 'series' | 'comic' | 'smartlist' | 'viewer' | 'search'
     * @param {Object} [context] - { publisher, series, folder, folderPath }
     */
    setView(view, context = {}) {
      store.set('currentView', view, 'navigation.setView');

      if (context.publisher !== undefined) {
        store.set('currentPublisher', context.publisher, 'navigation.setView');
      }
      if (context.series !== undefined) {
        store.set('currentSeries', context.series, 'navigation.setView');
      }
      if (context.folder !== undefined) {
        store.set('currentRootFolder', context.folder, 'navigation.setView');
      }
      if (context.folderPath !== undefined) {
        store.set('currentFolderPath', context.folderPath, 'navigation.setView');
      }

      store.bus.emit('navigation:viewChanged', { view, context });
    },

    /**
     * Set active filter by type.
     * @param {'status'|'alpha'|'smart'} filterType
     * @param {string|null} value
     */
    setFilter(filterType, value) {
      if (filterType === 'status') {
        store.set('activeFilter', value, 'filter.set');
      } else if (filterType === 'alpha') {
        store.set('activeAlphaFilter', value, 'filter.set');
      } else if (filterType === 'smart') {
        store.set('activeSmartFilter', value, 'filter.set');
      }

      store.bus.emit('filter:changed', { filterType, value });
    },

    /**
     * Update series sort order ('name' | 'date_asc' | 'date_desc').
     */
    setSeriesSortOrder(order) {
      store.set('seriesSortOrder', order, 'navigation.setSortOrder');
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('publisher_series_sort', order);
          localStorage.setItem('seriesSortOrder', order);
        } catch {}
      }
      store.bus.emit('navigation:sortChanged', { order });
    }
  };
}
