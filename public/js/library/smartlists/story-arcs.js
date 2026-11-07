/**
 * Story Arcs Smart List & Cache Service
 *
 * Manages fetching, caching, and button count updates for Story Arcs,
 * supporting edition filtering ('both', 'issues', 'collections').
 */
import { state } from '../../globals.js';
import { getStoryArcEditionPreference } from '../../settings/story-arc-reader-settings.js';

let storyArcsCache = new Map();
let fetchInFlight = new Map();

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
  // Trigger background fetch if not yet loaded
  fetchStoryArcsForPublisher(publisherName, ed);
  return [];
}

export function updateStoryArcFilterButtonCount() {
  const span = typeof document !== 'undefined' ? document.getElementById('dynamic-story-arc-filter-count') : null;
  const btn = typeof document !== 'undefined' ? document.getElementById('dynamic-story-arc-filter-btn') : null;
  if (!span || !btn) return;

  const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
  const currentPublisher = state?.currentPublisher || (typeof window !== 'undefined' ? window.currentPublisher : null);

  if (currentView === 'series' && currentPublisher) {
    const arcs = getStoryArcsForPublisher(currentPublisher);
    span.textContent = arcs.length.toString();
    btn.classList.toggle('hidden', arcs.length === 0);
    return;
  }

  btn.classList.add('hidden');
}

export function clearStoryArcsCache() {
  storyArcsCache.clear();
  fetchInFlight.clear();
}
