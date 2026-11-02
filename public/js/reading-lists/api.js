import { state } from '../globals.js';
import { isAppOnline } from '../offline/status.js';
import {
  saveReadingListsCacheToDB,
  loadReadingListsCacheFromDB,
  saveReadingListDetailCacheToDB,
  loadReadingListDetailCacheFromDB
} from '../offline/db-library-cache.js';

/**
 * Check if the browser is currently offline
 * @returns {boolean}
 */
export function isOffline() {
  if (typeof isAppOnline === 'function') {
    return !isAppOnline();
  }
  const status = typeof window !== 'undefined' ? (window.OfflineStatus || window) : null;
  if (status && typeof status.isAppOnline === 'function') {
    return !status.isAppOnline();
  }
  return typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
}

/**
 * Get the base URL for API calls
 * @returns {string} Base URL
 */
export function getBaseUrl() {
  if (typeof document === 'undefined') return '';
  const baseTag = document.querySelector('base');
  if (baseTag && baseTag.href) {
    try {
      const url = new URL(baseTag.href);
      return url.pathname.replace(/\/$/, '');
    } catch (_) {}
  }
  return '';
}

/**
 * Background pre-caching of details for all reading lists
 * @param {Array} lists - Array of reading lists
 */
export async function precacheAllReadingListDetails(lists) {
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
export async function fetchReadingLists() {
  if (isOffline()) {
    try {
      const cached = await loadReadingListsCacheFromDB();
      if (cached && Array.isArray(cached)) {
        const setCached = state?.setCachedReadingLists || (typeof window !== 'undefined' ? window.setCachedReadingLists : null) || state?.LibrarySmartLists?.setCachedReadingLists;
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
      const setCached = state?.setCachedReadingLists || (typeof window !== 'undefined' ? window.setCachedReadingLists : null) || state?.LibrarySmartLists?.setCachedReadingLists;
      if (typeof setCached === 'function') {
        setCached(lists);
      }
      saveReadingListsCacheToDB(lists).catch(err => console.warn('[Reading Lists] Failed to cache lists:', err));
      precacheAllReadingListDetails(lists).catch(err => console.warn('[Reading Lists] Precache error:', err));
      return lists;
    }
    throw new Error(data.message || 'Failed to fetch reading lists');
  } catch (error) {
    console.warn('[Reading Lists] Fetch error, falling back to offline cache:', error);
    try {
      const cached = await loadReadingListsCacheFromDB();
      if (cached && Array.isArray(cached)) {
        const setCached = state?.setCachedReadingLists || (typeof window !== 'undefined' ? window.setCachedReadingLists : null) || state?.LibrarySmartLists?.setCachedReadingLists;
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
export async function createReadingList(name, description = '', comicIds = []) {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Reading list editing is not available while offline.');
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
export async function addComicsToList(listId, comicIds) {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Reading list editing is not available while offline.');
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
export async function getReadingListDetails(listId) {
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
 * Fetch DAG data for a specific reading list
 * @param {string} listId - Reading list ID
 * @param {Object} [cachedDetails] - Optional cached details
 * @returns {Promise<Object>} DAG data with nodes, edges, lanes, stats
 */
export async function fetchReadingListDAG(listId, cachedDetails = null) {
  const baseUrl = getBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}/dag`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) return data;
    }
  } catch (err) {
    console.warn('[Reading Lists] Network fetch for DAG failed:', err);
  }

  try {
    const details = cachedDetails || await getReadingListDetails(listId);
    const builder = state?.buildDAGFromDetails || (typeof window !== 'undefined' ? window.buildDAGFromDetails : null);
    if (typeof builder === 'function') {
      return builder(details);
    }
  } catch (e) {}
  return null;
}

/**
 * Mark all comics in a reading list as read or unread
 * @param {string} listId - Reading list ID
 * @param {boolean} read - True to mark as read, false for unread
 * @returns {Promise<boolean>} Success status
 */
export async function markListAsRead(listId, read) {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Marking reading lists as read is not available while offline.');
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
export async function removeComicsFromList(listId, comicIds) {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Reading list editing is not available while offline.');
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
export async function reorderComics(listId, comicOrder) {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Reading list editing is not available while offline.');
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
