/**
 * Context Menu action: run an automated Tag Comics Now search for one comic.
 * Admin-only because the run writes metadata to the file and database.
 */
import { state } from '../globals.js';
import { createMenuItem } from './actions-shared.js';

const RUN_FILE_ENDPOINT = '/api/v1/tag-comics-now/run-file';
const SEARCH_ICON = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"/></svg>';

let inFlightComicId = null;

function isAdmin() {
  const syncManager = (typeof window !== 'undefined' && window.syncManager) || state.syncManager;
  return Boolean(syncManager && syncManager.userRole === 'admin');
}

function isLocalComic(comic) {
  return Boolean(comic && (
    comic.handle ||
    comic.file ||
    (comic.id && String(comic.id).startsWith('device-'))
  ));
}

function openReviewUi() {
  if (typeof window !== 'undefined' && typeof window.openCTModal === 'function') {
    window.openCTModal();
  }
  if (typeof document !== 'undefined') {
    const matchesTab = document.getElementById('ct-tab-matches');
    if (matchesTab) matchesTab.click();
  }
}

function notify(message) {
  if (typeof alert === 'function') alert(message);
}

function askForceRetry() {
  if (typeof confirm !== 'function') return false;
  return confirm('This comic already has complete metadata. Run a forced tag search anyway?');
}

async function postTagSearch(comicId, force) {
  const base = state.API_BASE_URL || '';
  const response = await fetch(`${base}${RUN_FILE_ENDPOINT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comicId, force: Boolean(force) })
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function runTagSearchForComic(comic) {
  if (!comic || !comic.id) return null;
  if (inFlightComicId) {
    notify('A tag search is already running. Wait for it to finish.');
    return null;
  }

  inFlightComicId = comic.id;
  try {
    let { response, data } = await postTagSearch(comic.id, false);

    if (response.status === 409 && data.code === 'review_pending') {
      openReviewUi();
      return data;
    }

    if (!response.ok) {
      notify(data.message || 'Tag search could not be started.');
      return data;
    }

    if (data.status === 'review') {
      openReviewUi();
      return data;
    }

    if (data.status === 'skipped' && askForceRetry()) {
      ({ response, data } = await postTagSearch(comic.id, true));
      if (!response.ok) {
        notify(data.message || 'Forced tag search could not be started.');
        return data;
      }
      if (data.status === 'review') openReviewUi();
      return data;
    }

    if (data.status === 'failed') {
      notify(data.reason || data.message || `No match found for ${comic.name || 'this comic'}.`);
      return data;
    }

    if (data.status === 'tagged' && typeof state.refreshLibrary === 'function') {
      await state.refreshLibrary();
    }

    return data;
  } catch (err) {
    notify(`Tag search failed: ${err.message || err}`);
    return null;
  } finally {
    inFlightComicId = null;
  }
}

function createTagSearchItem(comic) {
  if (!comic || !comic.id || isLocalComic(comic) || !isAdmin()) return null;

  return createMenuItem(`${SEARCH_ICON}<span>Tag Search</span>`, async () => {
    await runTagSearchForComic(comic);
  });
}

// Named exports
export { createTagSearchItem, runTagSearchForComic };

// Register on state for cross-module access
state.createTagSearchItem = createTagSearchItem;
