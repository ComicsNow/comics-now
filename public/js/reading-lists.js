/**
 * Reading Lists - Frontend functionality for managing reading lists
 */
import { state, escapeHtml } from './globals.js';
import {
  saveReadingListsCacheToDB,
  loadReadingListsCacheFromDB,
  saveReadingListDetailCacheToDB,
  loadReadingListDetailCacheFromDB
} from './offline/db-library-cache.js';

// State for the "Add to Reading List" modal
let pendingComicIds = [];
let selectedListIds = new Set();

/**
 * Check if the browser is currently offline
 * @returns {boolean}
 */
export function isOffline() {
  return typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Get the base URL for API calls
 * @returns {string} Base URL
 */
function getBaseUrl() {
  // Extract baseUrl from the page's <base> tag
  const baseTag = document.querySelector('base');
  if (baseTag && baseTag.href) {
    const url = new URL(baseTag.href);
    return url.pathname.replace(/\/$/, ''); // Remove trailing slash
  }
  return '';
}

/**
 * Background pre-caching of details for all reading lists
 * @param {Array} lists - Array of reading lists
 */
async function precacheAllReadingListDetails(lists) {
  if (!lists || !Array.isArray(lists) || lists.length === 0) return;
  const baseUrl = getBaseUrl();
  for (const list of lists) {
    if (!list || !list.id) continue;
    try {
      const response = await fetch(`${baseUrl}/api/v1/reading-lists/${list.id}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.ok) {
          await saveReadingListDetailCacheToDB(list.id, data);
        }
      }
    } catch (e) {
      // Ignore background precaching fetch failures
    }
  }
}

/**
 * Fetch all reading lists for current user
 * @returns {Promise<Array>} Array of reading lists with stats
 */
async function fetchReadingLists() {
  // If explicitly offline, load immediately from cache
  if (isOffline()) {
    try {
      const cached = await loadReadingListsCacheFromDB();
      if (cached && Array.isArray(cached)) {
        const setCached = state.setCachedReadingLists || window.setCachedReadingLists || state.LibrarySmartLists?.setCachedReadingLists;
        if (typeof setCached === 'function') {
          setCached(cached);
        }
        return cached;
      }
    } catch (cacheErr) {
      console.warn('[Reading Lists] Error loading offline cache:', cacheErr);
    }
    return [];
  }

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists`);
    const data = await response.json();
    if (data.ok) {
      const lists = data.lists || [];
      const setCached = state.setCachedReadingLists || window.setCachedReadingLists || state.LibrarySmartLists?.setCachedReadingLists;
      if (typeof setCached === 'function') {
        setCached(lists);
      }
      // Save lists to offline cache in background
      saveReadingListsCacheToDB(lists).catch(err => console.warn('[Reading Lists] Failed to cache lists:', err));
      // Pre-cache item details for all lists so they are available offline
      precacheAllReadingListDetails(lists).catch(err => console.warn('[Reading Lists] Precache error:', err));
      return lists;
    }
    throw new Error(data.message || 'Failed to fetch reading lists');
  } catch (error) {
    console.warn('[Reading Lists] Fetch error, falling back to offline cache:', error);
    try {
      const cached = await loadReadingListsCacheFromDB();
      if (cached && Array.isArray(cached)) {
        const setCached = state.setCachedReadingLists || window.setCachedReadingLists || state.LibrarySmartLists?.setCachedReadingLists;
        if (typeof setCached === 'function') {
          setCached(cached);
        }
        return cached;
      }
    } catch (cacheErr) {
      console.warn('[Reading Lists] Error loading offline cache:', cacheErr);
    }
    return [];
  }
}

/**
 * Create a new reading list
 * @param {string} name - List name
 * @param {string} description - List description
 * @param {Array<string>} comicIds - Comic IDs to add
 * @returns {Promise<string>} Created list ID
 */
async function createReadingList(name, description = '', comicIds = []) {
  if (isOffline()) {
    alert('Reading list editing is not available while offline.');
    throw new Error('Reading list editing is not available while offline.');
  }

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, comicIds })
    });
    const data = await response.json();
    if (data.ok) {
      return data.listId;
    }
    throw new Error(data.message || 'Failed to create reading list');
  } catch (error) {
    console.error('[Reading Lists] Error creating list:', error);
    throw error;
  }
}

/**
 * Add comics to a reading list
 * @param {string} listId - Reading list ID
 * @param {Array<string>} comicIds - Comic IDs to add
 * @returns {Promise<boolean>} Success status
 */
async function addComicsToList(listId, comicIds) {
  if (isOffline()) {
    alert('Reading list editing is not available while offline.');
    throw new Error('Reading list editing is not available while offline.');
  }

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}/comics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comicIds })
    });
    const data = await response.json();
    if (data.ok) {
      return true;
    }
    throw new Error(data.message || 'Failed to add comics to list');
  } catch (error) {
    console.error('[Reading Lists] Error adding comics:', error);
    throw error;
  }
}

