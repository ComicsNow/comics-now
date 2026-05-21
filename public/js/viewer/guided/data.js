import { state } from '../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

export const cache = new Map(); // comicId -> data | null

export function api(p) {
  const base = state.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  return `${base}${p}`;
}

export async function loadGuidedView(comicId) {
  if (!comicId) return null;
  if (cache.has(comicId)) return cache.get(comicId);
  try {
    const res = await fetch(api(`/api/v1/comics/${encodeURIComponent(comicId)}/guided-view`));
    if (!res.ok) { cache.set(comicId, null); return null; }
    const data = await res.json();
    cache.set(comicId, data);
    return data;
  } catch {
    cache.set(comicId, null);
    return null;
  }
}

export function currentPagePanels() {
  const comic = state.currentComic || window.currentComic;
  if (!comic) return [];
  const data = cache.get(comic.id);
  if (!data || !data.pages) return [];
  const getPages = state.getViewerPages || window.getViewerPages;
  const pages = getPages?.() || [];
  const pageIndex = (state.currentPageIndex !== undefined && state.currentPageIndex !== null) ? state.currentPageIndex : window.currentPageIndex;
  const fname = pages[pageIndex];
  if (!fname) return [];
  
  // Handle multiple schema versions
  const pageData = data.pages[fname];
  if (Array.isArray(pageData)) return pageData;
  if (pageData) {
    // Prioritize granular sequence if available
    if (Array.isArray(pageData.sequence) && pageData.sequence.length > 0) return pageData.sequence;
    if (Array.isArray(pageData.panels)) return pageData.panels;
  }
  return [];
}

export function currentPageBubbles() {
  const comic = state.currentComic || window.currentComic;
  if (!comic) return [];
  const data = cache.get(comic.id);
  if (!data || !data.pages) return [];
  const getPages = state.getViewerPages || window.getViewerPages;
  const pages = getPages?.() || [];
  const pageIndex = (state.currentPageIndex !== undefined && state.currentPageIndex !== null) ? state.currentPageIndex : window.currentPageIndex;
  const fname = pages[pageIndex];
  if (!fname) return [];
  
  const pageData = data.pages[fname];
  if (pageData && Array.isArray(pageData.bubbles)) return pageData.bubbles;
  return [];
}

// Raw boxes from the manga model (panels + bubbles mixed, pre-sequencing).
// For manga sidecars, `panels` field holds the full unfiltered detection set.
export function currentPageRawBoxes() {
  const comic = state.currentComic || window.currentComic;
  if (!comic) return [];
  const data = cache.get(comic.id);
  if (!data || !data.pages) return [];
  const getPages = state.getViewerPages || window.getViewerPages;
  const pages = getPages?.() || [];
  const pageIndex = (state.currentPageIndex !== undefined && state.currentPageIndex !== null) ? state.currentPageIndex : window.currentPageIndex;
  const fname = pages[pageIndex];
  if (!fname) return [];
  const pd = data.pages[fname];
  if (pd && Array.isArray(pd.panels)) return pd.panels;
  return [];
}

export function isMangaComic() {
  const c = state.currentComic || window.currentComic;
  return !!(c && (c.mangaMode === true || c.mangaMode == 1));
}

// Flat list of speech-bubble boxes for the current manga page.
export function mangaPageBubbles() {
  const out = [];
  const panels = state.GuidedView.classifyMangaPage();
  for (const p of panels) for (const b of p.bubbles) out.push(b);
  return out;
}

// Assign to state.GuidedView and window.GuidedView
Object.assign(state.GuidedView, {
  cache,
  loadGuidedView,
  currentPagePanels,
  currentPageBubbles,
  currentPageRawBoxes,
  isMangaComic,
  mangaPageBubbles,
  api
});

if (typeof window !== 'undefined') {
  Object.assign(window.GuidedView, {
    cache,
    loadGuidedView,
    currentPagePanels,
    currentPageBubbles,
    currentPageRawBoxes,
    isMangaComic,
    mangaPageBubbles,
    api
  });
}
