// Filter library function simplified - status filters are applied during rendering
function filterLibrary(originalLibrary, filter) {
  return originalLibrary;
}

// filterLibraryWithDownloaded function removed - no longer needed with smart lists removed

function handleFilterClick(event) {
  const button = event.target.closest('.filter-btn');
  if (!button) return;

  const allButtons = document.querySelectorAll('.filter-btn');
  allButtons.forEach(btn => {
    btn.classList.remove('active');
    btn.classList.remove('bg-purple-600');
    btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
  });

  button.classList.add('active');
  button.classList.add('bg-purple-600');
  button.classList.remove('bg-gray-700', 'hover:bg-gray-600');

  const filter = button.dataset.filter || 'all';
  activeFilter = filter;

  const isSmartListView = ['latest', 'converted', 'downloaded'].includes(currentView);

  // If clicking "All" filter, always return to library view
  if (filter === 'all') {
    updateFilterButtonCounts();
    showRootFolderList({ force: true });
    return;
  }

  if (isSmartListView) {
    updateFilterButtonCounts();
    showRootFolderList({ force: true });
    return;
  }

  applyFilterAndRender();
}

function initializeLibraryUIControls() {
  if (filterButtonsDiv && !filterButtonsDiv._filterListener) {
    filterButtonsDiv._filterListener = handleFilterClick;
    filterButtonsDiv.addEventListener('click', filterButtonsDiv._filterListener);
  }

  if (latestAddedButton && !latestAddedButton._smartListListener) {
    latestAddedButton._smartListListener = (event) => {
      event.preventDefault();
      showLatestAddedSmartList();
    };
    latestAddedButton.addEventListener('click', latestAddedButton._smartListListener);
  }


  if (downloadedButton && !downloadedButton._smartListListener) {
    downloadedButton._smartListListener = async (event) => {
      event.preventDefault();
      await showDownloadedSmartList();
    };
    downloadedButton.addEventListener('click', downloadedButton._smartListListener);
  }

  if (smartListBackBtn && !smartListBackBtn._smartListBackListener) {
    smartListBackBtn._smartListBackListener = (event) => {
      event.preventDefault();
      showRootFolderList({ force: true });
    };
    smartListBackBtn.addEventListener('click', smartListBackBtn._smartListBackListener);
  }

  if (librarySearchForm && !librarySearchForm._submitListener) {
    librarySearchForm._submitListener = (event) => {
      event.preventDefault();
      const query = librarySearchQuery?.value?.trim();
      if (!query) return;
      const field = librarySearchField?.value || 'all';
      showSearchView(query, field);
    };
    librarySearchForm.addEventListener('submit', librarySearchForm._submitListener);
  }

  if (clearSearchBtn && !clearSearchBtn._clickListener) {
    clearSearchBtn._clickListener = (event) => {
      event.preventDefault();
      if (librarySearchQuery) {
        librarySearchQuery.value = '';
      }
      showRootFolderList({ force: true });
    };
    clearSearchBtn.addEventListener('click', clearSearchBtn._clickListener);
  }

  debugLog('UI', 'Library controls initialized');
}


