(function (global) {
  'use strict';

  const SmartLists = global.LibrarySmartLists || {};

  function renderAllComicsAsList() {
    if (!library || !smartListContainer) return;
    
    const allComics = [];
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

    showView(smartListView);
    if (typeof mountSmartFilterHostInto === 'function') {
      mountSmartFilterHostInto(smartListView);
    }
    
    if (smartListTitle) {
      if (currentSeries) smartListTitle.textContent = currentSeries;
      else if (currentPublisher) smartListTitle.textContent = currentPublisher;
      else if (currentRootFolder) {
        const label = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[currentRootFolder] || window.LIBRARY_NAMES[currentRootFolder.replace(/[\\\/]+$/, '')])) || currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentRootFolder;
        smartListTitle.textContent = label;
      } else smartListTitle.textContent = 'All Comics';
    }

    const scope = global.activeSmartFilter || null;
    const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);
    
    let comicsToRender = scope ? allComics.filter(matchesScope) : allComics;
    
    if (activeFilter === 'in-progress') {
      comicsToRender = comicsToRender.filter(comic => getComicStatus(comic) === 'in-progress');
    } else if (activeFilter === 'read') {
      comicsToRender = comicsToRender.filter(comic => getComicStatus(comic) === 'read');
    } else if (activeFilter === 'unread') {
      comicsToRender = comicsToRender.filter(comic => getComicStatus(comic) === 'unread');
    }

    if (comicsToRender.length === 0) {
      smartListContainer.innerHTML = createEmptyMessage('No comics found matching your filters.');
      return;
    }

    if (typeof renderComicCards === 'function') {
      renderComicCards(comicsToRender, 'smart-list');
    }
  }

  function applyFilterAndRender() {
    if (typeof updateFilterButtonCounts === 'function') {
      updateFilterButtonCounts();
    }

    if (currentView === 'comic' || global.currentView === 'comic') {
      return;
    }

    const mode = global.smartListViewMode || 'folders';
    const SMART_LIST_VIEWS = ['latest', 'downloaded', 'guided', 'manga', 'non-manga'];

    // If in list mode and not currently in a specific flat view or search,
    // render the current context as a flat list.
    if (mode === 'list' && !SMART_LIST_VIEWS.includes(currentView) && currentView !== 'search' && currentView !== 'folder') {
      return renderAllComicsAsList();
    }

    switch (currentView) {
      case 'publishers':
        showPublisherList(currentRootFolder, { force: true });
        break;
      case 'series':
        showSeriesList(currentPublisher, { force: true });
        break;
      case 'comics':
        showComicList(currentSeries);
        break;
      case 'folder':
        if (typeof global.showFolderView === 'function') {
          global.showFolderView(global.currentFolderPath, { force: true });
        } else {
          showRootFolderList({ force: true });
        }
        break;
      case 'latest':
        renderLatestSmartList();
        break;
      case 'downloaded':
        renderDownloadedSmartList();
        break;
      case 'guided':
        renderGuidedSmartList();
        break;
      case 'manga':
        renderMangaSmartList();
        break;
      case 'search':
        rerenderSearchResults();
        break;
      default:
        showRootFolderList({ force: true });
    }
  }

  function renderAlphaFilter(targetDiv, data, renderFn, type) {
    targetDiv.innerHTML = '';
    const characters = ['All', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
    characters.forEach(char => {
      const button = document.createElement('button');
      button.className = 'alpha-filter-btn';
      if (char === activeAlphaFilter) {
        button.classList.add('active');
        if (char === 'All') button.style.width = '2.5rem';
      }
      button.textContent = char;
      button.addEventListener('click', (e) => {
        activeAlphaFilter = char;
        targetDiv.querySelectorAll('.alpha-filter-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');

        if (char === 'All') {
          renderFn(data);
          return;
        }

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

    // If a filter is already active (other than 'All'), apply it immediately
    if (activeAlphaFilter !== 'All') {
      if (type === 'comics') {
        const filteredData = data.filter(item => {
          const info = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic(item) : item;
          const label = info.displayTitle || item.name || '';
          const firstChar = label.charAt(0).toUpperCase();
          return (activeAlphaFilter === '#' && !isNaN(parseInt(firstChar))) || (activeAlphaFilter === firstChar);
        });
        renderFn(filteredData);
      } else {
        const filteredData = {};
        for (const key in data) {
          const firstChar = key.charAt(0).toUpperCase();
          if ((activeAlphaFilter === '#' && !isNaN(parseInt(firstChar))) || (activeAlphaFilter === firstChar)) {
            filteredData[key] = data[key];
          }
        }
        renderFn(filteredData);
      }
    } else {
      renderFn(data);
    }
  }

  const LibraryAlphaList = {
    renderAllComicsAsList,
    applyFilterAndRender,
    renderAlphaFilter
  };

  global.LibraryAlphaList = LibraryAlphaList;
  Object.assign(global, LibraryAlphaList);
})(typeof window !== 'undefined' ? window : globalThis);