/**
 * Get reading list details with all comics
 * @param {string} listId - Reading list ID
 * @returns {Promise<Object>} List details with comics
 */
async function getReadingListDetails(listId) {
  if (isOffline()) {
    try {
      const cached = await loadReadingListDetailCacheFromDB(listId);
      if (cached) {
        return cached;
      }
    } catch (e) {
      console.warn('[Reading Lists] Error loading offline detail cache:', e);
    }
    throw new Error('Reading list details not available offline.');
  }

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}`);
    const data = await response.json();
    if (data.ok) {
      // Cache details for offline use
      saveReadingListDetailCacheToDB(listId, data).catch(err => console.warn('[Reading Lists] Failed to cache details:', err));
      return data;
    }
    throw new Error(data.message || 'Failed to load reading list details');
  } catch (error) {
    console.warn('[Reading Lists] Error fetching details, checking offline cache:', error);
    try {
      const cached = await loadReadingListDetailCacheFromDB(listId);
      if (cached) {
        return cached;
      }
    } catch (e) {}
    throw error;
  }
}

/**
 * Mark all comics in a reading list as read or unread
 * @param {string} listId - Reading list ID
 * @param {boolean} read - True to mark as read, false for unread
 * @returns {Promise<boolean>} Success status
 */
async function markListAsRead(listId, read) {
  if (isOffline()) {
    alert('Marking reading lists as read is not available while offline.');
    throw new Error('Marking reading lists as read is not available while offline.');
  }

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read })
    });
    const data = await response.json();
    if (data.ok) {
      return true;
    }
    throw new Error(data.message || 'Failed to mark list as read');
  } catch (error) {
    console.error('[Reading Lists] Error marking as read:', error);
    throw error;
  }
}

/**
 * Remove comics from a reading list
 * @param {string} listId - Reading list ID
 * @param {Array<string>} comicIds - Array of comic IDs to remove
 * @returns {Promise<Object>} Result object with ok status
 */
async function removeComicsFromList(listId, comicIds) {
  if (isOffline()) {
    alert('Reading list editing is not available while offline.');
    throw new Error('Reading list editing is not available while offline.');
  }

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}/comics`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comicIds })
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[Reading Lists] Error removing comics:', error);
    throw error;
  }
}

/**
 * Reorder comics in a reading list
 * @param {string} listId - Reading list ID
 * @param {Array<string>} comicOrder - Array of comic IDs in new order
 * @returns {Promise<Object>} Result object with ok status
 */
async function reorderComics(listId, comicOrder) {
  if (isOffline()) {
    alert('Reading list editing is not available while offline.');
    throw new Error('Reading list editing is not available while offline.');
  }

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comicOrder })
    });
    const data = await response.json();
    if (data.ok && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('reading-list-reordered', { detail: { listId, comicOrder } }));
    }
    return data;
  } catch (error) {
    console.error('[Reading Lists] Error reordering comics:', error);
    throw error;
  }
}

/**
 * Export all reading lists as JSON
 * @returns {Promise<void>}
 */
