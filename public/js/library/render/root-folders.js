import {
  state,
  actions,
  clearElement,
  render,
  html,
  raw,
  ICONS,
  showView,
  createEmptyMessage,
  getRelativePath,
  rootFolderListDiv,
  rootFolderListContainer
} from '../../globals.js';

import {
  getRootStatusCounts,
  statusCountsMatchFilter,
  updateFilterButtonCounts
} from '../status.js';

import { updateBreadcrumb, makeCountChips } from '../breadcrumb.js';
import { DeviceLibrary } from '../device-library.js';
import { showFolderView } from '../folder-viewer.js';
import { renderAlphaFilter, applyFilterAndRender } from '../alpha-list.js';
import { syncSmartFilterButtons, mountSmartFilterHostInto, hideSmartFilterHost } from '../smart-filters.js';
import { showPublisherList } from './publishers.js';

const actionsRef = (typeof actions !== 'undefined' && actions?.navigation) ? actions : (typeof globalThis !== 'undefined' ? globalThis.__COMICS_STORE__?.actions : null);
const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };
const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
    el.innerHTML = content.toHTML();
  } else if (content && typeof content === 'object' && content.__isRawHtml) {
    el.innerHTML = content.html;
  } else {
    el.innerHTML = String(content ?? '');
  }
};

const safeHtml = (typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__isRawHtml) out += v.html;
      else if (v && typeof v === 'object' && typeof v.toHTML === 'function') out += v.toHTML();
      else out += String(v ?? '');
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

