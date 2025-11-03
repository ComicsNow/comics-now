const APP_CONFIG_STORAGE_KEY = 'comics-now-app-config';

function cacheAppConfig(config) {
  if (!config || typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    
  }
}

function loadCachedAppConfig() {
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(APP_CONFIG_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    
    return null;
  }
}

function resolveAppConfig() {
  if (window.APP_CONFIG && typeof window.APP_CONFIG === 'object') {
    cacheAppConfig(window.APP_CONFIG);
    return window.APP_CONFIG;
  }

  const cached = loadCachedAppConfig();
  if (cached) {
    
    window.APP_CONFIG = cached;
    return cached;
  }

  return null;
}

function showOfflineLibraryUnavailableMessage() {
  const offline = navigator.onLine === false;
  const message = offline
    ? 'Offline library unavailable. Connect to the server while online at least once to sync your comics for offline use.'
    : 'Unable to load the comics library. Check that the server is running and reachable.';

  if (typeof showRootFolderList === 'function') {
    showRootFolderList({ force: true });
  }

  if (rootFolderListContainer) {
    rootFolderListContainer.innerHTML = createErrorMessage(message);
  }
}

// --- LIBRARY STATUS TRACKING ---
window.libraryReady = false;
window.libraryLoadedAt = null;

function updateLibraryStatusBadge() {
  const badge = document.getElementById('library-status-badge');
  if (!badge) return;

  if (window.libraryReady) {
    const comicCount = Object.keys(window.library || {}).length;
    badge.textContent = comicCount > 0 ? 'Ready' : 'Empty';
    badge.className = comicCount > 0
      ? 'text-xs px-2 py-1 rounded-full bg-green-600'
      : 'text-xs px-2 py-1 rounded-full bg-gray-600';
  } else {
    badge.textContent = 'Loading...';
    badge.className = 'text-xs px-2 py-1 rounded-full bg-yellow-600';
  }
}

// --- INITIAL LOAD ---
async function initializeApp() {
  try {
    const config = resolveAppConfig() || { baseUrl: '/', comicsDirectories: [] };
    window.APP_CONFIG = config;

    // 1) Work out the base URL the server mounted us at (no trailing slash)
    API_BASE_URL = (config.baseUrl || '').replace(/\/$/, '');
    const rootFoldersFromConfig = config.comicsDirectories;
    configuredRootFolders = Array.isArray(rootFoldersFromConfig)
      ? [...rootFoldersFromConfig]
      : [];

    // 2) Keep <base> tag in sync (with trailing slash)
    const baseEl = document.querySelector('base');
    if (baseEl) baseEl.href = `${API_BASE_URL}/`;

    // 3) Register the service worker for this mount
    if ('serviceWorker' in navigator) {
      if (['localhost', '127.0.0.1'].includes(location.hostname)) {
        navigator.serviceWorker.getRegistrations().then(regs =>
          regs.forEach(reg => reg.unregister())
        );
      } else {
        navigator.serviceWorker
          .register(`${API_BASE_URL}/service-worker.js`, {
            scope: `${API_BASE_URL}/`,
            updateViaCache: 'none'
          })
          .then(registration => {
            registration.update();
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing;
              newWorker.addEventListener('statechange', () => {});
            });
          })
          .catch(() => {});
      }
    }

    // 4) App init - prioritize offline data
    await openOfflineDB();

    // Initialize download queue and resume any pending downloads
    if (typeof initializeDownloadQueue === 'function') {
      try {
        await initializeDownloadQueue();
        console.log('[APP] Download queue initialized');
      } catch (error) {
        console.error('[APP] Failed to initialize download queue:', error);
      }
    }

    // Initialize JWT token capture for Cloudflare Access authentication
    // This enables background downloads to work with authentication enabled
    if (typeof initializeJWTCapture === 'function') {
      try {
        await initializeJWTCapture(30 * 60 * 1000); // Refresh every 30 minutes
        console.log('[APP] JWT capture initialized');
      } catch (error) {
        console.error('[APP] Failed to initialize JWT capture:', error);
      }
    }

    initializeLibraryUIControls();
    initializeViewerUIControls();
    initializeProgressTracking();

    // 5) Load library from cache first, then sync with server
    await loadLibraryOfflineFirst();

  } catch (e) {
    console.error('[APP INIT ERROR]', e);
    console.error('[APP INIT ERROR] Stack:', e.stack);
    document.body.innerHTML =
      `<div class="text-red-400 text-center p-8">
         Could not load app configuration from server. Is it running and accessible?
         <br><br>
         <div class="text-sm text-gray-400">Error: ${e.message}</div>
       </div>`;
  }
}

