import { state, smartListContainer, smartListView, smartListTitle } from '../globals.js';

export function renderAllComicsAsList() {
  const library = state.library || window.library;
  if (!library || !smartListContainer) return;
  
  const allComics = [];
  const currentRootFolder = state.currentRootFolder;
  const currentPublisher = state.currentPublisher;
  const currentSeries = state.currentSeries;

  const rootFolders = currentRootFolder ? [currentRootFolder] : Object.keys(library);
  
  rootFolders.forEach(rootPath => {
    const rootData = library[rootPath];
    if (!rootData || !rootData.publishers) return;
    
    const publishers = currentPublisher ? [currentPublisher] : Object.keys(rootData.publishers);
    publishers.forEach(pubName => {
      const pubData = rootData.publishers[pubName];
      if (!pubData || !pubData.series) return;
      
      const seriesNames = currentSeries ? [currentSeries] : Object.keys(pubData.series);
      seriesNames.forEach(seriesName => {
        const comics = pubData.series[seriesName];
        if (Array.isArray(comics)) {
          allComics.push(...comics);
        }
      });
    });
  });

  const showView = state.showView || window.showView;
  if (typeof showView === 'function') {
    showView(smartListView);
  }

  const mountSmartFilterHostInto = state.mountSmartFilterHostInto || window.mountSmartFilterHostInto;
  if (typeof mountSmartFilterHostInto === 'function') {
    mountSmartFilterHostInto(smartListView);
  }
  
  if (smartListTitle) {
    if (currentSeries) {
      smartListTitle.textContent = currentSeries;
    } else if (currentPublisher) {
      smartListTitle.textContent = currentPublisher;
    } else if (currentRootFolder) {
      const libraryNames = state.LIBRARY_NAMES || window.LIBRARY_NAMES || {};
      const label = libraryNames[currentRootFolder] || libraryNames[currentRootFolder.replace(/[\\\/]+$/, '')] || currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentRootFolder;
      smartListTitle.textContent = label;
    } else {
      smartListTitle.textContent = 'All Comics';
    }
  }

  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  const scope = state.activeSmartFilter || null;
  const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);
  
  let comicsToRender = scope ? allComics.filter(matchesScope) : allComics;
  
  const getComicStatus = state.getComicStatus || window.getComicStatus;
  const activeFilter = state.activeFilter;

  if (activeFilter === 'in-progress') {
    comicsToRender = comicsToRender.filter(comic => typeof getComicStatus === 'function' ? getComicStatus(comic) === 'in-progress' : false);
  } else if (activeFilter === 'read') {
    comicsToRender = comicsToRender.filter(comic => typeof getComicStatus === 'function' ? getComicStatus(comic) === 'read' : false);
  } else if (activeFilter === 'unread') {
    comicsToRender = comicsToRender.filter(comic => typeof getComicStatus === 'function' ? getComicStatus(comic) === 'unread' : false);
  }

  if (comicsToRender.length === 0) {
    const createEmptyMessage = state.createEmptyMessage || window.createEmptyMessage;
    smartListContainer.innerHTML = typeof createEmptyMessage === 'function' 
      ? createEmptyMessage('No comics found matching your filters.') 
      : 'No comics found matching your filters.';
    return;
  }

  const renderComicCards = state.renderComicCards || window.renderComicCards;
  if (typeof renderComicCards === 'function') {
    renderComicCards(comicsToRender, 'smart-list');
  }
}

