const IGNORED_WARN_PROPS = new Set([
  'escapeHtml', 'safeDirName', 'getRelativePath', 'debugLog',
  'enableComicsNowDebug', 'disableComicsNowDebug', 'isComicsNowDebugEnabled',
  'showView', 'createLoadingMessage', 'createEmptyMessage', 'createErrorMessage',
  'createCheckmarkIcon', 'apiCall', 'encodePath', 'toTrimmedString',
  'getComicById', 'turnToPage', 'pickMetadataValue', 'sanitizeComicTitle',
  'buildComicDisplayInfo', 'applyDisplayInfoToComic', 'applyDisplayInfoToLibrary',
  'getPathForCurrentView', 'resetFullscreenZoom', 'triggerEinkFlash',
  'ICONS', 'CSS_CLASSES'
]);

export const MIGRATED_STORE_PROPS = new Set([
  'currentPageIndex',
  'currentComic',
  'isContinuousMode',
  'isFullscreenZoomed',
  'fullscreenZoomScale',
  'currentView',
  'currentPublisher',
  'currentSeries',
  'currentRootFolder',
  'currentFolderPath',
  'seriesSortOrder',
  'activeFilter',
  'activeSmartFilter',
  'activeAlphaFilter'
]);

/**
 * Creates an Observable State Proxy that transparently bridges legacy `state.*`
 * access patterns to the central `ComicsStore`.
 *
 * Ensures 100% backward compatibility for all existing codebase reads, writes,
 * dynamic callback registrations, and Node VM test sandboxes.
 */
export function createStateProxy(store, options = {}) {
  const { warnOnDirectMutation = false } = options;
  const targetObj = Object.create(null);

  // Seed targetObj with initial keys from store.state for property enumeration
  if (store && store.state) {
    Object.assign(targetObj, store.state);
  }

  return new Proxy(targetObj, {
    get(target, prop) {
      if (prop === '__isStoreProxy') return true;
      if (prop === '__store') return store;

      // Prioritize store canonical state if property exists in store
      if (store && store.state && prop in store.state) {
        return store.get(prop);
      }

      // Fall back to target object (for methods, functions, or DOM refs attached to proxy)
      return target[prop];
    },

    set(target, prop, value) {
      if (
        warnOnDirectMutation &&
        typeof value !== 'function' &&
        (!value || typeof value !== 'object' || !value.nodeType) &&
        !IGNORED_WARN_PROPS.has(prop)
      ) {
        const isMigrated = MIGRATED_STORE_PROPS.has(prop);
        const tag = isMigrated ? ' (migrated to store.actions)' : '';
        try {
          const stack = new Error().stack?.split('\n').slice(2, 5).map(s => s.trim()).join(' <- ');
          console.warn(`[Store Proxy] Direct mutation to state.${String(prop)}${tag} detected from: ${stack}`);
        } catch {
          console.warn(`[Store Proxy] Direct mutation to state.${String(prop)}${tag} detected`);
        }
      }

      // Update the canonical store
      if (store) {
        store.set(prop, value, 'legacy_proxy');
      }

      // Also mirror onto targetObj so property reflection, Object.keys(), and in operator work
      target[prop] = value;
      return true;
    },

    has(target, prop) {
      return (store && store.state && prop in store.state) || prop in target;
    },

    ownKeys(target) {
      const storeKeys = store && store.state ? Reflect.ownKeys(store.state) : [];
      const targetKeys = Reflect.ownKeys(target);
      return Array.from(new Set([...storeKeys, ...targetKeys]));
    },

    getOwnPropertyDescriptor(target, prop) {
      if (prop in target) {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
      if (store && store.state && prop in store.state) {
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: store.get(prop)
        };
      }
      return undefined;
    }
  });
}
