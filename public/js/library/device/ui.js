import { state, clearElement, render, html, raw } from '../../globals.js';
import { getDeviceLibraries, getDeviceComics, removeDeviceLibrary, scanDeviceLibrary, toPersistentBlob, DEVICE_COMICS_STORE } from './storage.js';
import { updateDeviceScanProgress } from './progress.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => {
  if (el) {
    if (typeof el.replaceChildren === 'function') el.replaceChildren();
    else el.innerHTML = '';
  }
};

const renderContent = typeof render === 'function' ? render : (el, content) => {
  if (!el) return;
  if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
    el.innerHTML = content.toHTML();
  } else if (content && typeof content === 'object' && content.__isRawHtml) {
    el.innerHTML = content.html;
  } else {
    el.innerHTML = String(content ?? '');
  }
};

const safeHtml = typeof html === 'function' ? html : (strings, ...values) => {
  let res = '';
  strings.forEach((str, i) => {
    res += str;
    if (i < values.length) {
      const val = values[i];
      if (val && typeof val === 'object' && val.__isRawHtml) {
        res += val.html;
      } else {
        res += String(val ?? '');
      }
    }
  });
  return { toHTML: () => res, __isRawHtml: true, html: res };
};

const safeRaw = typeof raw === 'function' ? raw : (str) => ({ __isRawHtml: true, html: String(str ?? '') });

/**
 * Render local libraries as cards in the root folder view
 */
