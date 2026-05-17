(function (global) {
  'use strict';

  let lastFolderData = null;
  let lastFolderPath = null;

  async function showFolderView(folderPath, options = {}) {
    const force = Boolean(options.force);
    
    if (!window._isNavigatingFromRouter && window.router && !window._isAppInitializing) {
       const navPath = `/folder?path=${encodeURIComponent(folderPath)}`;
       if ((global.getRelativePath() + window.location.search) !== navPath) {
         window.router.navigate(navPath, true);
         return;
       }
    }

    global.currentView = 'folder';
    global.currentRootFolder = global.currentRootFolder || folderPath;
    global.currentFolderPath = folderPath;
    
    global.syncSmartFilterButtons();
    
    const container = document.getElementById('folder-list-container');
    const viewDiv = document.getElementById('folder-list-view');
    
    global.showView(viewDiv);
    global.mountSmartFilterHostInto(viewDiv);

    // Update breadcrumbs
    const crumbs = [{ label: 'Libraries', action: () => global.showRootFolderList({ force: true }) }];
    
    // Normalize path for comparison
    const normPath = folderPath.replace(/[\\\/]+$/, '');
    
    // Decompose path for breadcrumbs
    const rootFolders = (global.configuredRootFolders || []).map(f => f.replace(/[\\\/]+$/, ''));
    const rootFolder = rootFolders.find(d => normPath === d || normPath.startsWith(d + '/'));
    
    if (rootFolder) {
      const relative = normPath.substring(rootFolder.length).replace(/^\/+/, '');
      const parts = relative ? relative.split('/') : [];
      
      const rootLabel = (window.LIBRARY_NAMES && window.LIBRARY_NAMES[rootFolder]) || rootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || rootFolder;

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
    
    global.updateBreadcrumb(crumbs);

    // Use cache if path is the same and not forcing
    if (lastFolderPath === folderPath && lastFolderData && !force) {
      renderFolderView(lastFolderData);
      return;
    }

    if (container) {
      container.innerHTML = global.createLoadingMessage('Loading folder contents...');
    }

    try {
      // Use UTF-8 safe base64 encoding for paths (btoa only supports ASCII)
      const encodedPath = btoa(encodeURIComponent(folderPath).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode('0x' + p1);
      }));
      
      const response = await fetch(`${global.API_BASE_URL}/api/v1/folders/${encodeURIComponent(encodedPath)}`);
      
      if (!response.ok) {
        const text = await response.text();
        let errorMessage = `Server error: ${response.status}`;
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          // Not JSON
        }
        container.innerHTML = global.createErrorMessage(errorMessage);
        return;
      }

      const data = await response.json();

      if (data && data.ok) {
         lastFolderData = data;
         lastFolderPath = folderPath;
         renderFolderView(data);
      } else {
         container.innerHTML = global.createErrorMessage(data.message || 'Error loading folder.');
      }
    } catch (error) {
      console.error('[folder-view] Error:', error);
      container.innerHTML = global.createErrorMessage('Failed to load folder contents.');
    }
  }

  function renderFolderView(data) {
    const container = document.getElementById('folder-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    let { folders, comics } = data;

    // Filter comics based on active filter
    if (global.activeFilter && global.activeFilter !== 'all') {
      comics = comics.filter(comic => {
        const status = global.getComicStatus(comic);
        return status === global.activeFilter;
      });
    }

    if (folders.length === 0 && comics.length === 0) {
      container.innerHTML = global.createEmptyMessage('This folder is empty.');
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
        <h3 class="text-sm font-semibold text-white text-center truncate w-full">${global.escapeHtml(folder.name)}</h3>
      `;
      card.addEventListener('click', () => showFolderView(folder.path));

      // Add context menu support (right-click and long-press)
      let longPressTimer = null;
      let contextMenuShown = false;
      const folderContextData = {
        folderPath: folder.path,
        folderName: folder.name
      };

      card.addEventListener('contextmenu', (e) => {
        if (typeof global.showFolderContextMenu === 'function') {
          global.showFolderContextMenu(e, folderContextData);
        }
      });

      // Long-press for mobile
      card.addEventListener('touchstart', (e) => {
        contextMenuShown = false;
        longPressTimer = setTimeout(() => {
          if (typeof global.showFolderContextMenu === 'function') {
            contextMenuShown = true;
            global.showFolderContextMenu(e, folderContextData);
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
      if (global.comicIdMap) {
        comics.forEach(c => {
          const cached = global.comicIdMap.get(c.id);
          if (cached) {
            c.mangaMode = cached.mangaMode;
            c.continuousMode = cached.continuousMode;
          }
        });
      }

      const comicContainer = document.createElement('div');
      comicContainer.className = 'col-span-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-4';
      container.appendChild(comicContainer);
      
      global.renderComicCards(comics, 'folder', comicContainer);
    }
  }

  function invalidateFolderCache() {
    lastFolderData = null;
    lastFolderPath = null;
  }

  global.FolderViewer = {
    showFolderView,
    invalidateFolderCache
  };
  Object.assign(global, global.FolderViewer);
})(typeof window !== 'undefined' ? window : globalThis);
