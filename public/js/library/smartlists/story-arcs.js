/**
 * Story Arcs Smart List & Cache Service
 *
 * Manages fetching, caching, and button count updates for Story Arcs,
 * supporting edition filtering ('both', 'issues', 'collections').
 */
import { state } from '../../globals.js';
import { getStoryArcEditionPreference } from '../../settings/story-arc-reader-settings.js';
import { isPubMatch } from './publisher-match.js';

let storyArcsCache = new Map();
let fetchInFlight = new Map();
const SESSION_CACHE_PREFIX = 'comicsNow_storyArcs_';

function getSessionArcs(ed) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem(`${SESSION_CACHE_PREFIX}${ed}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    }
  } catch {}
  return null;
}

function setSessionArcs(ed, arcs) {
  try {
    if (typeof sessionStorage !== 'undefined' && Array.isArray(arcs) && arcs.length > 0) {
      sessionStorage.setItem(`${SESSION_CACHE_PREFIX}${ed}`, JSON.stringify(arcs));
    }
  } catch {}
}

function resolveEdition(edition) {
  if (edition && ['both', 'issues', 'collections'].includes(edition)) {
    return edition;
  }
  return typeof getStoryArcEditionPreference === 'function' ? getStoryArcEditionPreference() : 'both';
}

export async function fetchStoryArcsForPublisher(publisherName, edition = null) {
  if (!publisherName) return [];
  const ed = resolveEdition(edition);
  const cacheKey = `${publisherName}:${ed}`;

  if (storyArcsCache.has(cacheKey)) {
    return storyArcsCache.get(cacheKey);
  }
  if (fetchInFlight.has(cacheKey)) {
    return fetchInFlight.get(cacheKey);
  }

  const baseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  const promise = (async () => {
    try {
      const url = `${baseUrl}/api/v1/story-arcs?publisher=${encodeURIComponent(publisherName)}&edition=${encodeURIComponent(ed)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const arcs = (data && data.ok && Array.isArray(data.storyArcs)) ? data.storyArcs : [];
        storyArcsCache.set(cacheKey, arcs);
        updateStoryArcFilterButtonCount();
        return arcs;
      }
    } catch (err) {
      console.warn('[StoryArcs] Failed to fetch story arcs:', err);
    } finally {
      fetchInFlight.delete(cacheKey);
    }
    return [];
  })();

  fetchInFlight.set(cacheKey, promise);
  return promise;
}

export function getStoryArcsForPublisher(publisherName, edition = null) {
  if (!publisherName) return [];
  const ed = resolveEdition(edition);
  const cacheKey = `${publisherName}:${ed}`;

  if (storyArcsCache.has(cacheKey)) {
    return storyArcsCache.get(cacheKey);
  }

  const allKey = `__ALL__:${ed}`;
  if (storyArcsCache.has(allKey)) {
    const all = storyArcsCache.get(allKey);
    const filtered = all.filter(a => typeof isPubMatch === 'function' ? isPubMatch(a.publisher, publisherName) : (a.publisher || '').toLowerCase() === publisherName.toLowerCase());
    storyArcsCache.set(cacheKey, filtered);
    return filtered;
  }

  // Trigger background fetch if not yet loaded
  fetchStoryArcsForPublisher(publisherName, ed);
  return [];
}

export async function fetchAllStoryArcs(edition = null) {
  const ed = resolveEdition(edition);
  const cacheKey = `__ALL__:${ed}`;

  if (storyArcsCache.has(cacheKey)) {
    return storyArcsCache.get(cacheKey);
  }
  if (fetchInFlight.has(cacheKey)) {
    return fetchInFlight.get(cacheKey);
  }

  const baseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  const promise = (async () => {
    try {
      const url = `${baseUrl}/api/v1/story-arcs?edition=${encodeURIComponent(ed)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const arcs = (data && data.ok && Array.isArray(data.storyArcs)) ? data.storyArcs : [];
        storyArcsCache.set(cacheKey, arcs);
        setSessionArcs(ed, arcs);
        const byPub = new Map();
        for (const arc of arcs) {
          const pub = arc.publisher;
          if (pub) {
            if (!byPub.has(pub)) byPub.set(pub, []);
            byPub.get(pub).push(arc);
          }
        }
        for (const [pub, pubArcs] of byPub.entries()) {
          storyArcsCache.set(`${pub}:${ed}`, pubArcs);
        }
        updateStoryArcFilterButtonCount();
        return arcs;
      }
    } catch (err) {
      console.warn('[StoryArcs] Failed to fetch all story arcs:', err);
    } finally {
      fetchInFlight.delete(cacheKey);
    }
    return [];
  })();

  fetchInFlight.set(cacheKey, promise);
  return promise;
}

export function getAllStoryArcs(edition = null) {
  const ed = resolveEdition(edition);
  const cacheKey = `__ALL__:${ed}`;

  if (storyArcsCache.has(cacheKey)) {
    return storyArcsCache.get(cacheKey);
  }

  const sessionArcs = getSessionArcs(ed);
  if (sessionArcs) {
    storyArcsCache.set(cacheKey, sessionArcs);
    for (const arc of sessionArcs) {
      const pub = arc.publisher;
      if (pub) {
        const pKey = `${pub}:${ed}`;
        if (!storyArcsCache.has(pKey)) storyArcsCache.set(pKey, []);
        storyArcsCache.get(pKey).push(arc);
      }
    }
    return sessionArcs;
  }

  fetchAllStoryArcs(ed);
  return [];
}

function setButtonVisible(btn, isVisible) {
  if (isVisible) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

export function updateStoryArcFilterButtonCount() {
  const span = typeof document !== 'undefined' ? document.getElementById('dynamic-story-arc-filter-count') : null;
  const btn = typeof document !== 'undefined' ? document.getElementById('dynamic-story-arc-filter-btn') : null;
  if (!span || !btn) return;

  const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
  const currentPublisher = state?.currentPublisher || (typeof window !== 'undefined' ? window.currentPublisher : null);
  const currentRootFolder = state?.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null);
  const library = state?.library || (typeof window !== 'undefined' ? window.library : null);

  if (currentView === 'comics' || currentView === 'comic') {
    btn.classList.add('hidden');
    if (state.activeSmartFilter === 'story-arc') {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
    }
    return;
  }

  if (currentView === 'series') {
    if (!currentPublisher) {
      span.textContent = '0';
      setButtonVisible(btn, false);
      return;
    }
    const arcs = getStoryArcsForPublisher(currentPublisher);
    span.textContent = arcs.length.toString();
    const hasArcs = arcs.length > 0;
    setButtonVisible(btn, hasArcs);
    if (!hasArcs && state.activeSmartFilter === 'story-arc') {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
    }
    return;
  }

  if (currentView === 'publishers' || currentView === 'root') {
    const allArcs = getAllStoryArcs();
    const count = allArcs.length;
    span.textContent = count.toString();
    setButtonVisible(btn, count > 0);
    if (count === 0 && state.activeSmartFilter === 'story-arc') {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
    }
    return;
  }

  btn.classList.add('hidden');
}

export function clearStoryArcsCache() {
  storyArcsCache.clear();
  fetchInFlight.clear();
  try {
    if (typeof sessionStorage !== 'undefined') {
      ['both', 'issues', 'collections'].forEach(ed => {
        sessionStorage.removeItem(`${SESSION_CACHE_PREFIX}${ed}`);
      });
    }
  } catch {}
}