export async function appendDeviceLibraryCards(container) {
  const libraries = await getDeviceLibraries();
  if (libraries.length === 0) return;

  for (const lib of libraries) {
    const comics = await getDeviceComics(lib.id);
    const hasSavedBlobs = comics.length > 0 && comics.every(c => Boolean(c.file));
    const card = document.createElement('div');
    card.className = 'device-library-card bg-gray-800 rounded-lg overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer group relative border border-gray-700 hover:border-purple-500';
    card.dataset.libraryId = String(lib.id || '');
    card.dataset.libraryName = String(lib.name || '').toLowerCase();
    
    let statusHtml = '<div class="device-lib-status mt-2 text-xs text-gray-400"></div>';
    let isDisconnected = false;
    const scanState = state.deviceScanStatus?.[lib.id];

    if (scanState && scanState.status === 'scanning') {
      const scanText = scanState.total > 0 ? `Syncing (${scanState.current} / ${scanState.total})...` : 'Scanning folder...';
      statusHtml = `<div class="device-lib-status mt-2 text-xs text-purple-400 font-medium">${scanText}</div>`;
    } else if (hasSavedBlobs) {
      statusHtml = '<div class="device-lib-status mt-2 text-xs text-green-400">Saved on Device</div>';
    } else if (lib.isLegacy) {
      const sampleComic = comics[0];
      isDisconnected = !sampleComic || !sampleComic.file;
      statusHtml = isDisconnected 
        ? '<div class="device-lib-status mt-2 text-xs text-red-400">Disconnected (Click to re-attach)</div>'
        : '<div class="device-lib-status mt-2 text-xs text-green-400">Connected</div>';
    } else if (lib.handle) {
      let permissionStatus = 'prompt';
      try {
        permissionStatus = await lib.handle.queryPermission({ mode: 'read' });
      } catch (e) {
        console.warn('Could not query permission', e);
      }
      if (permissionStatus !== 'granted') {
        statusHtml = '<div class="device-lib-status mt-2 text-xs text-yellow-500">Permission Required</div>';
      }
    }

    renderContent(card, safeHtml`
      <div class="aspect-2/3 bg-gray-700 flex flex-col items-center justify-center p-4 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 ${isDisconnected ? 'text-gray-600' : 'text-gray-500'} mb-2 group-hover:text-purple-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <div class="text-white font-bold truncate w-full">${lib.name}</div>
        <div class="text-gray-400 text-sm mt-1">Local Device Library</div>
        <div class="device-lib-count text-xs text-gray-500 mt-2">${comics.length} Comics</div>
        ${safeRaw(statusHtml)}
      </div>
      <div class="absolute top-2 right-2 z-20">
        <button class="bg-red-600/80 hover:bg-red-600 text-white p-1.5 rounded-full remove-device-lib shadow-lg backdrop-blur-xs transition-all" data-id="${lib.id}" title="Remove Library">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    `);

    card.onclick = async (e) => {
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('.remove-device-lib')) {
        const id = e.target.closest('.remove-device-lib').dataset.id;
        if (confirm('Remove this local library? It won\'t delete your files.')) {
          await removeDeviceLibrary(id);
        }
        return;
      }

      if (!hasSavedBlobs) {
        if (lib.isLegacy) {
          const sampleComic = comics[0];
          if (!sampleComic || !sampleComic.file) {
            await reattachLegacyLibrary(lib.id);
            return;
          }
        } else if (lib.handle) {
          if (await lib.handle.queryPermission({ mode: 'read' }) !== 'granted') {
            if (await lib.handle.requestPermission({ mode: 'read' }) !== 'granted') {
              return;
            }
          }
          await scanDeviceLibrary(lib.id, lib.handle);
          const showRootFolderList = state.showRootFolderList || window.showRootFolderList;
          const applyFilterAndRender = state.applyFilterAndRender || window.applyFilterAndRender;

          if (typeof showRootFolderList === 'function') {
            showRootFolderList({ force: true });
          } else if (typeof applyFilterAndRender === 'function') {
            applyFilterAndRender();
          }
        }
      }

      showDeviceLibraryComics(lib.id, lib.name);
    };

    // Prevent duplicate DOM cards if appendDeviceLibraryCards runs concurrently
    container.querySelectorAll('.device-library-card').forEach(existing => {
      if (existing.dataset.libraryId === card.dataset.libraryId || existing.dataset.libraryName === card.dataset.libraryName) {
        existing.remove();
      }
    });

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
export async function reattachLegacyLibrary(libraryId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.webkitdirectory = true;
  
  input.onchange = async (e) => {
    const files = Array.from(e.target.files).filter(f => 
      f.name.toLowerCase().endsWith('.cbz') || f.name.toLowerCase().endsWith('.cbr')
    );
    
    if (files.length === 0) return;

    const db = state.OfflineDB || window.OfflineDB || {};
    if (!db.openOfflineDB) throw new Error('OfflineDB not initialized');
    const activeDb = await db.openOfflineDB();

    const comics = await getDeviceComics(libraryId);
    const updatedComics = [];

    let reattachedCount = 0;
    for (let i = 0; i < comics.length; i++) {
      const comic = comics[i];
      const matchingFile = files.find(f => (f.webkitRelativePath || f.name) === comic.path);
      if (matchingFile) {
        updateDeviceScanProgress(libraryId, 'Local Files', {
          status: 'scanning',
          current: i + 1,
          total: comics.length,
          fileName: matchingFile.name
        });
        comic.file = await toPersistentBlob(matchingFile);
        updatedComics.push(comic);
        reattachedCount++;
      }
    }

    const tx = activeDb.transaction([DEVICE_COMICS_STORE], 'readwrite');
    const store = tx.objectStore(DEVICE_COMICS_STORE);
    for (const comic of updatedComics) {
      store.put(comic);
    }

    tx.oncomplete = () => {
      updateDeviceScanProgress(libraryId, 'Local Files', {
        status: 'ready',
        current: reattachedCount,
        total: reattachedCount
      });
      console.log(`Re-attached ${reattachedCount} files to library ${libraryId}`);
      const showRootFolderList = state.showRootFolderList || window.showRootFolderList;
      const applyFilterAndRender = state.applyFilterAndRender || window.applyFilterAndRender;

      if (typeof showRootFolderList === 'function') {
        showRootFolderList({ force: true });
      } else if (typeof applyFilterAndRender === 'function') {
        applyFilterAndRender();
      }
      showDeviceLibraryComics(libraryId, 'Local Files');
    };
  };
  
  input.click();
}

/**
 * Show comics for a specific local library
 */
export async function showDeviceLibraryComics(libraryId, libraryName) {
  const comics = await getDeviceComics(libraryId);
  console.log(`Showing ${comics.length} comics for ${libraryName}`);
  
  const showComicList = state.showComicList || window.showComicList;
  if (showComicList) {
    renderLocalComicList(libraryName, comics);
  }
}

export function renderLocalComicList(title, comics) {
  const container = document.getElementById('comic-list-container');
  const titleElem = document.getElementById('comic-list-title');
  if (!container || !titleElem) return;

  titleElem.textContent = title;
  clear(container);
  
  const showView = state.showView || window.showView;
  if (typeof showView === 'function') {
    showView(document.getElementById('comic-list'));
  }

  comics.forEach(comic => {
    const card = document.createElement('div');
    card.className = 'comic-card bg-gray-800 rounded-lg overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer group border border-gray-700 hover:border-purple-500';
    
    renderContent(card, safeHtml`
      <div class="aspect-2/3 bg-gray-700 flex items-center justify-center relative overflow-hidden">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <div class="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent p-2">
          <div class="text-white text-xs font-bold truncate">${comic.name}</div>
        </div>
      </div>
    `);

    card.onclick = () => {
      const openComicViewer = state.openComicViewer || window.openComicViewer;
      if (typeof openComicViewer === 'function') {
        openComicViewer(comic);
      }
    };

    container.appendChild(card);
  });
}
