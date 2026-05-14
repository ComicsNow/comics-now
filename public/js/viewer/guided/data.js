(function (global) {
  'use strict';

  global.GuidedView = global.GuidedView || {};

  const cache = new Map(); // comicId -> data | null

  function api(p) {
    const base = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '') || '';
    return `${base}${p}`;
  }

  async function loadGuidedView(comicId) {
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

  function currentPagePanels() {
    const comic = global.currentComic;
    if (!comic) return [];
    const data = cache.get(comic.id);
    if (!data || !data.pages) return [];
    const pages = global.getViewerPages?.() || [];
    const fname = pages[global.currentPageIndex];
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

  function currentPageBubbles() {
    const comic = global.currentComic;
    if (!comic) return [];
    const data = cache.get(comic.id);
    if (!data || !data.pages) return [];
    const pages = global.getViewerPages?.() || [];
    const fname = pages[global.currentPageIndex];
    if (!fname) return [];
    
    const pageData = data.pages[fname];
    if (pageData && Array.isArray(pageData.bubbles)) return pageData.bubbles;
    return [];
  }

  // Raw boxes from the manga model (panels + bubbles mixed, pre-sequencing).
  // For manga sidecars, `panels` field holds the full unfiltered detection set.
  function currentPageRawBoxes() {
    const comic = global.currentComic;
    if (!comic) return [];
    const data = cache.get(comic.id);
    if (!data || !data.pages) return [];
    const pages = global.getViewerPages?.() || [];
    const fname = pages[global.currentPageIndex];
    if (!fname) return [];
    const pd = data.pages[fname];
    if (pd && Array.isArray(pd.panels)) return pd.panels;
    return [];
  }

  function isMangaComic() {
    const c = global.currentComic;
    return !!(c && (c.mangaMode === true || c.mangaMode == 1));
  }

  // Flat list of speech-bubble boxes for the current manga page.
  function mangaPageBubbles() {
    const out = [];
    const panels = global.GuidedView.classifyMangaPage();
    for (const p of panels) for (const b of p.bubbles) out.push(b);
    return out;
  }

  global.GuidedView.cache = cache;
  global.GuidedView.loadGuidedView = loadGuidedView;
  global.GuidedView.currentPagePanels = currentPagePanels;
  global.GuidedView.currentPageBubbles = currentPageBubbles;
  global.GuidedView.currentPageRawBoxes = currentPageRawBoxes;
  global.GuidedView.isMangaComic = isMangaComic;
  global.GuidedView.mangaPageBubbles = mangaPageBubbles;
  global.GuidedView.api = api; // Useful for index.js as well

})(typeof window !== 'undefined' ? window : globalThis);
