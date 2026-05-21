import { state } from '../globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

  function resetComicSummary() {
    if (global.comicSummarySection) {
      global.comicSummarySection.classList.add('hidden');
    }
    if (global.comicSummaryToggle) {
      global.comicSummaryToggle.textContent = 'Show Summary';
      global.comicSummaryToggle.setAttribute('aria-expanded', 'false');
    }
    if (global.comicSummaryContent) {
      global.comicSummaryContent.textContent = '';
      global.comicSummaryContent.classList.add('hidden');
    }
  }

  function setComicSummary(summaryText, options = {}) {
    if (!global.comicSummarySection || !global.comicSummaryToggle || !global.comicSummaryContent) return;

    if (!summaryText || summaryText.trim() === '') {
      global.comicSummarySection.classList.add('hidden');
      return;
    }

    global.comicSummarySection.classList.remove('hidden');
    global.comicSummaryContent.textContent = summaryText;

    if (!options.preserveExpansion) {
      global.comicSummaryContent.classList.add('hidden');
      global.comicSummaryToggle.textContent = 'Show Summary';
      global.comicSummaryToggle.setAttribute('aria-expanded', 'false');
    }
  }

  async function loadComicSummary() {
    const comic = global.currentComic;
    if (!comic) return;

    // Local/device comics don't have server-side metadata/summaries
    const isLocal = comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-'));
    if (isLocal) {
      setComicSummary('');
      return;
    }

    try {
      const response = await fetch(`${global.API_BASE_URL || ''}/api/v1/comics/info?path=${encodeURIComponent(global.encodePath ? global.encodePath(comic.path) : comic.path)}`);
      if (response.ok) {
        const metadata = await response.json();
        global.currentMetadata = metadata;
        setComicSummary(metadata.Summary);
      } else {
        setComicSummary('');
      }
    } catch (error) {
      console.error('[VIEWER] Failed to load comic summary:', error);
      setComicSummary('');
    }
  }

  global.resetComicSummary = resetComicSummary;
  global.setComicSummary = setComicSummary;
  global.loadComicSummary = loadComicSummary;

export {
  resetComicSummary,
  setComicSummary,
  loadComicSummary
};

state.resetComicSummary = resetComicSummary;
state.setComicSummary = setComicSummary;
state.loadComicSummary = loadComicSummary;

if (typeof window !== 'undefined') {
  window.resetComicSummary = resetComicSummary;
  window.setComicSummary = setComicSummary;
  window.loadComicSummary = loadComicSummary;
}
