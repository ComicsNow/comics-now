import { getRelativePath } from '../globals.js';
import { registerRoutes } from '../routes.js';
import { appGlobal } from './bootstrap.js';
import {
  refreshReadingListModal,
  setIsListEditMode
} from './reading-list-modal.js';

/**
 * Open the reading list modal and refresh its contents
 */
export function openReadingListModal() {
  setIsListEditMode(false);
  if (!appGlobal._isNavigatingFromRouter && appGlobal.router) {
    if (getRelativePath() !== '/reading-lists') {
      appGlobal.router.navigate('/reading-lists', true);
    }
  }
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    modal.classList.remove('hidden');
    refreshReadingListModal();
  }
}

/**
 * Close the reading list modal
 */
export function closeReadingListModal() {
  setIsListEditMode(false);
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    modal.classList.add('hidden');
    const modalContainer = modal.querySelector('.bg-gray-800');
    if (modalContainer) {
      modalContainer.classList.remove('max-w-6xl', 'h-[92vh]');
      modalContainer.classList.add('max-w-3xl');
    }
    if (appGlobal.router && getRelativePath() === '/reading-lists') {
      const path = appGlobal.getPathForCurrentView ? appGlobal.getPathForCurrentView() : '/';
      appGlobal.router.navigate(path, true);
    }
  }
}

/**
 * Create a new reading list
 */
export async function createReadingList() {
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    alert('Reading list editing is not available while offline.');
    return;
  }

  const name = prompt('Enter a name for your reading list:');

  if (!name || name.trim() === '') {
    return;
  }

  // Use API to create list
  if (typeof appGlobal.ReadingLists !== 'undefined' && typeof appGlobal.ReadingLists.createReadingList === 'function') {
    try {
      await appGlobal.ReadingLists.createReadingList(name.trim(), '', []);

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
export async function deleteReadingList(listId) {
  if (!listId) return;

  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    alert('Reading list editing is not available while offline.');
    return;
  }

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
      if (typeof appGlobal.deleteReadingListDetailCacheFromDB === 'function') {
        appGlobal.deleteReadingListDetailCacheFromDB(listId).catch(() => {});
      }
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
 * Hide reading list detail view and return to main list
 */
export function hideReadingListDetail() {
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    const modalContainer = modal.querySelector('.bg-gray-800');
    if (modalContainer) {
      modalContainer.classList.remove('max-w-6xl', 'h-[92vh]');
      modalContainer.classList.add('max-w-3xl');
    }
  }

  const detailView = document.getElementById('reading-list-detail-view');
  if (detailView) {
    detailView.remove();
  }

  // Show overview and main list view
  const overviewEl = document.getElementById('reading-lists-overview');
  if (overviewEl) {
    overviewEl.classList.remove('hidden');
  }
  const mainView = document.getElementById('reading-lists-container');
  if (mainView) {
    mainView.classList.remove('hidden');
  }
}

/**
 * Bind DOMContentLoaded event listeners for reading list modal and routes
 */
export function bindReadingListModalEvents() {
  registerRoutes();

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

  // Export All Lists button
  const exportAllBtn = document.getElementById('export-all-lists-btn');
  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', async () => {
      try {
        await appGlobal.ReadingLists.exportAllLists();
      } catch (error) {
        alert('Failed to export lists. Please try again.');
      }
    });
  }

  // Import Lists button
  const importBtn = document.getElementById('import-lists-btn');
  const fileInput = document.getElementById('import-file-input');
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        alert('Importing reading lists is not available while offline.');
        return;
      }
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Check for duplicate names
        const existingLists = await appGlobal.ReadingLists.fetchReadingLists();
        const existingNames = new Set(existingLists.map(list => list.name.toLowerCase()));

        const listsToImport = Array.isArray(data) ? data : [data];
        const processedLists = [];

        for (const list of listsToImport) {
          if (existingNames.has(list.name.toLowerCase())) {
            const choice = confirm(
              `A reading list named "${list.name}" already exists.\n\n` +
              `Click OK to rename the imported list (will add " (imported)")\n` +
              `Click Cancel to skip this list`
            );

            if (choice) {
              list.name = `${list.name} (imported)`;
              processedLists.push(list);
            }
          } else {
            processedLists.push(list);
          }
        }

        if (processedLists.length === 0) {
          alert('No lists were imported.');
          fileInput.value = '';
          return;
        }

        const result = await appGlobal.ReadingLists.importLists(processedLists);
        if (result.ok) {
          alert(`Successfully imported ${processedLists.length} list(s)!`);
          await refreshReadingListModal();
        } else {
          alert('Failed to import lists. Please try again.');
        }
      } catch (error) {
        console.error('Import error:', error);
        alert('Failed to import lists. Please check the file format and try again.');
      }

      fileInput.value = '';
    });
  }

  // Edit Reading Lists button
  const editReadingListsBtn = document.getElementById('edit-reading-lists-btn');
  if (editReadingListsBtn) {
    editReadingListsBtn.addEventListener('click', () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        alert('Reading list editing is not available while offline.');
        return;
      }
      setIsListEditMode(true);
      refreshReadingListModal();
    });
  }

  // Save Reading Lists order button
  const saveReadingListsOrderBtn = document.getElementById('save-reading-lists-order-btn');
  if (saveReadingListsOrderBtn) {
    saveReadingListsOrderBtn.addEventListener('click', async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        alert('Reading list editing is not available while offline.');
        return;
      }
      try {
        const listsContainer = document.getElementById('reading-lists-container');
        const listDivs = listsContainer.querySelectorAll('[data-list-id]');
        const listOrder = Array.from(listDivs).map(div => div.dataset.listId);

        const baseTag = document.querySelector('base');
        const baseUrl = baseTag && baseTag.href ? new URL(baseTag.href).pathname.replace(/\/$/, '') : '';

        const response = await fetch(`${baseUrl}/api/v1/reading-lists/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listOrder })
        });

        const data = await response.json();
        if (data.ok) {
          setIsListEditMode(false);
          refreshReadingListModal();
        } else {
          alert('Failed to save reading list order: ' + (data.message || 'Unknown error'));
        }
      } catch (error) {
        console.error('Failed to save reading list order:', error);
        alert('Failed to save reading list order. Please try again.');
      }
    });
  }

  // Cancel Reading Lists edit button
  const cancelReadingListsEditBtn = document.getElementById('cancel-reading-lists-edit-btn');
  if (cancelReadingListsEditBtn) {
    cancelReadingListsEditBtn.addEventListener('click', () => {
      setIsListEditMode(false);
      refreshReadingListModal();
    });
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

  // Network state listeners to auto-update reading lists UI
  window.addEventListener('online', () => {
    const rModal = document.getElementById('reading-list-modal');
    if (rModal && !rModal.classList.contains('hidden')) {
      refreshReadingListModal();
    }
  });

  window.addEventListener('offline', () => {
    const rModal = document.getElementById('reading-list-modal');
    if (rModal && !rModal.classList.contains('hidden')) {
      refreshReadingListModal();
    }
  });
}