// New function to load library offline-first
async function loadLibraryOfflineFirst() {
  try {
    const startTime = performance.now();
    let cachedLibrary = null;
    let cacheTimestamp = null;

    try {
      const cacheStartTime = performance.now();
      if (typeof loadLibraryCacheFromDB === 'function') {
        const cachedRecord = await loadLibraryCacheFromDB();
        if (cachedRecord && cachedRecord.data) {
          cachedLibrary = cachedRecord.data;
          cacheTimestamp = cachedRecord.timestamp;
        }
      }
    } catch (error) {
      // Cache load failed silently
    }

    // Clean up legacy localStorage cache to reclaim quota if present
    try {
      localStorage.removeItem('comics-library-cache');
      localStorage.removeItem('comics-library-cache-timestamp');
    } catch (storageError) {
      // Ignore browsers where localStorage is unavailable
    }

    // Load downloaded comic IDs early so indicators show immediately
    if (typeof getAllDownloadedComicIds === 'function') {
      try {
        console.log('[DEBUG] Loading downloaded comic IDs...');
        const ids = await getAllDownloadedComicIds();
        console.log('[DEBUG] Loaded', ids ? ids.size : 0, 'downloaded comic IDs');
      } catch (error) {
        console.error('[DEBUG] Failed to load downloaded comic IDs:', error);
        // Initialize empty set to prevent errors in UI
        if (!global.downloadedComicIds) {
          global.downloadedComicIds = new Set();
        }
      }
    } else {
      console.warn('[DEBUG] getAllDownloadedComicIds function not available');
    }

    if (cachedLibrary) {
      library = cachedLibrary;
      applyDisplayInfoToLibrary(library);

      // Show cached data immediately for better UX
      const librarySize = estimateLibrarySize(library);
      if (librarySize > 0) {
        if (librarySize > 1000) {
          applyFilterAndRender();
          requestAnimationFrame(() => {
            rebuildLatestComics();
            requestAnimationFrame(() => {
              if (typeof updateFilterButtonCounts === 'function') {
                updateFilterButtonCounts();
              }
            });
          });
        } else {
          rebuildLatestComics();
          applyFilterAndRender();
        }

        // Merge offline progress data
        if (typeof mergeOfflineStatusesIntoLibrary === 'function') {
          await mergeOfflineStatusesIntoLibrary();

          // Re-render UI with updated progress data
          applyFilterAndRender();

          // Update library cache so next refresh shows correct progress immediately
          if (typeof saveLibraryCacheToDB === 'function') {
            saveLibraryCacheToDB(library).catch(() => {
              // Failed to update library cache
            });
          }
        }
      }
    }

    const isOffline = navigator.onLine === false;
    let hasLibraryData = Boolean(cachedLibrary);

    if (!cachedLibrary && isOffline) {
      
      showOfflineLibraryUnavailableMessage();
    }

    // If we're online, refresh from the server
    if (!isOffline) {
      console.log('[DEBUG] Online, attempting to fetch library from server');
      const serverFetchStart = performance.now();
      try {
        await fetchLibraryFromServer();
        hasLibraryData = true;
      } catch (error) {
        console.error('[DEBUG] fetchLibraryFromServer error:', error);
        // Network error - if we have cached data, continue using it silently
        if (!hasLibraryData) {
          showOfflineLibraryUnavailableMessage();
        } else {
          // We have cached data, so just log the error and continue
          console.warn('[OFFLINE] Server fetch failed but using cached library data:', error.message);
        }
      }
    } else {
      console.log('[DEBUG] Offline, not fetching from server');
    }

    // Run background operations
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => {
        backgroundSyncOperations();
      }, { timeout: 1000 });
    } else {
      setTimeout(() => {
        backgroundSyncOperations();
      }, 50);
    }

    // Mark library as ready
    window.libraryReady = true;
    window.libraryLoadedAt = Date.now();
    console.log('[LIBRARY] Library loaded successfully. Comics available:', Object.keys(library).length);

    // Update library status badge
    updateLibraryStatusBadge();

  } catch (error) {
    window.libraryReady = false;
    console.error('[LIBRARY] Failed to load library:', error);
    rootFolderListContainer.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full">Error loading library. Check network connection.</div>';
  }
}

