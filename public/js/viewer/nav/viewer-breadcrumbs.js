import { state, global as canonicalGlobal } from '../../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

function updateViewerBreadcrumbs(comic, options = {}) {
  if (typeof global.updateBreadcrumb !== 'function') return;

  if (options.readingListId) {
    const listName = options.readingListName || 'Reading List';
    global.updateBreadcrumb([
      { label: 'Libraries', action: () => global.showRootFolderList?.({ force: true }) },
      { label: 'Reading Lists', action: () => global.openReadingListModal?.() },
      { label: listName },
    ]);
    return;
  }

  const root = global.currentRootFolder;
  const pub = global.currentPublisher;
  const series = global.currentSeries;
  const libLabel = root ? root.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || root : '';
  const displayInfo = global.applyDisplayInfoToComic?.(comic) || {};
  
  const crumbs = [
    { label: 'Libraries', action: () => global.showRootFolderList?.({ force: true }) }
  ];

  const rootData = global.library?.[root];
  const isFolderMode = rootData?.hierarchyMode === 'folder' || global.currentView === 'folder' || !!global.currentFolderPath;

  if (isFolderMode && !global.currentFolderPath && comic.path) {
    global.currentFolderPath = comic.path.substring(0, comic.path.lastIndexOf('/')).replace(/\\/g, '/');
  }

  if (isFolderMode && global.currentFolderPath && typeof global.showFolderView === 'function') {
    const folderPath = global.currentFolderPath;
    const normPath = folderPath.replace(/[\\\/]+$/, '');
    const rootFolders = (global.configuredRootFolders || []).map(f => f.replace(/[\\\/]+$/, ''));
    const matchedRoot = rootFolders.find(d => normPath === d || normPath.startsWith(d + '/')) || root;

    if (matchedRoot) {
      const rootName = (typeof window !== 'undefined' && window.LIBRARY_NAMES && window.LIBRARY_NAMES[matchedRoot]) || matchedRoot.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || matchedRoot;
      crumbs.push({
        label: rootName,
        action: () => global.showFolderView(matchedRoot, { force: true })
      });

      const relative = normPath.substring(matchedRoot.length).replace(/^\/+/, '');
      const parts = relative ? relative.split('/') : [];
      let currentPath = matchedRoot;
      
      parts.forEach((part) => {
        if (part) {
          currentPath += '/' + part;
          const targetPath = currentPath;
          crumbs.push({
            label: part,
            action: () => global.showFolderView(targetPath, { force: true })
          });
        }
      });
    }
  } else {
    const rootName = (typeof window !== 'undefined' && window.LIBRARY_NAMES && window.LIBRARY_NAMES[root]) || libLabel;
    if (rootName) {
      crumbs.push({ label: rootName, action: () => global.showPublisherList?.(root, { force: true }) });
    }

    const effectivePub = pub || comic.publisher;
    const effectiveSeries = series || comic.series;

    if (effectivePub && effectivePub !== 'Unknown Publisher') {
      crumbs.push({ label: effectivePub, action: () => global.showSeriesList?.(effectivePub, { force: true }) });
    }
    if (effectiveSeries && effectiveSeries !== 'Unknown Series') {
      crumbs.push({ label: effectiveSeries, action: () => global.showComicList?.(effectiveSeries, { force: true }) });
    }
  }

  const breadcrumbLabel = isFolderMode 
    ? (displayInfo.titleText || comic.name || 'Comic') 
    : (displayInfo.displayTitle || comic.name || 'Comic');

  crumbs.push({ label: breadcrumbLabel });
  global.updateBreadcrumb(crumbs);
}

export { updateViewerBreadcrumbs };
