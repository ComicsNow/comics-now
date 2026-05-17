(function (global) {
  'use strict';

  const SmartLists = global.LibrarySmartLists || {};

  function setLatestButtonActive(isActive) {
    if (!latestAddedButton) return;
    latestAddedButton.classList.toggle('bg-purple-600', Boolean(isActive));
    latestAddedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
    latestAddedButton.classList.toggle('bg-gray-700', !isActive);
    latestAddedButton.classList.toggle('hover:bg-gray-600', !isActive);
    latestAddedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
  }

  function setDownloadedButtonActive(isActive) {
    if (!downloadedButton) return;
    downloadedButton.classList.toggle('bg-purple-600', Boolean(isActive));
    downloadedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
    downloadedButton.classList.toggle('bg-gray-700', !isActive);
    downloadedButton.classList.toggle('hover:bg-gray-600', !isActive);
    downloadedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
  }

  function setGuidedButtonActive(isActive) {
    const btn = document.getElementById('guided-smart-list-btn');
    if (!btn) return;
    btn.classList.toggle('bg-purple-600', Boolean(isActive));
    btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
    btn.classList.toggle('bg-gray-700', !isActive);
    btn.classList.toggle('hover:bg-gray-600', !isActive);
    btn.setAttribute('aria-pressed', String(Boolean(isActive)));
  }

  function setMangaFilterButtonActive(isActive) {
    const btn = document.getElementById('dynamic-manga-filter-btn');
    if (!btn) return;
    btn.classList.toggle('bg-purple-600', Boolean(isActive));
    btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
    btn.classList.toggle('bg-gray-700', !isActive);
    btn.classList.toggle('hover:bg-gray-600', !isActive);
    btn.setAttribute('aria-pressed', String(Boolean(isActive)));
  }

  function clearSmartFilterButtons() {
    setLatestButtonActive(false);
    setDownloadedButtonActive(false);
    setGuidedButtonActive(false);
    setMangaFilterButtonActive(false);
  }

  // Activate whichever pill matches the active smart-filter scope, deactivate the others.
  // Use this on navigation (drill in/out) so the active scope pill stays purple while browsing.
  // Also shows/hides the list/folder render-mode toggle (only meaningful when a scope is active).
  function syncSmartFilterButtons() {
    const scope = global.activeSmartFilter || null;
    setLatestButtonActive(scope === 'latest');
    setDownloadedButtonActive(scope === 'downloaded');
    setGuidedButtonActive(scope === 'guided');
    setMangaFilterButtonActive(scope === 'manga' || scope === 'non-manga');
    const modeToggle = document.getElementById('smart-scope-mode-toggle');
    if (modeToggle) {
      const isFilterActive = typeof activeFilter !== 'undefined' && activeFilter !== 'all';
      modeToggle.classList.toggle('hidden', !scope && !isFilterActive);
    }
  }

  // Move the persistent #smart-filter-host into the active view's `.smart-filter-mount` slot
  // so the smart pill row always renders directly beneath that view's title.
  function mountSmartFilterHostInto(viewElement) {
    const host = document.getElementById('smart-filter-host');
    if (!host || !viewElement) return;
    const slot = viewElement.querySelector('.smart-filter-mount');
    if (!slot) return;
    if (host.parentElement !== slot) {
      slot.appendChild(host);
    }
    host.classList.remove('hidden');
  }

  // Hide the smart-filter pill row entirely. Used at the root (Libraries) view
  // where smart filters don't make sense yet — the user picks a library first.
  function hideSmartFilterHost() {
    const host = document.getElementById('smart-filter-host');
    if (host) host.classList.add('hidden');
  }

  // Return the set of comic IDs that fall under the current drill-in level
  // (currentRootFolder / currentPublisher / currentSeries). Returns null when no
  // drill-in is active, signalling "use the whole library".
  function collectDrillInComicIds() {
    if (!library || typeof library !== 'object') return null;
    if (!currentRootFolder && !currentPublisher && !currentSeries) return null;

    const ids = new Set();
    const addAll = (comics) => { if (Array.isArray(comics)) comics.forEach(c => c && c.id != null && ids.add(c.id)); };

    if (currentRootFolder && currentPublisher && currentSeries) {
      addAll(library[currentRootFolder]?.publishers?.[currentPublisher]?.series?.[currentSeries]);
    } else if (currentRootFolder && currentPublisher) {
      const seriesEntries = library[currentRootFolder]?.publishers?.[currentPublisher]?.series || {};
      Object.values(seriesEntries).forEach(addAll);
    } else if (currentRootFolder) {
      const publishers = library[currentRootFolder]?.publishers || {};
      Object.values(publishers).forEach(p => Object.values(p?.series || {}).forEach(addAll));
    }
    return ids;
  }

  // Filter a smart-list comic array to only those under the current drill-in level.
  // When at library root, returns the array unchanged.
  function scopeListByDrillIn(comics) {
    const ids = collectDrillInComicIds();
    if (!ids) return comics || [];
    return (comics || []).filter(c => c && ids.has(c.id));
  }

  // Build the breadcrumb path for the current drill-in (Libraries > Library > Publisher > Series),
  // then append the given smart-list label.
  function buildSmartListBreadcrumb(smartLabel) {
    const crumbs = [{ label: 'Libraries', action: () => showRootFolderList({ force: true }) }];
    if (currentRootFolder) {
      const libLabel = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[currentRootFolder] || window.LIBRARY_NAMES[currentRootFolder.replace(/[\\\/]+$/, '')])) || currentRootFolder.split(/[\\\/]/).pop() || currentRootFolder;
      crumbs.push({ label: libLabel, action: () => showPublisherList(currentRootFolder, { force: true }) });
    }
    if (currentPublisher) {
      crumbs.push({ label: currentPublisher, action: () => showSeriesList(currentPublisher, { force: true }) });
    }
    if (currentSeries) {
      crumbs.push({ label: currentSeries, action: () => showComicList(currentSeries) });
    }
    crumbs.push({ label: smartLabel });
    return crumbs;
  }

  function showLatestAddedSmartList() {
    currentView = 'latest';
    if (typeof window !== 'undefined') window.currentView = currentView;
    if (typeof updateBreadcrumb === 'function') {
      updateBreadcrumb(buildSmartListBreadcrumb('New'));
    }
    SmartLists.rebuildLatestComics();
    renderLatestSmartList();
  }

  async function showDownloadedSmartList() {
    currentView = 'downloaded';
    if (typeof window !== 'undefined') window.currentView = currentView;

    clearSmartFilterButtons();
    setDownloadedButtonActive(true);
    if (typeof updateBreadcrumb === 'function') {
      updateBreadcrumb(buildSmartListBreadcrumb('Down'));
    }

    if (typeof showView === 'function') {
      showView(smartListView);
    }
    mountSmartFilterHostInto(smartListView);

    if (smartListTitle) {
      smartListTitle.textContent = 'Down';
    }

    if (smartListContainer) {
      smartListContainer.innerHTML = createLoadingMessage('Loading downloaded comics...');
    }

    await SmartLists.rebuildDownloadedComics({ skipRender: true });
    renderDownloadedSmartList();
  }

  function renderLatestSmartList() {
    if (!smartListContainer) return;

    const latestComics = scopeListByDrillIn(SmartLists.getLatestComics() || []);

    clearSmartFilterButtons();
    setLatestButtonActive(true);
    if (typeof showView === 'function') {
      showView(smartListView);
    }
    mountSmartFilterHostInto(smartListView);

    if (smartListTitle) {
      smartListTitle.textContent = 'New';
    }

    if (!Array.isArray(latestComics) || latestComics.length === 0) {
      smartListContainer.innerHTML = createEmptyMessage(`No comics added in the last ${SmartLists.LATEST_ADDED_DAYS} days.`);
      return;
    }

    let comicsToRender = latestComics;
    if (activeFilter === 'in-progress') {
      comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'in-progress');
    } else if (activeFilter === 'read') {
      comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'read');
    } else if (activeFilter === 'unread') {
      comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'unread');
    }

    if (comicsToRender.length === 0) {
      let message = `No comics added in the last ${SmartLists.LATEST_ADDED_DAYS} days.`;
      if (activeFilter === 'in-progress') {
        message = `No comics in progress from the last ${SmartLists.LATEST_ADDED_DAYS} days.`;
      } else if (activeFilter === 'read') {
        message = `No comics read from the last ${SmartLists.LATEST_ADDED_DAYS} days.`;
      } else if (activeFilter === 'unread') {
        message = `No unread comics from the last ${SmartLists.LATEST_ADDED_DAYS} days.`;
      }
      smartListContainer.innerHTML = createEmptyMessage(message);
      return;
    }

    if (typeof renderComicCards === 'function') {
      renderComicCards(comicsToRender, 'smart-list');
    }
  }

  function renderDownloadedSmartList() {
    if (!smartListContainer) return;

    const downloadedSmartListError = SmartLists.getDownloadedSmartListError();
    const downloadedSmartListComics = scopeListByDrillIn(SmartLists.getDownloadedSmartListComics() || []);

    clearSmartFilterButtons();
    setDownloadedButtonActive(true);
    if (typeof showView === 'function') {
      showView(smartListView);
    }
    mountSmartFilterHostInto(smartListView);

    if (smartListTitle) {
      smartListTitle.textContent = 'Down';
    }

    if (downloadedSmartListError) {
      smartListContainer.innerHTML = createErrorMessage('Failed to load downloaded comics.');
      return;
    }

    if (!Array.isArray(downloadedSmartListComics) || downloadedSmartListComics.length === 0) {
      smartListContainer.innerHTML = createEmptyMessage('No comics downloaded for offline use.');
      return;
    }

    let comicsToRender = downloadedSmartListComics;
    if (activeFilter === 'in-progress') {
      comicsToRender = downloadedSmartListComics.filter(comic => getComicStatus(comic) === 'in-progress');
    } else if (activeFilter === 'read') {
      comicsToRender = downloadedSmartListComics.filter(comic => getComicStatus(comic) === 'read');
    } else if (activeFilter === 'unread') {
      comicsToRender = downloadedSmartListComics.filter(comic => getComicStatus(comic) === 'unread');
    }

    if (comicsToRender.length === 0) {
      let message = 'No comics downloaded for offline use.';
      if (activeFilter === 'in-progress') {
        message = 'No downloaded comics in progress.';
      } else if (activeFilter === 'read') {
        message = 'No downloaded comics marked as read.';
      } else if (activeFilter === 'unread') {
        message = 'No unread downloaded comics.';
      }
      smartListContainer.innerHTML = createEmptyMessage(message);
      return;
    }

    if (typeof renderComicCards === 'function') {
      renderComicCards(comicsToRender, 'smart-list');
    }
  }

  function showGuidedSmartList() {
    currentView = 'guided';
    if (typeof window !== 'undefined') window.currentView = currentView;
    if (typeof updateBreadcrumb === 'function') {
      updateBreadcrumb(buildSmartListBreadcrumb('Guide'));
    }
    SmartLists.rebuildGuidedComics();
    renderGuidedSmartList();
  }

  function renderGuidedSmartList() {
    if (!smartListContainer) return;

    const guidedComics = scopeListByDrillIn(SmartLists.getGuidedComics() || []);

    clearSmartFilterButtons();
    setGuidedButtonActive(true);
    if (typeof showView === 'function') {
      showView(smartListView);
    }
    mountSmartFilterHostInto(smartListView);

    if (smartListTitle) {
      smartListTitle.textContent = 'Guide';
    }

    if (!Array.isArray(guidedComics) || guidedComics.length === 0) {
      smartListContainer.innerHTML = createEmptyMessage('No comics with completed guided reading.');
      return;
    }

    let comicsToRender = guidedComics;
    if (activeFilter === 'in-progress') {
      comicsToRender = guidedComics.filter(comic => getComicStatus(comic) === 'in-progress');
    } else if (activeFilter === 'read') {
      comicsToRender = guidedComics.filter(comic => getComicStatus(comic) === 'read');
    } else if (activeFilter === 'unread') {
      comicsToRender = guidedComics.filter(comic => getComicStatus(comic) === 'unread');
    }

    if (comicsToRender.length === 0) {
      let message = 'No comics with completed guided reading.';
      if (activeFilter === 'in-progress') {
        message = 'No guided comics in progress.';
      } else if (activeFilter === 'read') {
        message = 'No guided comics marked as read.';
      } else if (activeFilter === 'unread') {
        message = 'No unread guided comics.';
      }
      smartListContainer.innerHTML = createEmptyMessage(message);
      return;
    }

    if (typeof renderComicCards === 'function') {
      renderComicCards(comicsToRender, 'smart-list');
    }
  }

  function showMangaSmartList() {
    currentView = 'manga';
    if (typeof window !== 'undefined') window.currentView = currentView;
    const isMangaDefault = !!(global.mangaModePreference === true || global.mangaModePreference == 1);
    const label = isMangaDefault ? 'Non-Manga' : 'Manga';
    if (typeof updateBreadcrumb === 'function') {
      updateBreadcrumb(buildSmartListBreadcrumb(label));
    }
    SmartLists.rebuildMangaSmartLists();
    renderMangaSmartList();
  }

  function renderMangaSmartList() {
    if (!smartListContainer) return;

    const isMangaDefault = !!(global.mangaModePreference === true || global.mangaModePreference == 1);
    const label = isMangaDefault ? 'Non-Manga' : 'Manga';
    const comics = scopeListByDrillIn((isMangaDefault ? SmartLists.getNonMangaComics() : SmartLists.getMangaComics()) || []);

    clearSmartFilterButtons();
    setMangaFilterButtonActive(true);
    if (typeof showView === 'function') {
      showView(smartListView);
    }
    mountSmartFilterHostInto(smartListView);

    if (smartListTitle) {
      smartListTitle.textContent = label;
    }

    if (!Array.isArray(comics) || comics.length === 0) {
      smartListContainer.innerHTML = createEmptyMessage(
        isMangaDefault ? 'No non-manga comics in your library.' : 'No manga comics in your library.'
      );
      return;
    }

    let comicsToRender = comics;
    if (activeFilter === 'in-progress') {
      comicsToRender = comics.filter(comic => getComicStatus(comic) === 'in-progress');
    } else if (activeFilter === 'read') {
      comicsToRender = comics.filter(comic => getComicStatus(comic) === 'read');
    } else if (activeFilter === 'unread') {
      comicsToRender = comics.filter(comic => getComicStatus(comic) === 'unread');
    }

    if (comicsToRender.length === 0) {
      const base = isMangaDefault ? 'non-manga' : 'manga';
      let message = `No ${base} comics in your library.`;
      if (activeFilter === 'in-progress') {
        message = `No ${base} comics in progress.`;
      } else if (activeFilter === 'read') {
        message = `No ${base} comics marked as read.`;
      } else if (activeFilter === 'unread') {
        message = `No unread ${base} comics.`;
      }
      smartListContainer.innerHTML = createEmptyMessage(message);
      return;
    }

    if (typeof renderComicCards === 'function') {
      renderComicCards(comicsToRender, 'smart-list');
    }
  }

  const LibrarySmartFilters = {
    setLatestButtonActive,
    setDownloadedButtonActive,
    setGuidedButtonActive,
    setMangaFilterButtonActive,
    clearSmartFilterButtons,
    syncSmartFilterButtons,
    mountSmartFilterHostInto,
    hideSmartFilterHost,
    collectDrillInComicIds,
    scopeListByDrillIn,
    buildSmartListBreadcrumb,
    showLatestAddedSmartList,
    showDownloadedSmartList,
    renderLatestSmartList,
    renderDownloadedSmartList,
    showGuidedSmartList,
    renderGuidedSmartList,
    showMangaSmartList,
    renderMangaSmartList
  };

  global.LibrarySmartFilters = LibrarySmartFilters;
  Object.assign(global, LibrarySmartFilters);
})(typeof window !== 'undefined' ? window : globalThis);