export function applyFilterAndRender() {
  const updateFilterButtonCounts = state.updateFilterButtonCounts || window.updateFilterButtonCounts;
  if (typeof updateFilterButtonCounts === 'function') {
    updateFilterButtonCounts();
  }

  const currentView = state.currentView;
  if (currentView === 'comic') {
    return;
  }

  const mode = state.smartListViewMode || 'folders';
  const SMART_LIST_VIEWS = ['latest', 'downloaded', 'guided', 'manga', 'non-manga'];

  // If in list mode and not currently in a specific flat view or search,
  // render the current context as a flat list.
  if (mode === 'list' && !SMART_LIST_VIEWS.includes(currentView) && currentView !== 'search' && currentView !== 'folder') {
    return renderAllComicsAsList();
  }

  const showPublisherList = state.showPublisherList || window.showPublisherList;
  const showSeriesList = state.showSeriesList || window.showSeriesList;
  const showComicList = state.showComicList || window.showComicList;
  const showFolderView = state.showFolderView || window.showFolderView;
  const showRootFolderList = state.showRootFolderList || window.showRootFolderList;
  const renderLatestSmartList = state.renderLatestSmartList || window.renderLatestSmartList;
  const renderDownloadedSmartList = state.renderDownloadedSmartList || window.renderDownloadedSmartList;
  const renderGuidedSmartList = state.renderGuidedSmartList || window.renderGuidedSmartList;
  const renderMangaSmartList = state.renderMangaSmartList || window.renderMangaSmartList;
  const rerenderSearchResults = state.rerenderSearchResults || window.rerenderSearchResults;

  switch (currentView) {
    case 'publishers':
      if (typeof showPublisherList === 'function') {
        showPublisherList(state.currentRootFolder, { force: true });
      }
      break;
    case 'series':
      if (typeof showSeriesList === 'function') {
        showSeriesList(state.currentPublisher, { force: true });
      }
      break;
    case 'comics':
      if (typeof showComicList === 'function') {
        showComicList(state.currentSeries);
      }
      break;
    case 'folder':
      if (typeof showFolderView === 'function') {
        showFolderView(state.currentFolderPath, { force: true });
      } else if (typeof showRootFolderList === 'function') {
        showRootFolderList({ force: true });
      }
      break;
    case 'latest':
      if (typeof renderLatestSmartList === 'function') {
        renderLatestSmartList();
      }
      break;
    case 'downloaded':
      if (typeof renderDownloadedSmartList === 'function') {
        renderDownloadedSmartList();
      }
      break;
    case 'guided':
      if (typeof renderGuidedSmartList === 'function') {
        renderGuidedSmartList();
      }
      break;
    case 'manga':
      if (typeof renderMangaSmartList === 'function') {
        renderMangaSmartList();
      }
      break;
    case 'search':
      if (typeof rerenderSearchResults === 'function') {
        rerenderSearchResults();
      }
      break;
    default:
      if (typeof showRootFolderList === 'function') {
        showRootFolderList({ force: true });
      }
  }
}

export function renderAlphaFilter(targetDiv, data, renderFn, type) {
  targetDiv.innerHTML = '';
  const characters = ['All', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  characters.forEach(char => {
    const button = document.createElement('button');
    button.className = 'alpha-filter-btn';
    if (char === state.activeAlphaFilter) {
      button.classList.add('active');
      if (char === 'All') button.style.width = '2.5rem';
    }
    button.textContent = char;
    button.addEventListener('click', (e) => {
      state.activeAlphaFilter = char;
      if (typeof window !== 'undefined') {
        window.activeAlphaFilter = char;
      }
      targetDiv.querySelectorAll('.alpha-filter-btn').forEach(btn => btn.classList.remove('active'));
      e.target.classList.add('active');

      if (char === 'All') {
        renderFn(data);
        return;
      }

      const applyDisplayInfoToComic = state.applyDisplayInfoToComic || window.applyDisplayInfoToComic;

      if (type === 'comics') {
        const filteredData = data.filter(item => {
          const info = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic(item) : item;
          const label = info.displayTitle || item.name || '';
          const firstChar = label.charAt(0).toUpperCase();
          return (char === '#' && !isNaN(parseInt(firstChar))) || (char === firstChar);
        });
        renderFn(filteredData);
      } else { // publishers, series
        const filteredData = {};
        for (const key in data) {
          const firstChar = key.charAt(0).toUpperCase();
          if ((char === '#' && !isNaN(parseInt(firstChar))) || (char === firstChar)) {
            filteredData[key] = data[key];
          }
        }
        renderFn(filteredData);
      }
    });
    targetDiv.appendChild(button);
  });

  const applyDisplayInfoToComic = state.applyDisplayInfoToComic || window.applyDisplayInfoToComic;

  // If a filter is already active (other than 'All'), apply it immediately
  if (state.activeAlphaFilter !== 'All') {
    if (type === 'comics') {
      const filteredData = data.filter(item => {
        const info = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic(item) : item;
        const label = info.displayTitle || item.name || '';
        const firstChar = label.charAt(0).toUpperCase();
        return (state.activeAlphaFilter === '#' && !isNaN(parseInt(firstChar))) || (state.activeAlphaFilter === firstChar);
      });
      renderFn(filteredData);
    } else {
      const filteredData = {};
      for (const key in data) {
        const firstChar = key.charAt(0).toUpperCase();
        if ((state.activeAlphaFilter === '#' && !isNaN(parseInt(firstChar))) || (state.activeAlphaFilter === firstChar)) {
          filteredData[key] = data[key];
        }
      }
      renderFn(filteredData);
    }
  } else {
    renderFn(data);
  }
}

export const LibraryAlphaList = {
  renderAllComicsAsList,
  applyFilterAndRender,
  renderAlphaFilter
};

// Expose on state & window for transitional compatibility
state.LibraryAlphaList = LibraryAlphaList;
Object.assign(state, LibraryAlphaList);

if (typeof window !== 'undefined') {
  window.LibraryAlphaList = LibraryAlphaList;
  Object.assign(window, LibraryAlphaList);
}