// Modified function to fetch from server and cache
async function fetchLibraryFromServer() {
  console.log('[DEBUG] fetchLibraryFromServer called');
  console.log('[DEBUG] window.tryProgressiveLoading exists?', typeof window.tryProgressiveLoading);
  console.log('[DEBUG] window.fetchLibraryFull exists?', typeof window.fetchLibraryFull);

  try {
    // Try lazy loading first, fallback to full loading
    console.log('[DEBUG] About to call tryProgressiveLoading');
    const useProgressiveLoading = await window.tryProgressiveLoading();
    console.log('[DEBUG] tryProgressiveLoading returned:', useProgressiveLoading);

    if (!useProgressiveLoading) {
      // Fallback to original full loading
      await window.fetchLibraryFull();
      return;
    }

    // Cache the library data
    if (typeof saveLibraryCacheToDB === 'function') {
      try {
        await saveLibraryCacheToDB(library);
      } catch (error) {
        console.error('Failed to save library cache to DB:', error);
      }
    }

    // Progressive loading succeeded - update UI
    const librarySize = estimateLibrarySize(library);
    if (librarySize > 1000) {
      // For large libraries, show UI first then rebuild in background
      applyFilterAndRender();
      requestAnimationFrame(() => {
        rebuildLatestComics();
        requestAnimationFrame(() => {
          if (typeof updateFilterButtonCounts === 'function') {
            updateFilterButtonCounts();
          }
        });
      });
    } else {
      // For smaller libraries, rebuild immediately
      rebuildLatestComics();
      applyFilterAndRender();
    }

  } catch (error) {

    throw error;
  }
}

// --- USER BADGE ---
function showUserBadge() {
  // Only show badge when auth is enabled
  if (!window.syncManager || !window.syncManager.authEnabled) {
    return;
  }

  // Check if badge already exists
  if (document.getElementById('user-badge')) {
    return;
  }

  const userEmail = window.syncManager.userEmail || 'Unknown';
  const userRole = window.syncManager.userRole || 'user';

  // Create badge element
  const badge = document.createElement('div');
  badge.id = 'user-badge';
  badge.className = 'z-30 bg-gray-700 text-white text-xs sm:text-sm font-medium shadow-lg';
  badge.style.cssText = 'position: fixed; padding: 0.25rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap; width: fit-content; max-width: 250px;';

  // Position at bottom left of page for both mobile and desktop
  if (window.matchMedia('(min-width: 640px)').matches) {
    // Desktop: Position at bottom left
    badge.style.bottom = '1rem';
    badge.style.left = '2rem';
  } else {
    // Mobile: Position at bottom left
    badge.style.bottom = '1rem';
    badge.style.left = '1rem';
  }

  // Add role indicator color
  const roleColor = userRole === 'admin' ? 'bg-blue-500' : 'bg-green-500';

  badge.innerHTML = `
    <span class="w-2 h-2 rounded-full ${roleColor}" style="flex-shrink: 0;"></span>
    <span>${userEmail}</span>
  `;

  document.body.appendChild(badge);
}