const safeRaw = (typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({
  __isRawHtml: true,
  html: String(v ?? '')
});

const API_BASE_URL = state.API_BASE_URL || (typeof window !== 'undefined' && window.API_BASE_URL) || '';

export function showRootFolderList(options = {}) {
  const force = Boolean(options.force);
  
  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing) {
     if (getRelativePath() !== '/') {
       state.router.navigate('/', true);
       return;
     }
  }

  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('root', { folder: null, publisher: null, series: null });
  } else {
    state.currentView = 'root';
    state.currentRootFolder = null;
    state.currentPublisher = null;
    state.currentSeries = null;
  }
  if (typeof window !== 'undefined') {
    window.currentView = state.currentView;
    window.currentRootFolder = state.currentRootFolder;
    window.currentPublisher = state.currentPublisher;
    window.currentSeries = state.currentSeries;
  }
  syncSmartFilterButtons();
  updateBreadcrumb([]);

  const rootFoldersFromLibrary = state.library ? Object.keys(state.library) : [];
  const rootFolders = [];
  const seen = new Set();

  const addRootFolder = (folderPath) => {
    if (!folderPath) return;
    const normalized = folderPath.replace(/[\\\/]+$/, '');
    if (seen.has(normalized)) return;
    seen.add(normalized);
    rootFolders.push(folderPath);
  };

  if (Array.isArray(state.configuredRootFolders) && state.configuredRootFolders.length > 0) {
    state.configuredRootFolders.forEach(addRootFolder);
  }
  rootFoldersFromLibrary.forEach(addRootFolder);

  const rootCards = rootFolders.map(folderPath => {
    const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
    const folderName = (typeof window !== 'undefined' && window.LIBRARY_NAMES && window.LIBRARY_NAMES[normalizedPath]) || normalizedPath.split(/[\\\/]/).pop() || normalizedPath;
    
    const rootData = state.library?.[folderPath] || state.library?.[normalizedPath] || state.library?.[normalizedPath + '/'];
    
    const publisherCount = rootData?.publishers ? Object.keys(rootData.publishers).length : 0;
    const publisherLabel = publisherCount === 1 ? 'Publisher' : 'Publishers';
    const counts = getRootStatusCounts(rootData);
    return { folderPath, folderName, publisherCount, publisherLabel, counts };
  });

  const visibleRootCards = rootCards.filter(card => statusCountsMatchFilter(card.counts));

  if (visibleRootCards.length === 1 && !force) {
    const cardData = visibleRootCards[0];
    const normalizedPath = cardData.folderPath.replace(/[\\\/]+$/, '');
    const actualKey = state.library?.[cardData.folderPath] ? cardData.folderPath : (state.library?.[normalizedPath] ? normalizedPath : (state.library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
    const rootData = actualKey ? state.library[actualKey] : null;
    const mode = rootData?.hierarchyMode || 'metadata';
    
    state.currentRootFolder = actualKey;
    if (typeof window !== 'undefined') window.currentRootFolder = state.currentRootFolder;
    
    if (mode === 'folder') {
      showFolderView(cardData.folderPath);
    } else {
      showPublisherList(cardData.folderPath);
    }
    return;
  }

  showView(rootFolderListDiv);
  if (state.activeSmartFilter) {
    mountSmartFilterHostInto(rootFolderListDiv);
  } else {
    hideSmartFilterHost();
  }

  if (!rootFolderListContainer) return;

  clear(rootFolderListContainer);

  if (visibleRootCards.length === 0) {
    const message = state.activeFilter === 'in-progress'
      ? 'No comics in progress.'
      : state.activeFilter === 'read'
        ? 'No comics read.'
        : state.activeFilter === 'unread'
          ? 'No unread comics.'
          : 'No comics found.';
    renderContent(rootFolderListContainer, createEmptyMessage(message));
    return;
  }

  visibleRootCards.forEach(({ folderPath, folderName, publisherCount, publisherLabel, counts }) => {
    const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
    const rootData = state.library?.[folderPath] || state.library?.[normalizedPath] || state.library?.[normalizedPath + '/'];

    let allComics = [];
    if (rootData && rootData.publishers) {
      for (const publisherName in rootData.publishers) {
        const publisherData = rootData.publishers[publisherName];
        if (publisherData && publisherData.series) {
          for (const seriesName in publisherData.series) {
            const comics = publisherData.series[seriesName];
            if (Array.isArray(comics)) {
              allComics = allComics.concat(comics);
            }
          }
        }
      }
    }

    let allComicsAreManga = false;
    if (allComics.length > 0) {
      allComicsAreManga = allComics.every(comic => comic.mangaMode === true);
    }
    const mangaBannerHtml = allComicsAreManga ? `<div class="status-banner status-manga">Manga</div>` : '';

    let isLibraryDownloaded = false;
    if (allComics.length > 0) {
      isLibraryDownloaded = allComics.every(comic => state.downloadedComicIds?.has?.(comic.id));
    }

    const downloadIcon = isLibraryDownloaded
      ? ICONS.READ
      : ICONS.DOWNLOAD;

    const isLocalRoot = folderPath && String(folderPath).startsWith('device-');
    const downloadButtonHtml = isLocalRoot ? '' : `<button class="download-btn absolute top-2 right-2 z-20 ${isLibraryDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'} bg-gray-900/60 backdrop-blur-xs p-1.5 rounded-lg shadow-lg"
          title="${isLibraryDownloaded ? 'Delete from device' : 'Download library'}"
          data-folder-path="${folderPath}"
          data-is-downloaded="${isLibraryDownloaded}"
        >${downloadIcon}</button>`;

    const card = document.createElement('div');
    card.className = 'folder-card bg-gray-800 rounded-lg shadow-lg overflow-hidden cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    card.setAttribute('data-library-path', folderPath);
    const countsHtml = makeCountChips(counts);

    const today = new Date();
    const dateKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const libraryImageSeed = `${folderPath}|${dateKey}`;
    let libraryImageHash = 0;
    for (let i = 0; i < libraryImageSeed.length; i++) {
      libraryImageHash = ((libraryImageHash << 5) - libraryImageHash) + libraryImageSeed.charCodeAt(i);
      libraryImageHash |= 0;
    }
    const libraryImageIndex = Math.abs(libraryImageHash) % 11;
    const libraryImageName = libraryImageIndex === 0 ? 'Library.jpg' : `Library${libraryImageIndex}.jpg`;
    const libraryImageUrl = `${API_BASE_URL}/logos/${libraryImageName}`;

    renderContent(card, safeHtml`
      <div class="relative">
        ${safeRaw(mangaBannerHtml)}
        ${safeRaw(downloadButtonHtml)}
        <div class="h-48 w-full bg-gray-700 rounded-lg overflow-hidden">
          <img src="${libraryImageUrl}" alt="${folderName}" class="w-full h-full object-cover" loading="lazy">
        </div>
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${folderName}</h3>
      <p class="mt-1 text-xs text-gray-400 text-center">${publisherCount} ${publisherLabel}</p>
      ${safeRaw(countsHtml)}
    `);
    
    card.addEventListener('click', () => {
      const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
      const actualKey = state.library?.[folderPath] ? folderPath : (state.library?.[normalizedPath] ? normalizedPath : (state.library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
      const rootData = actualKey ? state.library[actualKey] : null;
      const mode = rootData?.hierarchyMode || 'metadata';

      if (mode === 'folder') {
        showFolderView(folderPath);
      } else {
        showPublisherList(folderPath);
      }
    });

    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDownloaded = downloadBtn.dataset.isDownloaded === 'true';

        if (isDownloaded) {
          if (confirm(`Delete these ${allComics.length} downloaded comics from your device?`)) {
            downloadBtn.disabled = true;
            for (const comic of allComics) {
              if (typeof window !== 'undefined' && typeof window.deleteOfflineComic === 'function') {
                await window.deleteOfflineComic(comic.id);
              }
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else if (typeof window !== 'undefined' && typeof window.downloadSeries === 'function') {
          window.downloadSeries(allComics, downloadBtn);
        }
      });
    }

    let longPressTimer = null;
    let contextMenuShown = false;
    const libraryContextData = {
      folderPath,
      rootData
    };

    card.addEventListener('contextmenu', (e) => {
      if (typeof window !== 'undefined' && typeof window.showLibraryContextMenu === 'function') {
        window.showLibraryContextMenu(e, libraryContextData);
      }
    });

    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof window !== 'undefined' && typeof window.showLibraryContextMenu === 'function') {
          contextMenuShown = true;
          window.showLibraryContextMenu(e, libraryContextData);
        }
      }, 500);
    });

    card.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
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

    rootFolderListContainer.appendChild(card);
  });

  if (DeviceLibrary) {
    const addCard = document.createElement('div');
    addCard.className = 'add-device-library-card bg-gray-800/50 rounded-lg overflow-hidden border-2 border-dashed border-gray-700 hover:border-purple-500 transition-all duration-300 cursor-pointer group flex flex-col items-center justify-center p-6 text-center h-full min-h-[200px]';
    renderContent(addCard, safeHtml`
      <div class="bg-gray-700/50 p-4 rounded-full mb-3 group-hover:bg-purple-900/30 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-gray-500 group-hover:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </div>
      <div class="text-gray-400 font-bold group-hover:text-white">Add Device Library</div>
      <div class="text-xs text-gray-500 mt-1">Local CBZ/CBR folder</div>
    `);
    addCard.onclick = () => DeviceLibrary.requestDeviceLibrary();
    rootFolderListContainer.appendChild(addCard);

    DeviceLibrary.appendDeviceLibraryCards(rootFolderListContainer);
  }
}
