(function (global) {
  'use strict';

  const DEVICE_LIBRARIES_STORE = 'deviceLibraries';
  const DEVICE_COMICS_STORE = 'deviceComics';

  /**
   * Request access to a local directory or files (Cross-Platform)
   */
  async function requestDeviceLibrary() {
    // Check if the modern File System Access API is available
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        const handle = await window.showDirectoryPicker({
          mode: 'read'
        });
        
        if (!handle) return;

        const libraryId = 'device-' + Date.now();
        await saveDeviceLibrary(libraryId, handle);
        
        // Start initial scan
        await scanDeviceLibrary(libraryId, handle);
        
        // Refresh UI
        if (typeof global.showRootFolderList === 'function') {
          global.showRootFolderList({ force: true });
        } else if (typeof global.applyFilterAndRender === 'function') {
          global.applyFilterAndRender();
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Error selecting directory:', err);
          alert('Failed to access local directory: ' + err.message);
        }
      }
    } else {
      // Fallback for Android, iOS, Firefox, and older browsers
      console.log('showDirectoryPicker not available, using file input fallback');
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.webkitdirectory = true; // For desktop Firefox/Safari
      
      input.onchange = async (e) => {
        const files = Array.from(e.target.files).filter(f => 
          f.name.toLowerCase().endsWith('.cbz') || f.name.toLowerCase().endsWith('.cbr')
        );
        
        if (files.length === 0) {
          alert('No .cbz or .cbr files found in the selection.');
          return;
        }

        const libraryId = 'device-legacy-' + Date.now();
        const libraryName = files[0].webkitRelativePath 
          ? files[0].webkitRelativePath.split('/')[0] 
          : 'Local Files';

        await saveLegacyDeviceLibrary(libraryId, libraryName, files);
        
        // Refresh UI
        if (typeof global.showRootFolderList === 'function') {
          global.showRootFolderList({ force: true });
        } else if (typeof global.applyFilterAndRender === 'function') {
          global.applyFilterAndRender();
        }
      };
      
      input.click();
    }
  }

  /**
   * Save legacy device library (no persistent handles)
   */
  async function saveLegacyDeviceLibrary(id, name, files) {
    const db = await global.openOfflineDB();
    const libraryEntry = {
      id: id,
      name: name,
      isLegacy: true,
      addedAt: Date.now()
    };

    const comics = files.map(file => ({
      id: `${id}:${file.webkitRelativePath || file.name}`,
      libraryId: id,
      name: file.name,
      path: file.webkitRelativePath || file.name,
      file: file, // This will not persist across reloads
      isLegacy: true,
      addedAt: Date.now()
    }));

    // Save to IndexedDB
    const tx = db.transaction([DEVICE_LIBRARIES_STORE, DEVICE_COMICS_STORE], 'readwrite');
    tx.objectStore(DEVICE_LIBRARIES_STORE).put(libraryEntry);
    const comicStore = tx.objectStore(DEVICE_COMICS_STORE);
    for (const comic of comics) {
      comicStore.put(comic);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Save device library root to IndexedDB
   */
  async function saveDeviceLibrary(id, handle) {
    const db = await global.openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([DEVICE_LIBRARIES_STORE], 'readwrite');
      const store = tx.objectStore(DEVICE_LIBRARIES_STORE);
      const request = store.put({
        id: id,
        name: handle.name,
        handle: handle,
        addedAt: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Scan a device library for CBZ/CBR files
   */
  async function scanDeviceLibrary(libraryId, directoryHandle) {
    console.log(`Scanning device library: ${directoryHandle.name}`);
    const comics = [];
    
    async function walk(handle, relativePath = '') {
      for await (const entry of handle.values()) {
        const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          await walk(entry, path);
        } else if (entry.kind === 'file') {
          if (entry.name.toLowerCase().endsWith('.cbz') || entry.name.toLowerCase().endsWith('.cbr')) {
            comics.push({
              id: `${libraryId}:${path}`,
              libraryId: libraryId,
              name: entry.name,
              path: path,
              handle: entry,
              addedAt: Date.now()
            });
          }
        }
      }
    }

    await walk(directoryHandle);
    console.log(`Found ${comics.length} local comics`);

    // Save comics to DB
    const db = await global.openOfflineDB();
    const tx = db.transaction([DEVICE_COMICS_STORE], 'readwrite');
    const store = tx.objectStore(DEVICE_COMICS_STORE);
    
    for (const comic of comics) {
      store.put(comic);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(comics);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get all device libraries
   */
  async function getDeviceLibraries() {
    const db = await global.openOfflineDB();
    if (!db.objectStoreNames.contains(DEVICE_LIBRARIES_STORE)) return [];

    return new Promise((resolve, reject) => {
      const tx = db.transaction([DEVICE_LIBRARIES_STORE], 'readonly');
      const store = tx.objectStore(DEVICE_LIBRARIES_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all comics for a device library
   */
  async function getDeviceComics(libraryId) {
    const db = await global.openOfflineDB();
    if (!db.objectStoreNames.contains(DEVICE_COMICS_STORE)) return [];

    return new Promise((resolve, reject) => {
      const tx = db.transaction([DEVICE_COMICS_STORE], 'readonly');
      const store = tx.objectStore(DEVICE_COMICS_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const allComics = request.result || [];
        resolve(allComics.filter(c => c.libraryId === libraryId));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove a device library
   */
  async function removeDeviceLibrary(libraryId) {
    const db = await global.openOfflineDB();
    const tx = db.transaction([DEVICE_LIBRARIES_STORE, DEVICE_COMICS_STORE], 'readwrite');
    
    tx.objectStore(DEVICE_LIBRARIES_STORE).delete(libraryId);
    
    // Also delete associated comics
    const comicsStore = tx.objectStore(DEVICE_COMICS_STORE);
    const request = comicsStore.getAll();
    request.onsuccess = () => {
      const allComics = request.result || [];
      for (const comic of allComics) {
        if (comic.libraryId === libraryId) {
          comicsStore.delete(comic.id);
        }
      }
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        if (typeof global.showRootFolderList === 'function') {
          global.showRootFolderList({ force: true });
        } else if (typeof global.applyFilterAndRender === 'function') {
          global.applyFilterAndRender();
        }
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Render local libraries as cards in the root folder view
   */
  async function appendDeviceLibraryCards(container) {
    const libraries = await getDeviceLibraries();
    if (libraries.length === 0) return;

    for (const lib of libraries) {
      const comics = await getDeviceComics(lib.id);
      const card = document.createElement('div');
      card.className = 'bg-gray-800 rounded-lg overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer group relative border border-gray-700 hover:border-purple-500';
      
      let statusHtml = '';
      let isDisconnected = false;

      if (lib.isLegacy) {
        // Legacy libraries are disconnected by default after reload
        const sampleComic = comics[0];
        isDisconnected = !sampleComic || !sampleComic.file;
        statusHtml = isDisconnected 
          ? '<div class="mt-2 text-xs text-red-400">Disconnected (Click to re-attach)</div>'
          : '<div class="mt-2 text-xs text-green-400">Connected</div>';
      } else {
        // Verification of handle (permissions)
        let permissionStatus = 'prompt';
        try {
          permissionStatus = await lib.handle.queryPermission({ mode: 'read' });
        } catch (e) {
          console.warn('Could not query permission', e);
        }
        if (permissionStatus !== 'granted') {
          statusHtml = '<div class="mt-2 text-xs text-yellow-500">Permission Required</div>';
        }
      }

      card.innerHTML = `
        <div class="aspect-[2/3] bg-gray-700 flex flex-col items-center justify-center p-4 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 ${isDisconnected ? 'text-gray-600' : 'text-gray-500'} mb-2 group-hover:text-purple-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <div class="text-white font-bold truncate w-full">${global.escapeHtml(lib.name)}</div>
          <div class="text-gray-400 text-sm mt-1">Local Device Library</div>
          <div class="text-xs text-gray-500 mt-2">${comics.length} Comics</div>
          ${statusHtml}
        </div>
        <div class="absolute top-2 right-2 z-20">
          <button class="bg-red-600/80 hover:bg-red-600 text-white p-1.5 rounded-full remove-device-lib shadow-lg backdrop-blur-sm transition-all" data-id="${lib.id}" title="Remove Library">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      `;

      card.onclick = async (e) => {
        if (e.target.closest('.remove-device-lib')) {
          const id = e.target.closest('.remove-device-lib').dataset.id;
          if (confirm('Remove this local library? It won\'t delete your files.')) {
            await removeDeviceLibrary(id);
          }
          return;
        }

        if (lib.isLegacy) {
          const sampleComic = comics[0];
          if (!sampleComic || !sampleComic.file) {
            await reattachLegacyLibrary(lib.id);
            return;
          }
        } else {
          // Check/Request permission
          if (await lib.handle.queryPermission({ mode: 'read' }) !== 'granted') {
            if (await lib.handle.requestPermission({ mode: 'read' }) !== 'granted') {
              return;
            }
            if (typeof global.showRootFolderList === 'function') {
          global.showRootFolderList({ force: true });
        } else if (typeof global.applyFilterAndRender === 'function') {
          global.applyFilterAndRender();
        }
          }
        }

        showDeviceLibraryComics(lib.id, lib.name);
      };

      const addButton = container.querySelector('.add-device-library-card');
      if (addButton) {
        container.insertBefore(card, addButton);
      } else {
        container.appendChild(card);
      }
    }
  }

  /**
   * Re-attach files to a legacy library
   */
  async function reattachLegacyLibrary(libraryId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    
    input.onchange = async (e) => {
      const files = Array.from(e.target.files).filter(f => 
        f.name.toLowerCase().endsWith('.cbz') || f.name.toLowerCase().endsWith('.cbr')
      );
      
      if (files.length === 0) return;

      const db = await global.openOfflineDB();
      const comics = await getDeviceComics(libraryId);
      
      const tx = db.transaction([DEVICE_COMICS_STORE], 'readwrite');
      const store = tx.objectStore(DEVICE_COMICS_STORE);

      let reattachedCount = 0;
      for (const comic of comics) {
        const matchingFile = files.find(f => (f.webkitRelativePath || f.name) === comic.path);
        if (matchingFile) {
          comic.file = matchingFile;
          store.put(comic);
          reattachedCount++;
        }
      }

      tx.oncomplete = () => {
        console.log(`Re-attached ${reattachedCount} files to library ${libraryId}`);
        if (typeof global.showRootFolderList === 'function') {
          global.showRootFolderList({ force: true });
        } else if (typeof global.applyFilterAndRender === 'function') {
          global.applyFilterAndRender();
        }
        showDeviceLibraryComics(libraryId, 'Local Files');
      };
    };
    
    input.click();
  }

  /**
   * Show comics for a specific local library
   */
  async function showDeviceLibraryComics(libraryId, libraryName) {
    const comics = await getDeviceComics(libraryId);
    
    // Use the existing UI components to show these comics
    // We might need to adapt the rendering to handle local comics
    console.log(`Showing ${comics.length} comics for ${libraryName}`);
    
    // For now, let's trigger a custom view or adapt showComicList
    if (global.showComicList) {
      // Mock a publisher/series structure for the renderer if needed,
      // or implement a specific renderer for local comics.
      // Easiest is to adapt showComicList to accept an array of comics directly.
      renderLocalComicList(libraryName, comics);
    }
  }

  function renderLocalComicList(title, comics) {
    const container = document.getElementById('comic-list-container');
    const titleElem = document.getElementById('comic-list-title');
    if (!container || !titleElem) return;

    titleElem.textContent = title;
    container.innerHTML = '';
    
    global.showView(document.getElementById('comic-list'));

    comics.forEach(comic => {
      const card = document.createElement('div');
      card.className = 'comic-card bg-gray-800 rounded-lg overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer group border border-gray-700 hover:border-purple-500';
      
      // Use a placeholder or extract first page as thumbnail (complex)
      card.innerHTML = `
        <div class="aspect-[2/3] bg-gray-700 flex items-center justify-center relative overflow-hidden">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
            <div class="text-white text-xs font-bold truncate">${global.escapeHtml(comic.name)}</div>
          </div>
        </div>
      `;

      card.onclick = () => {
        global.openComicViewer(comic);
      };

      container.appendChild(card);
    });
  }

  global.DeviceLibrary = {
    requestDeviceLibrary,
    scanDeviceLibrary,
    getDeviceLibraries,
    getDeviceComics,
    removeDeviceLibrary,
    appendDeviceLibraryCards
  };
  Object.assign(global, global.DeviceLibrary);

})(typeof window !== 'undefined' ? window : globalThis);
