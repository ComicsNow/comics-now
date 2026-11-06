/**
 * Story Arcs Smart List & Cache Service
 *
 * Manages fetching, caching, and button count updates for Story Arcs.
 */
import { state } from '../../globals.js';
import { isPubMatch } from './publisher-match.js';

let storyArcsCache = new Map();
let fetchInFlight = new Map();

export async function fetchStoryArcsForPublisher(publisherName) {
  if (!publisherName) return [];
  if (storyArcsCache.has(publisherName)) {
    return storyArcsCache.get(publisherName);
  }
  if (fetchInFlight.has(publisherName)) {
    return fetchInFlight.get(publisherName);
  }

  const baseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  const promise = (async () => {
    try {
      const res = await fetch(`${baseUrl}/api/v1/story-arcs?publisher=${encodeURIComponent(publisherName)}`);
      if (res.ok) {
        const data = await res.json();
        const arcs = (data && data.ok && Array.isArray(data.storyArcs)) ? data.storyArcs : [];
        storyArcsCache.set(publisherName, arcs);
        updateStoryArcFilterButtonCount();
        return arcs;
      }
    } catch (err) {
      console.warn('[StoryArcs] Failed to fetch story arcs:', err);
    } finally {
      fetchInFlight.delete(publisherName);
    }
    return [];
  })();

  fetchInFlight.set(publisherName, promise);
  return promise;
}

export function getStoryArcsForPublisher(publisherName) {
  if (!publisherName) return [];
  if (storyArcsCache.has(publisherName)) {
    return storyArcsCache.get(publisherName);
  }
  // Trigger background fetch if not yet loaded
  fetchStoryArcsForPublisher(publisherName);
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
