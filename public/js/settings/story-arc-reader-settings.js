/**
 * Story Arc Reader Edition Preferences (My Reader Scope)
 *
 * Handles per-user preference for displaying Single Issue, Collected Edition, or Both reading orders.
 */
import { clearStoryArcsCache } from '../library/smartlists/story-arcs.js';

const STORAGE_KEY = 'comicsNow_storyArcEditionFilter';

export function getStoryArcEditionPreference() {
  if (typeof localStorage === 'undefined') return 'both';
  return localStorage.getItem(STORAGE_KEY) || 'both';
}

export function setStoryArcEditionPreference(val) {
  const allowed = ['both', 'issues', 'collections'];
  const sanitized = allowed.includes(val) ? val : 'both';
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, sanitized);
  }
  updateRadioUI(sanitized);
  clearStoryArcsCache();

  // If user is currently viewing story arcs in the library, re-render view
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('storyArcEditionChanged', { detail: { edition: sanitized } }));
    const currentPublisher = window.currentPublisher || (window.state && window.state.currentPublisher);
    if (window.activeSmartFilter === 'story-arcs' && currentPublisher && typeof window.renderPublisherStoryArcs === 'function') {
      window.renderPublisherStoryArcs(currentPublisher);
    }
  }
  return sanitized;
}

function updateRadioUI(activeVal) {
  const radios = document.querySelectorAll('input[name="story-arc-edition-pref"]');
  radios.forEach((r) => {
    const isTarget = r.value === activeVal;
    r.checked = isTarget;
    const parent = r.closest('.story-arc-edition-option');
    if (parent) {
      if (isTarget) {
        parent.classList.add('border-amber-500', 'bg-amber-950/20');
        parent.classList.remove('border-gray-700', 'bg-gray-900/80');
      } else {
        parent.classList.remove('border-amber-500', 'bg-amber-950/20');
        parent.classList.add('border-gray-700', 'bg-gray-900/80');
      }
    }
  });
}

export function initStoryArcReaderSettings() {
  const current = getStoryArcEditionPreference();
  updateRadioUI(current);

  const radios = document.querySelectorAll('input[name="story-arc-edition-pref"]');
  radios.forEach((r) => {
    r.addEventListener('change', (e) => {
      if (e.target.checked) {
        setStoryArcEditionPreference(e.target.value);
      }
    });
  });
}

if (typeof window !== 'undefined') {
  window.getStoryArcEditionPreference = getStoryArcEditionPreference;
  window.setStoryArcEditionPreference = setStoryArcEditionPreference;
  window.initStoryArcReaderSettings = initStoryArcReaderSettings;
}
