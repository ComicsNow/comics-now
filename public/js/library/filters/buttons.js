import {
  state,
  latestAddedButton,
  downloadedButton
} from '../../globals.js';

function getLatestBtn() {
  return latestAddedButton || (typeof document !== 'undefined' ? document.getElementById('latest-added-btn') : null);
}

function getDownloadedBtn() {
  return downloadedButton || (typeof document !== 'undefined' ? document.getElementById('downloaded-btn') : null);
}

export function setLatestButtonActive(isActive) {
  const btn = getLatestBtn();
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function setDownloadedButtonActive(isActive) {
  const btn = getDownloadedBtn();
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function setGuidedButtonActive(isActive) {
  const btn = typeof document !== 'undefined' ? document.getElementById('guided-smart-list-btn') : null;
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function setMangaFilterButtonActive(isActive) {
  const btn = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-btn') : null;
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function setReadingListFilterButtonActive(isActive) {
  const btn = typeof document !== 'undefined' ? document.getElementById('dynamic-reading-list-filter-btn') : null;
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function setStoryArcFilterButtonActive(isActive) {
  const btn = typeof document !== 'undefined' ? document.getElementById('dynamic-story-arc-filter-btn') : null;
  if (!btn) return;
  btn.classList.toggle('bg-amber-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-amber-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function clearSmartFilterButtons() {
  setLatestButtonActive(false);
  setDownloadedButtonActive(false);
  setGuidedButtonActive(false);
  setMangaFilterButtonActive(false);
  setReadingListFilterButtonActive(false);
  setStoryArcFilterButtonActive(false);
}

export function syncSmartFilterButtons() {
  const scope = state.activeSmartFilter || (typeof window !== 'undefined' ? window.activeSmartFilter : null) || null;
  const isInbox = (state.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null)) === 'Smart Inbox';

  if (isInbox) {
    setLatestButtonActive(scope === 'successful');
    setDownloadedButtonActive(scope === 'failed');
    setGuidedButtonActive(false);
    setMangaFilterButtonActive(false);
    setReadingListFilterButtonActive(false);
    setStoryArcFilterButtonActive(false);
  } else {
    setLatestButtonActive(scope === 'latest');
    setDownloadedButtonActive(scope === 'downloaded');
    setGuidedButtonActive(scope === 'guided');
    setMangaFilterButtonActive(scope === 'manga' || scope === 'non-manga');
    setReadingListFilterButtonActive(scope === 'reading-list');
    setStoryArcFilterButtonActive(scope === 'story-arc');
  }
  const modeToggle = typeof document !== 'undefined' ? document.getElementById('smart-scope-mode-toggle') : null;
  if (modeToggle) {
    const activeFilter = state.activeFilter || (typeof window !== 'undefined' ? window.activeFilter : null);
    const isFilterActive = typeof activeFilter !== 'undefined' && activeFilter !== 'all';
    modeToggle.classList.toggle('hidden', !scope && !isFilterActive);
  }
}

export function mountSmartFilterHostInto(viewElement) {
  const host = typeof document !== 'undefined' ? document.getElementById('smart-filter-host') : null;
  if (!host || !viewElement) return;
  const slot = viewElement.querySelector('.smart-filter-mount');
  if (!slot) return;
  if (host.parentElement !== slot) {
    slot.appendChild(host);
  }
  host.classList.remove('hidden');
}

export function hideSmartFilterHost() {
  const host = typeof document !== 'undefined' ? document.getElementById('smart-filter-host') : null;
  if (host) host.classList.add('hidden');
}
