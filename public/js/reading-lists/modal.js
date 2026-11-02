import { escapeHtml, clearElement } from '../globals.js';
import { html, raw, render } from '../ui/template.js';
import { isOffline, fetchReadingLists, createReadingList, addComicsToList } from './api.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => {
  if (el) {
    if (typeof el.replaceChildren === 'function') el.replaceChildren();
    else el.innerHTML = '';
  }
};

const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  const toStr = (c) => {
    if (c === null || c === undefined) return '';
    if (Array.isArray(c)) return c.map(toStr).join('');
    if (typeof c === 'object' && typeof c.toHTML === 'function') return c.toHTML();
    if (typeof c === 'object' && c.__isRawHtml) return c.html;
    return String(c);
  };
  el.innerHTML = toStr(content);
};

const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  const formatVal = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(formatVal).join('');
    if (typeof v === 'object' && v.__isRawHtml) return v.html;
    if (typeof v === 'object' && typeof v.toHTML === 'function') return v.toHTML();
    return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v);
  };
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      out += formatVal(values[i]);
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

// State for the "Add to Reading List" modal
let pendingComicIds = [];
let selectedListIds = new Set();

/**
 * Open the "Add to Reading List" selection modal
 * @param {Array<string>} comicIds - Comic IDs to add to lists
 */
export async function openAddToListModal(comicIds) {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Reading list editing is not available while offline.');
    return;
  }

  if (!comicIds || comicIds.length === 0) {
    return;
  }

  pendingComicIds = comicIds;
  selectedListIds.clear();

  const modal = typeof document !== 'undefined' ? document.getElementById('add-to-list-modal') : null;
  if (!modal) return;

  modal.classList.remove('hidden');
  await refreshAddToListModal();
}

/**
 * Close the "Add to Reading List" modal
 */
export function closeAddToListModal() {
  const modal = typeof document !== 'undefined' ? document.getElementById('add-to-list-modal') : null;
  if (modal) modal.classList.add('hidden');
  pendingComicIds = [];
  selectedListIds.clear();
}

/**
 * Refresh the content of the "Add to Reading List" modal
 */
export async function refreshAddToListModal() {
  const container = typeof document !== 'undefined' ? document.getElementById('add-to-list-container') : null;
  if (!container) return;

  const lists = await fetchReadingLists();

  if (lists.length === 0) {
    renderContent(container, safeHtml`<p class="text-sm text-gray-400 text-center py-4">No reading lists yet. Create one to get started!</p>`);
    return;
  }

  clear(container);
  lists.forEach(list => {
    const checkbox = document.createElement('label');
    checkbox.className = 'flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer';
    renderContent(checkbox, safeHtml`
      <input type="checkbox"
             class="w-4 h-4 rounded border-gray-600 text-purple-600 focus:ring-purple-500"
             data-list-id="${list.id}">
      <span class="flex-1">
        <span class="font-semibold">${list.name}</span>
        <span class="text-sm text-gray-400 ml-2">(${list.totalComics} items)</span>
      </span>
    `);
    const input = checkbox.querySelector('input');
    if (input) {
      input.addEventListener('change', (e) => {
        if (e.target.checked) selectedListIds.add(list.id);
        else selectedListIds.delete(list.id);
      });
    }
    container.appendChild(checkbox);
  });
}

/**
 * Handle creating a new list from the modal
 */
export async function handleCreateNewList() {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Reading list editing is not available while offline.');
    return;
  }

  const name = typeof prompt === 'function' ? prompt('Enter a name for your reading list:') : '';
  if (!name || !name.trim()) {
    return;
  }

  try {
    const listId = await createReadingList(name.trim(), '', pendingComicIds);
    await refreshAddToListModal();

    selectedListIds.add(listId);
    const checkbox = typeof document !== 'undefined' ? document.querySelector(`input[data-list-id="${listId}"]`) : null;
    if (checkbox) {
      checkbox.checked = true;
    }
  } catch (error) {
    if (typeof alert === 'function') alert('Failed to create reading list. Please try again.');
  }
}

/**
 * Handle saving selected lists
 */
export async function handleSaveToLists() {
  if (isOffline()) {
    if (typeof alert === 'function') alert('Reading list editing is not available while offline.');
    return;
  }

  if (selectedListIds.size === 0) {
    if (typeof alert === 'function') alert('Please select at least one reading list');
    return;
  }

  try {
    const promises = Array.from(selectedListIds).map(listId =>
      addComicsToList(listId, pendingComicIds)
    );

    await Promise.all(promises);

    const comicCount = pendingComicIds.length;
    const listCount = selectedListIds.size;

    closeAddToListModal();

    if (typeof alert === 'function') alert(`Added ${comicCount} comic(s) to ${listCount} reading list(s)`);
  } catch (error) {
    if (typeof alert === 'function') alert('Failed to add comics to reading lists. Please try again.');
  }
}

export function initReadingListModalEvents() {
  if (typeof document === 'undefined') return;

  const closeBtn = document.getElementById('add-to-list-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeAddToListModal);
  }

  const cancelBtn = document.getElementById('add-to-list-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeAddToListModal);
  }

  const createNewBtn = document.getElementById('add-to-list-create-new-btn');
  if (createNewBtn) {
    createNewBtn.addEventListener('click', handleCreateNewList);
  }

  const saveBtn = document.getElementById('add-to-list-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', handleSaveToLists);
  }

  const modal = document.getElementById('add-to-list-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeAddToListModal();
      }
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReadingListModalEvents);
  } else {
    initReadingListModalEvents();
  }
}
