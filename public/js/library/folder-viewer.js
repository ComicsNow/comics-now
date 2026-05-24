import { state, getRelativePath, escapeHtml, folderAlphaFilter } from '../globals.js';
import { renderAlphaFilter } from './alpha-list.js';

let lastFolderData = null;
let lastFolderPath = null;

export async function showFolderView(folderPath, options = {}) {
  const force = Boolean(options.force);
  const router = state.router || window.router;
  const _isNavigatingFromRouter = state._isNavigatingFromRouter || window._isNavigatingFromRouter;
  const _isAppInitializing = state._isAppInitializing || window._isAppInitializing;
  
  if (!_isNavigatingFromRouter && router && !_isAppInitializing) {
     const navPath = `/folder?path=${encodeURIComponent(folderPath)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       router.navigate(navPath, true);
       return;
     }
  }

  if (state.currentView !== 'folder') {
    state.activeAlphaFilter = 'All';
    if (typeof window !== 'undefined') {
      window.activeAlphaFilter = 'All';
    }
  }
  state.currentView = 'folder';
  state.currentRootFolder = state.currentRootFolder || folderPath;
  state.currentFolderPath = folderPath;
  if (typeof window !== 'undefined') {
    window.currentView = 'folder';
    window.currentRootFolder = state.currentRootFolder;
    window.currentFolderPath = folderPath;
  }
  
  const syncSmartFilterButtons = state.syncSmartFilterButtons || window.syncSmartFilterButtons;
  if (typeof syncSmartFilterButtons === 'function') {
    syncSmartFilterButtons();
  }
  
  const container = document.getElementById('folder-list-container');
  const viewDiv = document.getElementById('folder-list-view');
  
  const showView = state.showView || window.showView;
  if (typeof showView === 'function') {
    showView(viewDiv);
  }

  const mountSmartFilterHostInto = state.mountSmartFilterHostInto || window.mountSmartFilterHostInto;
  if (typeof mountSmartFilterHostInto === 'function') {
    mountSmartFilterHostInto(viewDiv);
  }

  // Update breadcrumbs
  const showRootFolderList = state.showRootFolderList || window.showRootFolderList;
  const crumbs = [{ label: 'Libraries', action: () => typeof showRootFolderList === 'function' && showRootFolderList({ force: true }) }];
  
  // Normalize path for comparison
  const normPath = folderPath.replace(/[\\\/]+$/, '');
  
  // Decompose path for breadcrumbs
  const rootFolders = (state.configuredRootFolders || window.configuredRootFolders || []).map(f => f.replace(/[\\\/]+$/, ''));
  const rootFolder = rootFolders.find(d => normPath === d || normPath.startsWith(d + '/'));
  
  if (rootFolder) {
    const relative = normPath.substring(rootFolder.length).replace(/^\/+/, '');
    const parts = relative ? relative.split('/') : [];
    
    const libraryNames = state.LIBRARY_NAMES || window.LIBRARY_NAMES || {};
    const rootLabel = libraryNames[rootFolder] || rootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || rootFolder;

    crumbs.push({ 
      label: rootLabel, 
      action: () => showFolderView(rootFolder, { force: true }) 
    });
    
    let currentPath = rootFolder;
    parts.forEach((part, i) => {
      currentPath += '/' + part;
      const isLast = i === parts.length - 1;
      if (!isLast) {
        const targetPath = currentPath;
        crumbs.push({ 
          label: part, 
          action: () => showFolderView(targetPath, { force: true }) 
        });
      } else {
        crumbs.push({ label: part });
      }
    });
  }
  
  const updateBreadcrumb = state.updateBreadcrumb || window.updateBreadcrumb || state.LibraryBreadcrumb?.updateBreadcrumb || window.LibraryBreadcrumb?.updateBreadcrumb;
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(crumbs);
  }

  // Use cache if path is the same and not forcing
  if (lastFolderPath === folderPath && lastFolderData && !force) {
    if (folderAlphaFilter) {
      renderAlphaFilter(folderAlphaFilter, lastFolderData, renderFolderView, 'folder');
    } else {
      renderFolderView(lastFolderData);
    }
    return;
  }

  const createLoadingMessage = state.createLoadingMessage || window.createLoadingMessage;
  if (container) {
    container.innerHTML = typeof createLoadingMessage === 'function' 
      ? createLoadingMessage('Loading folder contents...') 
      : 'Loading folder contents...';
  }

  try {
    // Use UTF-8 safe base64 encoding for paths (btoa only supports ASCII)
    const encodedPath = btoa(encodeURIComponent(folderPath).replace(/%([0-9A-F]{2})/g, (match, p1) => {
      return String.fromCharCode('0x' + p1);
    }));
    
    const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
    const response = await fetch(`${apiBaseUrl}/api/v1/folders/${encodeURIComponent(encodedPath)}`);
    
    const createErrorMessage = state.createErrorMessage || window.createErrorMessage;
    if (!response.ok) {
      const text = await response.text();
      let errorMessage = `Server error: ${response.status}`;
      try {
        const errorData = JSON.parse(text);
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        // Not JSON
      }
      if (container) {
        container.innerHTML = typeof createErrorMessage === 'function' ? createErrorMessage(errorMessage) : errorMessage;
      }
      return;
    }

    const data = await response.json();

    if (data && data.ok) {
       lastFolderData = data;
       lastFolderPath = folderPath;
       if (folderAlphaFilter) {
         renderAlphaFilter(folderAlphaFilter, data, renderFolderView, 'folder');
       } else {
         renderFolderView(data);
       }
    } else {
       if (container) {
         container.innerHTML = typeof createErrorMessage === 'function' ? createErrorMessage(data.message || 'Error loading folder.') : (data.message || 'Error loading folder.');
       }
    }
  } catch (error) {
    console.error('[folder-view] Error:', error);
    const createErrorMessage = state.createErrorMessage || window.createErrorMessage;
    if (container) {
      container.innerHTML = typeof createErrorMessage === 'function' ? createErrorMessage('Failed to load folder contents.') : 'Failed to load folder contents.';
    }
  }
}

export function renderFolderView(data) {
  const container = document.getElementById('folder-list-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  let { folders, comics } = data;

  const activeFilter = state.activeFilter || window.activeFilter;
  const getComicStatus = state.getComicStatus || window.getComicStatus;

  // Filter comics based on active filter
  if (activeFilter && activeFilter !== 'all') {
    comics = comics.filter(comic => {
      const status = typeof getComicStatus === 'function' ? getComicStatus(comic) : 'unread';
      return status === activeFilter;
    });
  }

  const createEmptyMessage = state.createEmptyMessage || window.createEmptyMessage;
  if (folders.length === 0 && comics.length === 0) {
    container.innerHTML = typeof createEmptyMessage === 'function' 
      ? createEmptyMessage('This folder is empty.') 
      : 'This folder is empty.';
    return;
  }

  // Render Folders
  folders.forEach(folder => {
    const card = document.createElement('div');
    card.className = 'folder-card bg-gray-800 rounded-lg shadow-lg overflow-hidden cursor-pointer p-4 flex flex-col items-center justify-center';
    card.innerHTML = `
      <div class="h-32 w-32 text-purple-500 mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
      <h3 class="text-sm font-semibold text-white text-center truncate w-full">${escapeHtml(folder.name)}</h3>
    `;
    card.addEventListener('click', () => showFolderView(folder.path));

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;
    const folderContextData = {
      folderPath: folder.path,
      folderName: folder.name
    };

    const showFolderContextMenu = state.showFolderContextMenu || window.showFolderContextMenu;

    card.addEventListener('contextmenu', (e) => {
      if (typeof showFolderContextMenu === 'function') {
        showFolderContextMenu(e, folderContextData);
      }
    });

    // Long-press for mobile
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof showFolderContextMenu === 'function') {
          contextMenuShown = true;
          showFolderContextMenu(e, folderContextData);
        }
      }, 500); // 500ms long press
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // Prevent click if context menu was just shown
      if (contextMenuShown) {
        e.preventDefault();
        e.stopPropagation();
        contextMenuShown = false;
      }
    });

    card.addEventListener('touchmove', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    container.appendChild(card);
  });

  // Render Comics
  if (comics.length > 0) {
    // Enrich comics with local metadata (e.g. mangaMode, continuousMode)
    const comicIdMap = state.comicIdMap || window.comicIdMap;
    if (comicIdMap) {
      comics.forEach(c => {
        const cached = comicIdMap.get(c.id);
        if (cached) {
          c.mangaMode = cached.mangaMode;
          c.continuousMode = cached.continuousMode;
        }
      });
    }

    const comicContainer = document.createElement('div');
    comicContainer.className = 'col-span-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-4';
    container.appendChild(comicContainer);
    
    const renderComicCards = state.renderComicCards || window.renderComicCards;
    if (typeof renderComicCards === 'function') {
      renderComicCards(comics, 'folder', comicContainer);
    }
  }
}

export function invalidateFolderCache() {
  lastFolderData = null;
  lastFolderPath = null;
}

export const FolderViewer = {
  showFolderView,
  invalidateFolderCache
};

// Expose on state & window for transitional compatibility
state.FolderViewer = FolderViewer;
Object.assign(state, FolderViewer);

if (typeof window !== 'undefined') {
  window.FolderViewer = FolderViewer;
  Object.assign(window, FolderViewer);
}