async function exportAllLists() {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    if (data.ok && data.lists) {
      const blob = new Blob([JSON.stringify(data.lists, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reading-lists-all-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      throw new Error('Failed to export lists');
    }
  } catch (error) {
    console.error('[Reading Lists] Error exporting all lists:', error);
    throw error;
  }
}

/**
 * Export a single reading list as JSON
 * @param {string} listId - Reading list ID
 * @param {string} listName - Reading list name (for filename)
 * @returns {Promise<void>}
 */
async function exportSingleList(listId, listName) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listIds: [listId] })
    });
    const data = await response.json();

    if (data.ok && data.lists && data.lists.length > 0) {
      const blob = new Blob([JSON.stringify(data.lists[0], null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = listName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      a.href = url;
      a.download = `reading-list-${safeName}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      throw new Error('Failed to export list');
    }
  } catch (error) {
    console.error('[Reading Lists] Error exporting single list:', error);
    throw error;
  }
}

/**
 * Import reading lists from JSON data
 * @param {Object|Array} listsData - Reading list data (single object or array)
 * @returns {Promise<Object>} Result with imported/skipped counts
 */
async function importLists(listsData) {
  if (isOffline()) {
    alert('Importing reading lists is not available while offline.');
    throw new Error('Importing reading lists is not available while offline.');
  }

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lists: Array.isArray(listsData) ? listsData : [listsData] })
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[Reading Lists] Error importing lists:', error);
    throw error;
  }
}

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================

/**
 * Open the "Add to Reading List" selection modal
 * @param {Array<string>} comicIds - Comic IDs to add to lists
 */
async function openAddToListModal(comicIds) {
  if (isOffline()) {
    alert('Reading list editing is not available while offline.');
    return;
  }

  if (!comicIds || comicIds.length === 0) {
    return;
  }

  pendingComicIds = comicIds;
  selectedListIds.clear();

  const modal = document.getElementById('add-to-list-modal');
  if (!modal) return;

  // Show modal
  modal.classList.remove('hidden');

  // Load and display reading lists
  await refreshAddToListModal();
}

/**
 * Close the "Add to Reading List" modal
 */
function closeAddToListModal() {
  const modal = document.getElementById('add-to-list-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  pendingComicIds = [];
  selectedListIds.clear();
}

/**
 * Refresh the content of the "Add to Reading List" modal
 */
async function refreshAddToListModal() {
  const container = document.getElementById('add-to-list-container');
  if (!container) return;

  // Fetch reading lists
  const lists = await fetchReadingLists();

  if (lists.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No reading lists yet. Create one to get started!</p>';
    return;
  }

  // Build checkboxes for each list
  container.innerHTML = '';
  lists.forEach(list => {
    const checkbox = document.createElement('label');
    checkbox.className = 'flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer';
    checkbox.innerHTML = `
      <input type="checkbox"
             class="w-4 h-4 rounded border-gray-600 text-purple-600 focus:ring-purple-500"
             data-list-id="${escapeHtml(list.id)}">
      <span class="flex-1">
        <span class="font-semibold">${escapeHtml(list.name)}</span>
        <span class="text-sm text-gray-400 ml-2">(${list.totalComics} items)</span>
      </span>
    `;

    // Add event listener to track selection
    const input = checkbox.querySelector('input');
    input.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedListIds.add(list.id);
      } else {
        selectedListIds.delete(list.id);
      }
    });

    container.appendChild(checkbox);
  });
}

/**
 * Handle creating a new list from the modal
 */
async function handleCreateNewList() {
  if (isOffline()) {
    alert('Reading list editing is not available while offline.');
    return;
  }

  const name = prompt('Enter a name for your reading list:');
  if (!name || !name.trim()) {
    return;
  }

  try {
    // Create the list with pending comics
    const listId = await createReadingList(name.trim(), '', pendingComicIds);

    // Refresh the modal to show new list
    await refreshAddToListModal();

    // Auto-select the new list
    selectedListIds.add(listId);
    const checkbox = document.querySelector(`input[data-list-id="${listId}"]`);
    if (checkbox) {
      checkbox.checked = true;
    }
  } catch (error) {
    alert('Failed to create reading list. Please try again.');
  }
}

/**
 * Handle saving selected lists
 */
async function handleSaveToLists() {
  if (isOffline()) {
    alert('Reading list editing is not available while offline.');
    return;
  }

  if (selectedListIds.size === 0) {
    alert('Please select at least one reading list');
    return;
  }

  try {
    // Add comics to each selected list
    const promises = Array.from(selectedListIds).map(listId =>
      addComicsToList(listId, pendingComicIds)
    );

    await Promise.all(promises);

    // Save counts before closing modal (which clears the variables)
    const comicCount = pendingComicIds.length;
    const listCount = selectedListIds.size;

    // Close modal
    closeAddToListModal();

    // Show success message
    alert(`Added ${comicCount} comic(s) to ${listCount} reading list(s)`);
  } catch (error) {
    alert('Failed to add comics to reading lists. Please try again.');
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Close button
  const closeBtn = document.getElementById('add-to-list-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeAddToListModal);
  }

  // Cancel button
  const cancelBtn = document.getElementById('add-to-list-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeAddToListModal);
  }

  // Create new list button
  const createNewBtn = document.getElementById('add-to-list-create-new-btn');
  if (createNewBtn) {
    createNewBtn.addEventListener('click', handleCreateNewList);
  }

  // Save button
  const saveBtn = document.getElementById('add-to-list-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', handleSaveToLists);
  }

  // Close modal when clicking outside
  const modal = document.getElementById('add-to-list-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeAddToListModal();
      }
    });
  }
});

// ============================================================================
// EXPOSE PUBLIC API
// ============================================================================

const ReadingLists = {
  fetchReadingLists,
  getReadingLists: fetchReadingLists,
  createReadingList,
  addComicsToList,
  getReadingListDetails,
  markListAsRead,
  removeComicsFromList,
  reorderComics,
  exportAllLists,
  exportSingleList,
  importLists,
  openAddToListModal,
  closeAddToListModal,
  isOffline
};

export {
  fetchReadingLists,
  createReadingList,
  addComicsToList,
  getReadingListDetails,
  markListAsRead,
  removeComicsFromList,
  reorderComics,
  exportAllLists,
  exportSingleList,
  importLists,
  openAddToListModal,
  closeAddToListModal,
  ReadingLists
};

// Aliases for compatibility
ReadingLists.getReadingLists = fetchReadingLists;

state.ReadingLists = ReadingLists;

if (typeof window !== 'undefined') {
  window.ReadingLists = ReadingLists;
}

