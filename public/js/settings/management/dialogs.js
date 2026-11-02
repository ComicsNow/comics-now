/**
 * Comics Now! - Management Dialogs & Confirmation Modals
 *
 * Safety confirmation dialog, directory selection modal, and operation errors viewer.
 */

import { escapeHtml } from '../../globals.js';

let activeConfirmCallback = null;
let confirmListenersBound = false;

function bindConfirmModalListeners() {
  if (confirmListenersBound) return;
  const confirmModal = document.getElementById('mgmt-confirm-modal');
  const confirmInput = document.getElementById('mgmt-confirm-input');
  const confirmProceedBtn = document.getElementById('mgmt-confirm-proceed-btn');
  const confirmCancelBtn = document.getElementById('mgmt-confirm-cancel-btn');

  if (confirmInput && confirmProceedBtn) {
    confirmInput.addEventListener('input', () => {
      confirmProceedBtn.disabled = (confirmInput.value.trim() !== 'i want to do this');
    });
    confirmInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !confirmProceedBtn.disabled) {
        confirmProceedBtn.click();
      }
    });
  }

  if (confirmCancelBtn && confirmModal) {
    confirmCancelBtn.addEventListener('click', () => {
      confirmModal.classList.add('hidden');
      activeConfirmCallback = null;
    });
  }

  if (confirmProceedBtn && confirmModal) {
    confirmProceedBtn.addEventListener('click', () => {
      if (confirmInput && confirmInput.value.trim() === 'i want to do this') {
        const cb = activeConfirmCallback;
        confirmModal.classList.add('hidden');
        activeConfirmCallback = null;
        if (typeof cb === 'function') {
          cb('i want to do this');
        }
      }
    });
  }

  confirmListenersBound = true;
}

/**
 * Prompt safety confirmation requiring the exact phrase "i want to do this"
 * @param {string} title
 * @param {string} warning
 * @param {Function} callback
 */
export function promptSafetyConfirmation(title, warning, callback) {
  bindConfirmModalListeners();
  const confirmModal = document.getElementById('mgmt-confirm-modal');
  const confirmTitle = document.getElementById('mgmt-confirm-title');
  const confirmWarning = document.getElementById('mgmt-confirm-warning');
  const confirmInput = document.getElementById('mgmt-confirm-input');
  const confirmProceedBtn = document.getElementById('mgmt-confirm-proceed-btn');

  if (!confirmModal) {
    if (confirm(`${title}\n\n${warning}\n\nType "i want to do this" to continue:`)) {
      callback('i want to do this');
    }
    return;
  }
  if (confirmTitle) confirmTitle.textContent = title;
  if (confirmWarning) confirmWarning.textContent = warning;
  if (confirmInput) {
    confirmInput.value = '';
  }
  if (confirmProceedBtn) {
    confirmProceedBtn.disabled = true;
  }
  activeConfirmCallback = callback;
  confirmModal.classList.remove('hidden');
  if (confirmInput) confirmInput.focus();
}

/**
 * Loads recent operation errors from the server and renders to errorsList element
 * @param {HTMLElement} errorsList
 * @param {string} apiBaseUrl
 */
