/**
 * Comics Now! - Multi-Source Metadata Search API Controller
 *
 * Dispatches searches to ComicVine or external aggregators and updates pager state.
 */

import { state } from '../globals.js';
import { cvState } from './staging.js';
import { renderSourceFilterTabs, renderResultsList } from './candidate-card.js';

function clear(el) {
  if (!el) return;
  if (typeof el.replaceChildren === 'function') el.replaceChildren();
  else el.innerHTML = '';
}

export async function performCvSearch() {
  const comic = state.currentComic || window.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) {
    const statusDiv = document.getElementById('search-status') || document.getElementById('cv-status');
    if (statusDiv) {
      statusDiv.textContent = 'Metadata search is disabled for folder mode library comics.';
    }
    return;
  }

  const query     = cvState.lastQuery;
  const resources = cvState.lastResources || 'issue';
  const sort      = cvState.lastSort || '';
  const issueNumber = cvState.lastIssueNumber || '';
  const year      = cvState.lastYear || '';
  const sourceEl  = document.getElementById('search-source');
  const source    = sourceEl ? sourceEl.value : 'comicvine';

  if (!query) return;

  const statusDiv = document.getElementById('search-status') || document.getElementById('cv-status');
  const resultsUl = document.getElementById('search-results') || document.getElementById('cv-results');
  const pageInfoEl = document.getElementById('cv-page-info');
  const prevBtn = document.getElementById('cv-prev');
  const nextBtn = document.getElementById('cv-next');

  if (statusDiv) statusDiv.textContent = 'Searching across sources...';
  if (resultsUl) clear(resultsUl);
  const tabsContainer = document.getElementById('cv-source-filter-tabs');
  if (tabsContainer) tabsContainer.classList.add('hidden');

  try {
    let response;
    if (source === 'comicvine') {
      const params = new URLSearchParams({
        query,
        resources,
        page: String(cvState.page),
        limit: String(cvState.limit)
      });
      if (sort) params.set('sort', sort);
      if (issueNumber) params.set('issueNumber', issueNumber);
      if (year) params.set('year', year);
      response = await fetch(`${state.API_BASE_URL || ''}/api/v1/search/comicvine?${params.toString()}`);
    } else {
      const params = new URLSearchParams({
        source,
        query
      });
      response = await fetch(`${state.API_BASE_URL || ''}/api/v1/search/external?${params.toString()}`);
    }

    const payload  = await response.json();
    if (!response.ok) throw new Error(payload.message || 'Search failed');

    const raw     = Array.isArray(payload) ? payload : payload?.results;
    let results   = Array.isArray(raw) ? raw : [];
    results = results.filter(item => {
      const src = String(item?.source || source).toLowerCase();
      if (src === 'gcd') {
        const num = String(item?.issueNumber || item?.number || '');
        const name = String(item?.name || item?.title || '');
        if (/#?\[\s*nn\s*\]/i.test(num) || /#?\[\s*nn\s*\]/i.test(name)) {
          return false;
        }
      }
      return true;
    });
    const total   = Number.isFinite(payload?.total) ? payload.total : results.length;
    cvState.total = total;
    cvState.allResults = results;
    cvState.activeSourceFilter = 'all';

    if (source === 'comicvine') {
      const first = (cvState.page - 1) * cvState.limit + 1;
      const last  = Math.min(cvState.page * cvState.limit, total);
      if (statusDiv) {
        statusDiv.textContent = `${total} results found.`;
      }
      if (pageInfoEl) {
        pageInfoEl.textContent = total
          ? `Showing ${first}-${last} • Page ${cvState.page} of ${Math.max(1, Math.ceil(total / cvState.limit))}`
          : 'No results';
      }
      if (prevBtn) prevBtn.disabled = cvState.page <= 1;
      if (nextBtn) nextBtn.disabled = cvState.page >= Math.ceil(total / cvState.limit) || total === 0;
    } else {
      if (statusDiv) {
        statusDiv.textContent = `${results.length} results found across sources.`;
      }
      if (pageInfoEl) {
        pageInfoEl.textContent = results.length ? `${results.length} total results` : 'No results';
      }
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    }

    renderSourceFilterTabs(results);
    renderResultsList();
  } catch (err) {
    if (statusDiv) {
      statusDiv.textContent = `Search failed: ${err.message || err}`;
    }
    if (pageInfoEl) pageInfoEl.textContent = '';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
  }
}