// --- HIDE ADMIN UI FOR NON-ADMINS ---
function hideAdminUI() {
  // Only hide admin UI when auth is enabled AND user is NOT admin
  if (!window.syncManager || !window.syncManager.authEnabled) {
    // Auth disabled - everyone has access
    return;
  }

  if (window.syncManager.userRole === 'admin') {
    // User is admin - show all controls
    return;
  }

  // User is NOT admin - hide admin controls

  // Hide CT (ComicTagger) button (admin only)
  const ctButton = document.getElementById('ct-button');
  if (ctButton) {
    ctButton.style.display = 'none';
  }

  // Hide admin-only tabs in settings modal
  const adminTabs = [
    'settings-tab-general',
    'settings-tab-logs',
    'settings-tab-users',
    'settings-tab-comics-management'
  ];

  adminTabs.forEach(tabId => {
    const tab = document.getElementById(tabId);
    if (tab) {
      tab.style.display = 'none';
    }
  });

  // Hide admin-only tab content
  const adminTabContent = [
    'settings-content-general',
    'settings-content-logs',
    'settings-content-users',
    'settings-content-comics-management'
  ];

  adminTabContent.forEach(contentId => {
    const content = document.getElementById(contentId);
    if (content) {
      content.style.display = 'none';
    }
  });

  // Auto-select Devices or Downloads tab for non-admin users when settings opens
  setTimeout(() => {
    const devicesTab = document.getElementById('settings-tab-devices');
    if (devicesTab && !devicesTab.classList.contains('active')) {
      devicesTab.click();
    }
  }, 100);

  // Note: We don't throw errors if elements don't exist - they might not be loaded yet
  // The UI will gracefully handle missing elements
}

// Expose functions globally for library/data.js
if (typeof window !== 'undefined') {
  window.loadLibraryOfflineFirst = loadLibraryOfflineFirst;
  window.fetchLibraryFromServer = fetchLibraryFromServer;
}

// --- READING LIST MODAL ---

/**
 * Open the reading list modal and refresh its contents
 */
function openReadingListModal() {
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    modal.classList.remove('hidden');
    updateLibraryStatusBadge(); // Update status badge
    refreshReadingListModal();
  }
}

/**
 * Close the reading list modal
 */
