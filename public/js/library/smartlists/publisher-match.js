import { state } from '../../globals.js';

export const PUB_SUFFIX_REGEX = /\b(comics?|publishing|press|studios?|books?|entertainment|productions?|inc|llc|ltd)\b/gi;

export function normalizePub(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function stemPublisher(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(PUB_SUFFIX_REGEX, ' ')
    .replace(/[^a-z0-9]/g, '');
}

export function isPubMatch(pubA, pubB) {
  if (!pubA || !pubB) return false;
  const normA = normalizePub(pubA);
  const normB = normalizePub(pubB);
  if (normA && normB && normA === normB) return true;
  const stemA = stemPublisher(pubA);
  const stemB = stemPublisher(pubB);
  if (stemA && stemB && stemA === stemB) return true;
  return false;
}

export function matchesPublisher(list, publisherName) {
  if (!list || !publisherName) return false;

  // 1. Direct or stem match against list.publishers
  if (Array.isArray(list.publishers)) {
    for (const p of list.publishers) {
      if (isPubMatch(p, publisherName)) return true;
    }
  }

  // 2. Name prefix match e.g. "DC: ..." or "Dark Horse: ..." or "Image: ..." or "Boom! Studios: ..."
  const listName = String(list.name || '');
  const colonIdx = listName.indexOf(':');
  if (colonIdx > 0) {
    const prefix = listName.substring(0, colonIdx).trim();
    if (isPubMatch(prefix, publisherName)) return true;
    // Also support prefix variations like "DC Event: ..." matching "DC Comics"
    const prefixStem = stemPublisher(prefix);
    const targetStem = stemPublisher(publisherName);
    if (prefixStem && targetStem && (prefixStem === targetStem || prefixStem.startsWith(targetStem))) {
      return true;
    }
  }

  // 3. Fallback: whole word boundary matching of target publisher in list name
  const cleanTarget = String(publisherName).trim();
  if (cleanTarget.length >= 2) {
    const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordPattern = new RegExp('\\b' + escaped + '\\b', 'i');
    if (wordPattern.test(listName)) return true;

    // Check stemmed target (e.g. "Dark Horse" from "Dark Horse Comics") as whole word
    const stem = stemPublisher(cleanTarget);
    if (stem.length >= 3) {
      const stemPattern = new RegExp('\\b' + stem + '\\b', 'i');
      if (stemPattern.test(listName)) return true;
    }
  }

  return false;
}

let cachedReadingLists = [];
let readingListsLoaded = false;
let readingListsFetchInFlight = null;

export function maybeFetchReadingLists() {
  if (readingListsLoaded || readingListsFetchInFlight) return;
  fetchAndCacheReadingLists();
}

export async function fetchAndCacheReadingLists() {
  if (readingListsFetchInFlight) return readingListsFetchInFlight;

  const inFlight = (async () => {
    try {
      const fetchLists = (state?.ReadingLists || (typeof window !== 'undefined' ? window.ReadingLists : null))?.fetchReadingLists;
      if (typeof fetchLists === 'function') {
        cachedReadingLists = await fetchLists();
      } else {
        const resp = await fetch('/api/v1/reading-lists');
        const data = await resp.json();
        if (data && data.ok) {
          cachedReadingLists = data.lists || [];
        }
      }
    } catch (err) {
      console.warn('[smartlists] Error caching reading lists:', err);
    } finally {
      readingListsLoaded = true;
      readingListsFetchInFlight = null;
    }

    updateReadingListFilterButtonCount();

    const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
    const scope = state?.activeSmartFilter || (typeof window !== 'undefined' ? window.activeSmartFilter : null);
    if (scope === 'reading-list' && (currentView === 'publishers' || currentView === 'series')) {
      const applyFilter = state?.applyFilterAndRender || (typeof window !== 'undefined' ? window.applyFilterAndRender : null) || state?.LibraryRender?.applyFilterAndRender;
      if (typeof applyFilter === 'function') {
        applyFilter();
      }
    }

    return cachedReadingLists;
  })();

  readingListsFetchInFlight = inFlight;
  return inFlight;
}

export function getCachedReadingLists() {
  return cachedReadingLists;
}

export function setCachedReadingLists(lists) {
  cachedReadingLists = Array.isArray(lists) ? lists : [];
  readingListsLoaded = true;
  updateReadingListFilterButtonCount();
}

export function getReadingListsForPublisher(publisherName) {
  if (!publisherName) return [];
  if (cachedReadingLists.length === 0) {
    maybeFetchReadingLists();
  }
  return cachedReadingLists.filter(list => matchesPublisher(list, publisherName));
}

export function updateReadingListFilterButtonCount() {
  const span = typeof document !== 'undefined' ? document.getElementById('dynamic-reading-list-filter-count') : null;
  const btn = typeof document !== 'undefined' ? document.getElementById('dynamic-reading-list-filter-btn') : null;
  if (!span || !btn) return;

  const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
  const currentPublisher = state?.currentPublisher || (typeof window !== 'undefined' ? window.currentPublisher : null);
  const currentRootFolder = state?.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null);
  const library = state?.library || (typeof window !== 'undefined' ? window.library : null);

  if (cachedReadingLists.length === 0) {
    maybeFetchReadingLists();
  }

  if (currentView === 'comics' || currentView === 'comic') {
    btn.classList.add('hidden');
    if (state.activeSmartFilter === 'reading-list') {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
    }
    return;
  }

  if (currentView === 'series') {
    if (!currentPublisher) {
      span.textContent = '0';
      btn.classList.add('hidden');
      return;
    }
    const matchingLists = getReadingListsForPublisher(currentPublisher);
    span.textContent = matchingLists.length.toString();
    const hasLists = matchingLists.length > 0;
    btn.classList.toggle('hidden', !hasLists);
    if (!hasLists && state.activeSmartFilter === 'reading-list') {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
    }
    return;
  }

  if (currentView === 'publishers' || currentView === 'root') {
    const count = cachedReadingLists.length;
    span.textContent = count.toString();
    btn.classList.toggle('hidden', count === 0);
    if (count === 0 && state.activeSmartFilter === 'reading-list') {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
    }
    return;
  }

  btn.classList.add('hidden');
}
