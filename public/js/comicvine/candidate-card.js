/**
 * Comics Now! - Search Candidate Cards & Results Display
 *
 * Renders candidate cards, source filter tabs, and handles candidate metadata application.
 */

import { state, escapeHtml } from '../globals.js';
import { getSourceInfo } from './source-info.js';
import { openCoverPreviewModal } from './cover-preview.js';
import { cvState, isSourceStaged, toggleStageSource, renderStagingTray } from './staging.js';

function clear(el) {
  if (!el) return;
  if (typeof el.replaceChildren === 'function') el.replaceChildren();
  else el.innerHTML = '';
}

export function renderMetadataDisplay(metadata, clearForm = true) {
  if (typeof state.renderMetadataDisplay === 'function') {
    state.renderMetadataDisplay(metadata, clearForm);
  } else if (typeof window.renderMetadataDisplay === 'function') {
    window.renderMetadataDisplay(metadata, clearForm);
  } else {
    console.warn('renderMetadataDisplay not registered yet.');
  }
}

export function sanitizeMetadata(metadata) {
  if (typeof state.sanitizeMetadata === 'function') {
    return state.sanitizeMetadata(metadata);
  } else if (typeof window.sanitizeMetadata === 'function') {
    return window.sanitizeMetadata(metadata);
  }
  return metadata;
}

export function renderSourceFilterTabs(results) {
  const tabsContainer = document.getElementById('cv-source-filter-tabs');
  if (!tabsContainer) return;
  clear(tabsContainer);

  if (!results || results.length === 0) {
    tabsContainer.classList.add('hidden');
    return;
  }

  const sourceCounts = {};
  for (const r of results) {
    const src = (r.source || 'other').toLowerCase();
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }

  const distinctSources = Object.keys(sourceCounts);
  if (distinctSources.length <= 1) {
    tabsContainer.classList.add('hidden');
    return;
  }

  tabsContainer.classList.remove('hidden');

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  const isAllActive = (cvState.activeSourceFilter || 'all') === 'all';
  allBtn.className = `px-2.5 py-1 text-xs font-semibold rounded-full transition-colors cursor-pointer ${
    isAllActive
      ? 'bg-red-600 text-white shadow-xs'
      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
  }`;
  allBtn.textContent = `All (${results.length})`;
  allBtn.addEventListener('click', () => {
    cvState.activeSourceFilter = 'all';
    renderSourceFilterTabs(cvState.allResults);
    renderResultsList();
  });
  tabsContainer.appendChild(allBtn);

  for (const src of distinctSources) {
    const info = getSourceInfo(src);
    const count = sourceCounts[src];
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = cvState.activeSourceFilter === src;
    btn.className = `px-2.5 py-1 text-xs font-semibold rounded-full transition-colors cursor-pointer ${
      isActive
        ? 'bg-red-600 text-white shadow-xs'
        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
    }`;
    btn.textContent = `${info.name} (${count})`;
    btn.addEventListener('click', () => {
      cvState.activeSourceFilter = src;
      renderSourceFilterTabs(cvState.allResults);
      renderResultsList();
    });
    tabsContainer.appendChild(btn);
  }
}

