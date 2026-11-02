// --- EVENT LISTENERS ---

import {
  state,
  encodePath,
  metadataForm,
  saveStatusDiv
} from './globals.js';

import {
  initSettingsTabListeners,
  initCtTabListeners
} from './events/tabs.js';

// Initialize settings and ComicTagger tab listeners when available
if (typeof initSettingsTabListeners === 'function') {
  initSettingsTabListeners();
}
if (typeof initCtTabListeners === 'function') {
  initCtTabListeners();
}

export async function triggerScan(button = null, full = false) {
  if (button) button.disabled = true;
  try {
    const options = { method: 'POST' };
    if (full) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ full: true });
    }
    await fetch(`${state.API_BASE_URL}/api/v1/scan`, options);
  } catch (e) {
    throw e;
  } finally {
    if (button) button.disabled = false;
  }
}
state.triggerScan = triggerScan;
if (typeof window !== 'undefined') {
  window.triggerScan = triggerScan;
}

metadataForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Instantly clear the unsaved changes flag so that any concurrent clicks during the async save do not trigger the warning
  state.metadataHasUnsavedChanges = false;

  const statusDiv = document.getElementById('save-status') || saveStatusDiv;
  if (statusDiv) statusDiv.textContent = 'Saving...';
  const formData = new FormData(metadataForm);
  if (!state.currentMetadata) {
    state.currentMetadata = await (await fetch(`${state.API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(encodePath(state.currentComic.path))}`)).json();
  }

  for (const [key, value] of formData.entries()) {
    state.currentMetadata[key] = value;
    if (key === 'Title') {
      delete state.currentMetadata.title;
      delete state.currentMetadata.issue_title;
    }
  }

  try {
    const response = await fetch(`${state.API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(encodePath(state.currentComic.path))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.currentMetadata)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Failed to save metadata.');

    if (statusDiv) {
      if (result.writeBack === 'skipped') {
        statusDiv.textContent = 'Changes saved to database (CBZ write-back skipped for Folder Mode)';
      } else {
        statusDiv.textContent = 'Changes saved successfully!';
      }
    }

    if (state.currentComic) {
      state.currentComic.metadata = JSON.stringify(state.currentMetadata);
      if (state.currentMetadata.Title !== undefined) {
        state.currentComic.title = state.currentMetadata.Title;
      }
      if (state.currentMetadata.Series !== undefined) {
        state.currentComic.series = state.currentMetadata.Series;
      }

      // Recompute display info and update viewer title / subtitle immediately
      const applyDisplayInfoFn = state.applyDisplayInfoToComic || window.applyDisplayInfoToComic;
      const displayInfo = typeof applyDisplayInfoFn === 'function' ? applyDisplayInfoFn(state.currentComic) : null;

      const comicTitleEl = state.comicTitleH2 || (typeof document !== 'undefined' ? document.getElementById('comic-title') : null);
      if (comicTitleEl && displayInfo) {
        comicTitleEl.textContent = displayInfo.displayTitle || state.currentComic.name || '';
      }

      const comicSubtitleEl = state.comicSubtitleP || (typeof document !== 'undefined' ? document.getElementById('comic-subtitle') : null);
      if (comicSubtitleEl && displayInfo) {
        const subtitleText = displayInfo.subtitle;
        if (subtitleText) {
          comicSubtitleEl.textContent = subtitleText;
          comicSubtitleEl.classList.remove('hidden');
        } else {
          comicSubtitleEl.textContent = '';
          comicSubtitleEl.classList.add('hidden');
        }
      }

      const hasSeries = ((state.currentMetadata.Series || '').toString().trim().length > 0) || ((state.currentMetadata.Title || '').toString().trim().length > 0);
      const hasPublisher = (state.currentMetadata.Publisher || '').toString().trim().length > 0;
      const hasDate = (state.currentMetadata.Year || state.currentMetadata.CoverDate || state.currentMetadata.StoreDate || state.currentMetadata['Cover Date'] || state.currentMetadata['Store Date'] || '').toString().trim().length > 0;
      const hasNumber = (state.currentMetadata.Number !== undefined && state.currentMetadata.Number !== null && state.currentMetadata.Number.toString().trim().length > 0);
      const newTag = (hasSeries && hasPublisher && hasDate && hasNumber) ? 'successful' : 'failed';
      state.currentComic.tagStatus = newTag;

      const comicMap = state.comicIdMap || window.comicIdMap;
      if (comicMap) {
        const mapped = comicMap.get(state.currentComic.id);
        if (mapped) {
          mapped.metadata = state.currentComic.metadata;
          mapped.tagStatus = newTag;
          if (state.currentComic.title !== undefined) mapped.title = state.currentComic.title;
          if (state.currentComic.series !== undefined) mapped.series = state.currentComic.series;
          if (typeof applyDisplayInfoFn === 'function') applyDisplayInfoFn(mapped);
        }
      }

      const updateFilterCountsFn = state.updateFilterButtonCounts || window.updateFilterButtonCounts;
      if (typeof updateFilterCountsFn === 'function') {
        updateFilterCountsFn();
      }
    }

    const setComicSummaryFn = state.setComicSummary || window.setComicSummary;
    if (typeof setComicSummaryFn === 'function') {
      setComicSummaryFn(state.currentMetadata.Summary, { preserveExpansion: true });
    }

    setTimeout(() => {
      if (statusDiv) statusDiv.textContent = '';
    }, 5000);
  } catch (error) {
    // Restore the unsaved changes flag on failure so the user is protected
    state.metadataHasUnsavedChanges = true;
    if (statusDiv) statusDiv.textContent = `Save failed: ${error.message}`;
  }
});

// --- Unsaved Changes Warning Interceptors ---
if (metadataForm) {
  metadataForm.addEventListener('input', () => {
    state.metadataHasUnsavedChanges = true;
  });
  metadataForm.addEventListener('change', () => {
    state.metadataHasUnsavedChanges = true;
  });
}

// Capturing-phase global click interceptor
document.addEventListener('click', (e) => {
  if (state.metadataHasUnsavedChanges) {
    // Allow internal clicks within the metadata panel, tab clicks, cover preview modal, and form saves to pass through
    if (
      e.target.closest('#metadata-content') ||
      e.target.closest('#metadata-tab') ||
      e.target.closest('#cover-preview-modal') ||
      e.target.closest('button[type="submit"]')
    ) {
      return;
    }

    const confirmDiscard = confirm('You have unsaved changes in metadata. Are you sure you want to discard them?');
    if (!confirmDiscard) {
      e.preventDefault();
      e.stopPropagation();
    } else {
      state.metadataHasUnsavedChanges = false;
    }
  }
}, true);

// --- Modal Dismissal via Escape Key ---
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;

  const modals = [
    { el: document.getElementById('mgmt-confirm-modal'), close: () => document.getElementById('mgmt-confirm-cancel-btn')?.click() },
    { el: document.getElementById('gemini-compliance-modal'), close: () => document.getElementById('gemini-compliance-disagree-btn')?.click() },
    { el: document.getElementById('directory-selection-modal'), close: () => document.getElementById('directory-cancel-btn')?.click() },
    { el: document.getElementById('add-to-list-modal'), close: () => document.getElementById('add-to-list-cancel-btn')?.click() },
    { el: document.getElementById('ct-modal'), close: () => (state.closeCTModal || window.closeCTModal)?.() },
    { el: document.getElementById('settings-modal'), close: () => (state.closeSettingsModal || window.closeSettingsModal)?.() },
    { el: document.getElementById('reading-list-modal'), close: () => document.getElementById('reading-list-close-btn')?.click() }
  ];

  for (const modal of modals) {
    if (modal.el && !modal.el.classList.contains('hidden')) {
      modal.close();
      break;
    }
  }
});