function closeReadingListModal() {
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

/**
 * Get comic object by ID from the library
 * @param {string} comicId - The comic ID
 * @returns {object|null} The comic object or null
 */
function getComicById(comicId) {
  if (!window.library || typeof window.library !== 'object') {
    console.error('[Reading List] Library not loaded yet');
    return null;
  }

  const libraryKeys = Object.keys(window.library);
  if (libraryKeys.length === 0) {
    console.error('[Reading List] Library is empty - no comics available');
    return null;
  }

  // Iterate through root folders (object keys)
  for (const rootFolderKey of libraryKeys) {
    const rootFolder = window.library[rootFolderKey];
    const publishers = rootFolder?.publishers || {};

    // Iterate through publishers (object keys)
    for (const publisherName of Object.keys(publishers)) {
      const publisher = publishers[publisherName];
      const seriesEntries = publisher?.series || {};

      // Iterate through series (object keys)
      for (const seriesName of Object.keys(seriesEntries)) {
        const comics = seriesEntries[seriesName];

        // Comics is an array
        if (Array.isArray(comics)) {
          const comic = comics.find(c => c.id === comicId);
          if (comic) return comic;
        }
      }
    }
  }

  console.error(`[Reading List] Comic not found: ${comicId}`);
  return null;
}

// Expose to window scope
window.getComicById = getComicById;

/**
 * Refresh the reading list modal display
 */
async function refreshReadingListModal() {
  const listsContainer = document.getElementById('reading-lists-container');
  if (!listsContainer) return;

  // Show loading state
  listsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Loading...</p>';

  // Fetch lists from API
  if (typeof window.ReadingLists !== 'undefined' && typeof window.ReadingLists.fetchReadingLists === 'function') {
    const lists = await window.ReadingLists.fetchReadingLists();

    if (lists.length === 0) {
      listsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No reading lists yet. Create one to get started!</p>';
    } else {
      listsContainer.innerHTML = '';

      lists.forEach((list) => {
        const listDiv = document.createElement('div');
        listDiv.className = 'bg-gray-700 p-4 rounded-lg relative cursor-pointer hover:bg-gray-600 transition-colors';
        listDiv.dataset.listId = list.id;

        const itemCount = list.totalComics || 0;
        const readCount = list.readComics || 0;
        const createdDate = list.created ? new Date(list.created).toLocaleDateString() : '';
        const progressPercent = list.progressPercent || 0;

        // Determine read status
        const allRead = readCount === itemCount && itemCount > 0;
        const hasProgress = readCount > 0;

        listDiv.innerHTML = `
          <div class="flex justify-between items-start mb-2">
            <div class="flex-1">
              <h5 class="font-bold text-lg">📚 ${list.name}</h5>
              <p class="text-xs text-gray-400">Created: ${createdDate}</p>
              <p class="text-sm text-gray-300 mt-1">${readCount} of ${itemCount} comics read</p>
            </div>
            <button class="text-red-400 hover:text-red-300 text-sm delete-list-btn" data-list-id="${list.id}">Delete</button>
          </div>

          <!-- Progress Bar -->
          <div class="relative h-1.5 bg-gray-600 rounded-full mb-3">
            <div class="bg-purple-600 h-full rounded-full transition-all" style="width: ${progressPercent}%;"></div>
          </div>

          <!-- Action Icons -->
          <div class="flex gap-2 items-center">
            <button class="text-white hover:text-gray-300 transition-colors p-2 rounded-full hover:bg-gray-600 read-toggle-btn"
                    data-list-id="${list.id}"
                    data-current-status="${allRead}"
                    title="${allRead ? 'Mark as unread' : 'Mark as read'}"
                    aria-label="${allRead ? 'Mark as unread' : 'Mark as read'}">
              ${allRead ? '✓' : '👁'}
            </button>

            <button class="hidden sm:block text-white hover:text-gray-300 transition-colors p-2 rounded-full hover:bg-gray-600 download-list-btn"
                    data-list-id="${list.id}"
                    title="Download all comics"
                    aria-label="Download all comics">
              ⬇
            </button>

            <button class="text-white hover:text-gray-300 transition-colors p-2 rounded-full hover:bg-gray-600 play-list-btn"
                    data-list-id="${list.id}"
                    title="${allRead ? 'Restart' : hasProgress ? 'Continue' : 'Play'}"
                    aria-label="${allRead ? 'Restart' : hasProgress ? 'Continue' : 'Play'}">
              ${allRead ? '🔄' : '▶'}
            </button>
          </div>
        `;

        // Click handler for card (opens detail view)
        listDiv.addEventListener('click', (e) => {
          // Ignore if clicking on buttons
          if (e.target.closest('button')) return;
          showReadingListDetail(list.id, list.name);
        });

        // Delete button handler
        const deleteBtn = listDiv.querySelector('.delete-list-btn');
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete "${list.name}"?`)) {
            await deleteReadingList(list.id);
          }
        });

        // Read/Unread toggle handler
        const readToggleBtn = listDiv.querySelector('.read-toggle-btn');
        readToggleBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const isCurrentlyRead = readToggleBtn.dataset.currentStatus === 'true';
          const newStatus = !isCurrentlyRead;

          try {
            await window.ReadingLists.markListAsRead(list.id, newStatus);
            await refreshReadingListModal();
          } catch (error) {
            alert('Failed to update reading status. Please try again.');
          }
        });

        // Download handler
        const downloadBtn = listDiv.querySelector('.download-list-btn');
        downloadBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // TODO: Implement download all comics functionality
          alert('Download functionality coming soon!');
        });

        // Play/Continue handler
        const playBtn = listDiv.querySelector('.play-list-btn');
        playBtn.addEventListener('click', async (e) => {
          e.stopPropagation();

          // Check if library is loaded
          if (!window.library || Object.keys(window.library).length === 0) {
            alert('Library is still loading. Check the status badge at the top - it will show "Ready" when comics are available. Try again in a moment.');
            return;
          }

          try {
            const details = await window.ReadingLists.getReadingListDetails(list.id);

            // Find first unread or in-progress comic
            let firstComic = details.items.find(item => {
              const total = item.totalPages || 0;
              const last = item.lastReadPage || 0;
              return total === 0 || last < total - 1; // Not finished
            });

            // If all read, start from beginning
            if (!firstComic && details.items.length > 0) {
              firstComic = details.items[0];
            }

            if (firstComic) {
              // Find the comic in the library
              const comic = getComicById(firstComic.comicId);
              if (comic && typeof window.openComicViewer === 'function') {
                window.openComicViewer(comic);
                closeReadingListModal(); // Close modal after opening comic
              } else {
                alert('Could not find comic in library. The comic may have been moved or deleted.');
              }
            }
          } catch (error) {
            console.error('Failed to play reading list:', error);
            alert('Failed to open comic. Please try again.');
          }
        });

        listsContainer.appendChild(listDiv);
      });
    }
  }
}

/**
 * Create a new reading list
 */
async function createReadingList() {
  const name = prompt('Enter a name for your reading list:');

  if (!name || name.trim() === '') {
    return;
  }

  // Use API to create list
  if (typeof window.ReadingLists !== 'undefined' && typeof window.ReadingLists.createReadingList === 'function') {
    try {
      await window.ReadingLists.createReadingList(name.trim(), '', []);
      console.log(`[Reading List] Created list "${name}"`);

      // Refresh the modal display
      await refreshReadingListModal();
    } catch (error) {
      console.error('[Reading List] Failed to create list:', error);
      alert('Failed to create reading list. Please try again.');
    }
  }
}

/**
 * Delete a reading list by ID
 * @param {string} listId - The ID of the list to delete
 */
async function deleteReadingList(listId) {
  if (!listId) return;

  try {
    // Get base URL
    const baseTag = document.querySelector('base');
    const baseUrl = baseTag && baseTag.href ? new URL(baseTag.href).pathname.replace(/\/$/, '') : '';

    // Call delete API
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}`, {
      method: 'DELETE'
    });

    const data = await response.json();
    if (data.ok) {
      console.log(`[Reading List] Deleted list ${listId}`);
      await refreshReadingListModal();
    } else {
      throw new Error(data.message || 'Failed to delete list');
    }
  } catch (error) {
    console.error('[Reading List] Failed to delete list:', error);
    alert('Failed to delete reading list. Please try again.');
  }
}

/**
 * Show reading list detail view
 * @param {string} listId - The reading list ID
 * @param {string} listName - The reading list name
 */
async function showReadingListDetail(listId, listName) {
  const modalContent = document.getElementById('reading-lists-container').parentElement;
  if (!modalContent) return;

  // Hide main list view
  document.getElementById('reading-lists-container').parentElement.classList.add('hidden');

  // Create detail view
  const detailView = document.createElement('div');
  detailView.id = 'reading-list-detail-view';
  detailView.className = 'flex-1 overflow-y-auto p-4 sm:p-6';

  detailView.innerHTML = `
    <div class="mb-4 flex items-center gap-4">
      <button id="back-to-lists-btn" class="text-gray-400 hover:text-white transition-colors text-2xl" title="Back to lists">
        ←
      </button>
      <h2 class="text-2xl font-bold">${listName}</h2>
    </div>
    <div id="list-detail-comics-container" class="space-y-2">
      <p class="text-sm text-gray-400 text-center py-4">Loading comics...</p>
    </div>
  `;

  // Insert detail view
  modalContent.appendChild(detailView);

  // Add back button handler
  document.getElementById('back-to-lists-btn').addEventListener('click', hideReadingListDetail);

  // Load comics for this list
  try {
    const details = await window.ReadingLists.getReadingListDetails(listId);
    const comicsContainer = document.getElementById('list-detail-comics-container');

    if (!details.items || details.items.length === 0) {
      comicsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No comics in this list.</p>';
      return;
    }

    comicsContainer.innerHTML = '';

    details.items.forEach((item) => {
      const comic = getComicById(item.comicId);
      if (!comic) return; // Skip if comic not found in library

      const comicDiv = document.createElement('div');
      comicDiv.className = 'bg-gray-700 p-3 rounded flex items-center gap-3 hover:bg-gray-600 cursor-pointer transition-colors';

      const title = comic.title || comic.name || 'Unknown';
      const total = item.totalPages || 0;
      const last = item.lastReadPage || 0;
      const progressPercent = total > 0 ? Math.round((last / total) * 100) : 0;

      // Determine status
      let status = 'unread';
      if (total > 0) {
        if (last >= total - 1) status = 'read';
        else if (last > 0) status = 'in-progress';
      } else if (last > 0) {
        status = 'in-progress';
      }

      comicDiv.innerHTML = `
        <div class="flex-shrink-0 text-2xl">
          ${status === 'read' ? '✓' : status === 'in-progress' ? '👁' : '○'}
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold truncate">${title}</p>
          ${total > 0 ? `
            <div class="flex items-center gap-2 mt-1">
              <div class="flex-1 h-1 bg-gray-600 rounded-full">
                <div class="bg-purple-600 h-full rounded-full" style="width: ${progressPercent}%;"></div>
              </div>
              <span class="text-xs text-gray-400">${progressPercent}%</span>
            </div>
          ` : '<p class="text-xs text-gray-400">No progress data</p>'}
        </div>
        <button class="delete-comic-btn flex-shrink-0 text-red-400 hover:text-red-300 transition-colors p-2 text-xl" title="Remove from list" data-comic-id="${item.comicId}">
          🗑
        </button>
      `;

      // Click to open comic
      comicDiv.addEventListener('click', () => {
        if (typeof window.openComicViewer === 'function') {
          window.openComicViewer(comic);
          closeReadingListModal();
        }
      });

      // Delete button handler
      const deleteBtn = comicDiv.querySelector('.delete-comic-btn');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent opening comic

        const confirmDelete = confirm(`Remove "${title}" from this reading list?`);
        if (!confirmDelete) return;

        try {
          const result = await window.ReadingLists.removeComicsFromList(listId, [item.comicId]);
          if (result.ok) {
            // Refresh detail view
            const comicsContainer = document.getElementById('list-detail-comics-container');
            comicsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Loading comics...</p>';

            const details = await window.ReadingLists.getReadingListDetails(listId);
            if (!details.items || details.items.length === 0) {
              comicsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No comics in this list.</p>';
            } else {
              // Reload the entire detail view to refresh all comics
              hideReadingListDetail();
              showReadingListDetail(listId, listName);
            }
          } else {
            alert('Failed to remove comic from list. Please try again.');
          }
        } catch (error) {
          console.error('Failed to delete comic from list:', error);
          alert('Failed to remove comic from list. Please try again.');
        }
      });

      comicsContainer.appendChild(comicDiv);
    });
  } catch (error) {
    console.error('Failed to load reading list details:', error);
    document.getElementById('list-detail-comics-container').innerHTML = '<p class="text-sm text-red-400 text-center py-4">Failed to load comics.</p>';
  }
}

/**
 * Hide reading list detail view and return to main list
 */
function hideReadingListDetail() {
  const detailView = document.getElementById('reading-list-detail-view');
  if (detailView) {
    detailView.remove();
  }

  // Show main list view
  const mainView = document.getElementById('reading-lists-container').parentElement;
  if (mainView) {
    mainView.classList.remove('hidden');
  }
}

// Add event listeners for reading list modal (after DOM loads)
document.addEventListener('DOMContentLoaded', () => {
  // Close button
  const closeBtn = document.getElementById('reading-list-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeReadingListModal);
  }

  // Create reading list button
  const createBtn = document.getElementById('create-reading-list-btn');
  if (createBtn) {
    createBtn.addEventListener('click', createReadingList);
  }

  // Close modal when clicking outside
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeReadingListModal();
      }
    });
  }
});

initializeApp();