export function renderResultsList() {
  const resultsUl = document.getElementById('search-results') || document.getElementById('cv-results');
  if (!resultsUl) return;
  clear(resultsUl);

  const filter = cvState.activeSourceFilter || 'all';
  const filtered = filter === 'all'
    ? (cvState.allResults || [])
    : (cvState.allResults || []).filter(r => (r.source || 'other').toLowerCase() === filter);

  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'text-sm text-gray-400 p-4 text-center';
    li.textContent = 'No matching results for selected source.';
    resultsUl.appendChild(li);
    return;
  }

  for (const result of filtered) {
    const li = document.createElement('li');
    li.className = 'flex flex-col bg-gray-700 p-2 rounded-lg hover:bg-gray-600';

    const isIssue = result.type === 'issue';
    const displayName = isIssue
      ? `${result.name || result.volumeName || 'Unknown'}${result.issueNumber ? ` #${result.issueNumber}` : ''}`
      : `${result.name || 'Unknown'}`;

    const srcInfo = getSourceInfo(result.source || (isIssue ? 'comicvine' : 'volume'));
    const badgeHtml = isIssue
      ? `<span class="ml-2 text-[10px] px-2 py-0.5 rounded-full ${srcInfo.badgeBg} text-white font-medium">${escapeHtml(srcInfo.name.toUpperCase())}</span>`
      : '<span class="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-blue-600 text-white font-medium">VOLUME</span>';

    const subtitleParts = [];
    if (isIssue) {
      if (result.volumeName) subtitleParts.push(result.volumeName);
      if (result.publisher)  subtitleParts.push(result.publisher);
      if (result.coverDate)  subtitleParts.push(result.coverDate);
    } else {
      if (result.publisher)  subtitleParts.push(result.publisher);
      if (result.startYear)  subtitleParts.push(result.startYear);
    }
    const subtitle = subtitleParts.join(' • ');
    const coverUrl = result.image?.thumb_url || '';

    const baseRow = document.createElement('div');
    baseRow.className = 'flex items-center space-x-3 cursor-pointer';
    baseRow.innerHTML = `
      ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="cover" class="w-10 h-14 object-cover rounded shrink-0 hover:brightness-110 transition-all shadow hover:shadow-lg" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'56\\' viewBox=\\'0 0 40 56\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23374151\\'/><rect x=\\'2\\' y=\\'2\\' width=\\'36\\' height=\\'52\\' fill=\\'none\\' stroke=\\'%234b5563\\' rx=\\'2\\'/><text x=\\'50%\\' y=\\'50%\\' fill=\\'%239ca3af\\' font-size=\\'7\\' font-family=\\'sans-serif\\' text-anchor=\\'middle\\' dominant-baseline=\\'middle\\'>NO COVER</text></svg>';"/>` : `<div class="w-10 h-14 bg-gray-800 rounded shrink-0 flex items-center justify-center border border-gray-700 shadow"><span class="text-[9px] text-gray-400 font-bold">NO COVER</span></div>`}
      <div class="flex-1 min-w-0">
        <span class="font-bold block truncate">${escapeHtml(displayName)}${badgeHtml}</span>
        <span class="text-sm text-gray-400 block truncate">${escapeHtml(subtitle)}</span>
      </div>
    `;

    const coverImg = baseRow.querySelector('img');
    if (coverImg) {
      coverImg.addEventListener('click', (e) => {
        e.stopPropagation();
        const previewUrl = result.image?.medium_url || result.image?.super_url || result.image?.original_url || coverUrl;
        openCoverPreviewModal(previewUrl, displayName);
      });
    }

    baseRow.appendChild(createStageBtn(result, false));

    baseRow.addEventListener('click', () => {
      if (result.fullMetadata) {
        sanitizeMetadata(result.fullMetadata);
        renderMetadataDisplay(result.fullMetadata, true);
        state.metadataHasUnsavedChanges = true;
        notifyMetadataApplied(displayName, li);
      } else {
        if (isIssue) {
          applyIssueMetadataFromSearch(result.id, displayName, li);
        } else {
          applyMetadataFromSearch(result.id, displayName, li);
        }
      }
    });

    li.appendChild(baseRow);

    if (!isIssue) {
      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = 'Show Issues';
      toggleBtn.className = 'ml-14 mt-2 text-xs text-purple-400 hover:underline self-start';
      let expanded = false;
      let loaded = false;

      const issueList = document.createElement('ul');
      issueList.className = 'ml-14 mt-2 space-y-1 hidden';

      toggleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        expanded = !expanded;
        
        if (expanded) {
          if (!loaded) {
            toggleBtn.textContent = 'Loading Issues...';
            toggleBtn.disabled = true;
            try {
              const res = await fetch(`${state.API_BASE_URL || ''}/api/v1/comicvine/volume/${result.id}/issues`);
              const issues = await res.json();
              if (!res.ok) throw new Error(issues.message || 'Failed to fetch issues');

              clear(issueList);
              if (Array.isArray(issues) && issues.length > 0) {
                for (const issue of issues) {
                  const issueLi = document.createElement('li');
                  issueLi.className = 'flex items-center bg-gray-600 p-2 rounded cursor-pointer hover:bg-gray-500 space-x-2';

                  const issueCoverUrl = issue.image?.thumb_url || '';
                  const issueSubtitleParts = [];
                  if (issue.volumeName) issueSubtitleParts.push(issue.volumeName);
                  if (issue.publisher)  issueSubtitleParts.push(issue.publisher);
                  if (issue.coverDate)  issueSubtitleParts.push(issue.coverDate);
                  const issueSubtitle = issueSubtitleParts.join(' • ');
                  const issueDisplayName = `${issue.name || 'Unknown'}${issue.issueNumber ? ` #${issue.issueNumber}` : ''}`;

                  issueLi.innerHTML = `
                    ${issueCoverUrl ? `<img src="${escapeHtml(issueCoverUrl)}" class="w-8 h-12 object-cover rounded shrink-0 hover:brightness-110 transition-all shadow" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'32\\' height=\\'48\\' viewBox=\\'0 0 32 48\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23374151\\'/><rect x=\\'2\\' y=\\'2\\' width=\\'28\\' height=\\'44\\' fill=\\'none\\' stroke=\\'%234b5563\\' rx=\\'2\\'/><text x=\\'50%\\' y=\\'50%\\' fill=\\'%239ca3af\\' font-size=\\'6\\' font-family=\\'sans-serif\\' text-anchor=\\'middle\\' dominant-baseline=\\'middle\\'>NO COVER</text></svg>';"/>` : `<div class="w-8 h-12 bg-gray-700 rounded shrink-0 flex items-center justify-center border border-gray-600 shadow"><span class="text-[9px] text-gray-400 font-bold">NO COVER</span></div>`}
                    <div class="flex-1 min-w-0">
                      <span class="font-bold block truncate">${escapeHtml(issueDisplayName)}</span>
                      <span class="text-sm text-gray-400 block truncate">${escapeHtml(issueSubtitle)}</span>
                    </div>
                  `;

                  const itemImg = issueLi.querySelector('img');
                  if (itemImg) {
                    itemImg.addEventListener('click', (ev) => {
                      ev.stopPropagation();
                      const previewUrl = issue.image?.medium_url || issue.image?.super_url || issue.image?.original_url || issueCoverUrl;
                      openCoverPreviewModal(previewUrl, issueDisplayName);
                    });
                  }

                  const issueItem = { ...issue, source: 'comicvine', type: 'issue' };
                  issueLi.appendChild(createStageBtn(issueItem, true));
                  issueLi.addEventListener('click', () => applyIssueMetadataFromSearch(issue.id, issueDisplayName, issueLi));
                  issueList.appendChild(issueLi);
                }
              } else {
                const noIssuesLi = document.createElement('li');
                noIssuesLi.className = 'text-xs text-gray-400 p-2';
                noIssuesLi.textContent = 'No issues found for this volume.';
                issueList.appendChild(noIssuesLi);
              }
              loaded = true;
            } catch (err) {
              console.error(err);
              toggleBtn.textContent = 'Error loading issues';
              expanded = false;
              toggleBtn.disabled = false;
              return;
            }
            toggleBtn.disabled = false;
          }
          toggleBtn.textContent = 'Hide Issues';
          issueList.classList.remove('hidden');
        } else {
          toggleBtn.textContent = 'Show Issues';
          issueList.classList.add('hidden');
        }
      });

      li.appendChild(toggleBtn);
      li.appendChild(issueList);
    }

    resultsUl.appendChild(li);
  }

  renderStagingTray();
}

function createStageBtn(item, compact = false) {
  const staged = isSourceStaged(item);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn._sourceItem = item;
  const pad = compact ? 'px-2 py-0.5' : 'px-2.5 py-1';
  btn.className = `stage-source-btn shrink-0 ml-2 ${pad} text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
    staged ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50 shadow-xs' : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-600'
  }`;
  btn.innerHTML = staged
    ? `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span>✓ Staged</span>`
    : `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg><span>+ Stage</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStageSource(item);
  });
  return btn;
}

