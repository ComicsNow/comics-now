/**
 * Reading Lists - Frontend functionality for managing reading lists
 */
(function(global) {
  'use strict';

  // State for the "Add to Reading List" modal
  let pendingComicIds = [];
  let selectedListIds = new Set();

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
   * Fetch all reading lists for current user
   * @returns {Promise<Array>} Array of reading lists with stats
   */
  async function fetchReadingLists() {
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/v1/reading-lists`);
      const data = await response.json();
      if (data.ok) {
        return data.lists || [];
      }
      throw new Error(data.message || 'Failed to fetch reading lists');
    } catch (error) {
      console.error('[Reading Lists] Error fetching lists:', error);
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
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}`);
      const data = await response.json();
      if (data.ok) {
        return data;
      }
      throw new Error(data.message || 'Failed to load reading list details');
    } catch (error) {
      console.error('[Reading Lists] Error fetching details:', error);
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

  // ============================================================================
  // MODAL MANAGEMENT
  // ============================================================================

  /**
   * Open the "Add to Reading List" selection modal
   * @param {Array<string>} comicIds - Comic IDs to add to lists
   */
  async function openAddToListModal(comicIds) {
    if (!comicIds || comicIds.length === 0) {
      console.warn('[Reading Lists] No comics provided to add');
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
               data-list-id="${list.id}">
        <span class="flex-1">
          <span class="font-semibold">${list.name}</span>
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
    const name = prompt('Enter a name for your reading list:');
    if (!name || !name.trim()) {
      return;
    }

    try {
      // Create the list with pending comics
      const listId = await createReadingList(name.trim(), '', pendingComicIds);
      console.log(`[Reading Lists] Created list "${name}" with ${pendingComicIds.length} comics`);

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

      console.log(`[Reading Lists] Added ${comicCount} comic(s) to ${listCount} list(s)`);

      // Close modal
      closeAddToListModal();

      // Show success message
      // TODO: Replace with toast notification
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

  global.ReadingLists = {
    fetchReadingLists,
    createReadingList,
    addComicsToList,
    getReadingListDetails,
    markListAsRead,
    removeComicsFromList,
    openAddToListModal,
    closeAddToListModal
  };

})(typeof window !== 'undefined' ? window : globalThis);