export async function loadOperationErrors(errorsList, apiBaseUrl = '') {
  if (!errorsList) return;
  errorsList.innerHTML = '<p class="text-sm text-gray-500 animate-pulse">Loading errors...</p>';
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/operation-errors`);
    const data = await res.json();
    if (!data.ok || data.errors.length === 0) {
      errorsList.innerHTML = '<p class="text-sm text-gray-500">No errors recorded this session.</p>';
      return;
    }
    const errorsHtml = data.errors.map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString();
      const badge = e.source === 'rename'
        ? '<span class="text-blue-400 text-xs font-bold uppercase">rename</span>'
        : '<span class="text-green-400 text-xs font-bold uppercase">move</span>';
      return `<div class="bg-gray-900 rounded-lg p-3 border border-red-900/40">
        <div class="flex items-center gap-2 mb-1">${badge}<span class="text-gray-500 text-xs">${time}</span></div>
        <p class="text-red-400 text-xs font-mono break-all">${escapeHtml(e.message)}</p>
      </div>`;
    }).join('');
    errorsList.innerHTML = errorsHtml;
  } catch {
    errorsList.innerHTML = '<p class="text-sm text-red-400">Failed to load errors.</p>';
  }
}

/**
 * Populates library select dropdowns from configured comics directories
 * @param {string} apiBaseUrl
 */
export async function populateLibrarySelects(apiBaseUrl = '') {
  const selects = [
    document.getElementById('rename-library-select'),
    document.getElementById('move-library-select')
  ].filter(Boolean);
  if (selects.length === 0) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/comics-directories`);
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.directories)) return;
    const libraries = data.directories.filter(dir => !dir.isInbox);
    selects.forEach(sel => {
      const current = sel.value;
      if (typeof sel.replaceChildren === 'function') sel.replaceChildren();
      else sel.innerHTML = '';

      if (libraries.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No libraries configured';
        opt.disabled = true;
        sel.appendChild(opt);
        return;
      }
      libraries.forEach(dir => {
        const opt = document.createElement('option');
        opt.value = dir.fullPath;
        opt.textContent = dir.name ? `${dir.name} — ${dir.fullPath}` : dir.fullPath;
        opt.title = dir.fullPath;
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    });
  } catch (_) {}
}

/**
 * Shows directory destination selector modal
 * @param {Array} directories
 * @param {Function} onSelect
 */
export function showDirectorySelectionModal(directories, onSelect) {
  const modal = document.getElementById('directory-selection-modal');
  const optionsContainer = document.getElementById('directory-options');
  const confirmBtn = document.getElementById('directory-confirm-btn');
  const cancelBtn = document.getElementById('directory-cancel-btn');
  const closeBtn = document.getElementById('directory-modal-close');

  if (!modal || !optionsContainer) return;

  if (typeof optionsContainer.replaceChildren === 'function') optionsContainer.replaceChildren();
  else optionsContainer.innerHTML = '';
  let selectedDirectory = null;

  directories.forEach((dir, index) => {
    const option = document.createElement('div');
    option.className = 'flex items-center space-x-3 p-3 rounded-lg border border-gray-600 hover:border-gray-500 hover:bg-gray-750 transition-colors cursor-pointer';
    option.innerHTML = `
      <input type="radio" id="dir-${index}" name="directory" value="${escapeHtml(dir.fullPath)}" class="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 focus:ring-green-500 focus:ring-2">
      <div class="grow">
        <label for="dir-${index}" class="text-white cursor-pointer font-medium block">${escapeHtml(dir.name)}</label>
        <span class="text-gray-400 text-sm">${escapeHtml(dir.fullPath)}</span>
      </div>
    `;
    optionsContainer.appendChild(option);

    option.addEventListener('click', () => {
      const radio = option.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      selectedDirectory = dir.fullPath;
      if (confirmBtn) confirmBtn.disabled = false;

      optionsContainer.querySelectorAll('div').forEach(opt => {
        opt.classList.remove('border-green-500', 'bg-gray-700');
        opt.classList.add('border-gray-600');
      });

      option.classList.remove('border-gray-600');
      option.classList.add('border-green-500', 'bg-gray-700');
    });
  });

  modal.classList.remove('hidden');

  const cleanup = () => {
    if (confirmBtn) {
      confirmBtn.removeEventListener('click', handleConfirm);
      confirmBtn.disabled = true;
    }
    if (cancelBtn) cancelBtn.removeEventListener('click', handleCancel);
    if (closeBtn) closeBtn.removeEventListener('click', handleCancel);
  };

  const handleConfirm = async () => {
    if (selectedDirectory) {
      modal.classList.add('hidden');
      if (typeof onSelect === 'function') {
        await onSelect(selectedDirectory);
      }
    }
    cleanup();
  };

  const handleCancel = () => {
    modal.classList.add('hidden');
    cleanup();
  };

  if (confirmBtn) confirmBtn.addEventListener('click', handleConfirm);
  if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
  if (closeBtn) closeBtn.addEventListener('click', handleCancel);
}