function notifyMetadataApplied(label, selectedEl) {
  const name = label || 'selected result';
  const resultsUl = document.getElementById('search-results') || document.getElementById('cv-results');
  if (resultsUl) {
    resultsUl.querySelectorAll('.selected-search-result').forEach(el => {
      el.classList.remove('selected-search-result', 'ring-2', 'ring-green-500');
      el.querySelector('.applied-result-badge')?.remove();
    });
  }
  if (selectedEl) {
    selectedEl.classList.add('selected-search-result', 'ring-2', 'ring-green-500');
    const titleEl = selectedEl.querySelector('.font-bold');
    if (titleEl && !titleEl.querySelector('.applied-result-badge')) {
      const badge = document.createElement('span');
      badge.className = 'applied-result-badge ml-2 text-[10px] px-2 py-0.5 rounded-full bg-green-600 text-white font-semibold';
      badge.textContent = '✓ Applied';
      titleEl.appendChild(badge);
    }
  }
  const searchStatusDiv = document.getElementById('search-status') || document.getElementById('cv-status');
  if (searchStatusDiv) {
    searchStatusDiv.className = 'text-sm text-green-400 font-medium mt-2';
    searchStatusDiv.textContent = `✓ Applied metadata from "${name}" — click Save Changes to save.`;
  }
  const saveStatusDiv = document.getElementById('save-status');
  if (saveStatusDiv) {
    saveStatusDiv.className = 'text-sm text-green-400 font-medium mb-2';
    saveStatusDiv.textContent = `✓ Loaded metadata from "${name}" (unsaved — click Save Changes below).`;
  }
  const metaForm = document.getElementById('metadata-form-container') || document.getElementById('metadata-form');
  if (metaForm && typeof metaForm.scrollIntoView === 'function') {
    metaForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

export async function applyMetadataFromSearch(volumeId, label = '', selectedEl = null) {
  const comic = state.currentComic || window.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) return;

  const searchStatusDiv = document.getElementById('search-status') || document.getElementById('cv-status');
  if (searchStatusDiv) searchStatusDiv.textContent = 'Fetching details...';
  try {
    const response = await fetch(`${state.API_BASE_URL || ''}/api/v1/comicvine/volume/${volumeId}`);
    if (!response.ok) throw new Error('Could not fetch details.');
    const detailedMetadata = await response.json();
    sanitizeMetadata(detailedMetadata);
    renderMetadataDisplay(detailedMetadata, true);
    state.metadataHasUnsavedChanges = true;
    const displayLabel = label || detailedMetadata.Series || detailedMetadata.Title || `Volume #${volumeId}`;
    notifyMetadataApplied(displayLabel, selectedEl);
  } catch (error) {
    if (searchStatusDiv) searchStatusDiv.textContent = `Error: ${error.message}`;
  }
}

export async function applyIssueMetadataFromSearch(issueId, label = '', selectedEl = null) {
  const comic = state.currentComic || window.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) return;

  const searchStatusDiv = document.getElementById('search-status') || document.getElementById('cv-status');
  if (searchStatusDiv) searchStatusDiv.textContent = 'Fetching issue details...';
  try {
    const response = await fetch(`${state.API_BASE_URL || ''}/api/v1/comicvine/issue/${issueId}`);
    if (!response.ok) throw new Error('Could not fetch issue details.');
    const detailedMetadata = await response.json();
    sanitizeMetadata(detailedMetadata);
    renderMetadataDisplay(detailedMetadata, true);
    state.metadataHasUnsavedChanges = true;
    const displayLabel = label || detailedMetadata.Title || detailedMetadata.Series || `Issue #${issueId}`;
    notifyMetadataApplied(displayLabel, selectedEl);
  } catch (error) {
    if (searchStatusDiv) searchStatusDiv.textContent = `Error: ${error.message}`;
  }
}
