import { getBaseUrl, isOffline } from './api.js';

/**
 * Export all reading lists as JSON
 * @returns {Promise<void>}
 */
export async function exportAllLists() {
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
export async function exportSingleList(listId, listName) {
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
export async function importLists(listsData) {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Importing reading lists is not available while offline.');
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
