import {
  state,
  escapeHtml,
  searchStatusDiv,
  searchResultsUl,
  searchForm,
  searchQueryInput
} from './globals.js';

// --- ComicVine Search State & Elements ---
export const cvState = {
  page: 1,
  limit: 20,      // results per page
  total: 0,
  lastQuery: '',
  lastResources: 'issue',
  lastSort: '',
  lastIssueNumber: '',
  lastYear: ''
};

const cvPrevBtn   = document.getElementById('cv-prev');
const cvNextBtn   = document.getElementById('cv-next');
const cvPageInfo  = document.getElementById('cv-page-info');

// Helper to call renderMetadataDisplay dynamically from either state or window
function renderMetadataDisplay(metadata, clearForm = true) {
  if (typeof state.renderMetadataDisplay === 'function') {
    state.renderMetadataDisplay(metadata, clearForm);
  } else if (typeof window.renderMetadataDisplay === 'function') {
    window.renderMetadataDisplay(metadata, clearForm);
  } else {
    console.warn('renderMetadataDisplay not registered yet.');
  }
}

// Opens a beautiful, premium modal previewing the full cover image with scale and fade animations
function openCoverPreviewModal(imageUrl, title) {
  const backdrop = document.createElement('div');
  backdrop.id = 'cover-preview-modal';
  backdrop.className = 'fixed inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm transition-opacity duration-300 opacity-0';
  backdrop.style.zIndex = '99999';
  
  const content = document.createElement('div');
  content.className = 'relative max-w-[90vw] max-h-[90vh] bg-gray-900/90 backdrop-blur-md p-3 rounded-2xl border border-gray-800 shadow-2xl flex flex-col items-center transform scale-95 transition-transform duration-300';
  
  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = 'Cover Preview';
  img.className = 'max-w-full max-h-[75vh] object-contain rounded-xl shadow-inner border border-gray-800';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 focus:outline-none transition-colors border border-white/10';
  closeBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  `;
  
  const caption = document.createElement('div');
  caption.className = 'text-white text-sm font-semibold text-center mt-3 px-4 max-w-md truncate';
  caption.textContent = title;

  content.appendChild(img);
  content.appendChild(caption);
  content.appendChild(closeBtn);
  backdrop.appendChild(content);
  document.body.appendChild(backdrop);

  // Animate in
  setTimeout(() => {
    backdrop.classList.remove('opacity-0');
    content.classList.remove('scale-95');
  }, 10);

  const closeModal = () => {
    backdrop.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
      backdrop.remove();
    }, 300);
  };

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

const SOURCE_DISPLAY_CONFIG = {
  comicvine:   { name: 'ComicVine',    badgeBg: 'bg-purple-600' },
  gcd:         { name: 'GCD',          badgeBg: 'bg-indigo-600' },
  lcg:         { name: 'LCG',          badgeBg: 'bg-cyan-600' },
  metron:      { name: 'Metron',       badgeBg: 'bg-rose-600' },
  goodreads:   { name: 'Goodreads',    badgeBg: 'bg-amber-600' },
  blackwells:  { name: "Blackwell's",  badgeBg: 'bg-teal-600' },
  waterstones: { name: 'Waterstones',  badgeBg: 'bg-emerald-600' },
  googlebooks: { name: 'Google Books', badgeBg: 'bg-blue-600' },
  amazon:      { name: 'Amazon',       badgeBg: 'bg-yellow-600' }
};

function getSourceInfo(rawSource) {
  const key = String(rawSource || 'other').toLowerCase();
  if (SOURCE_DISPLAY_CONFIG[key]) return { key, ...SOURCE_DISPLAY_CONFIG[key] };
  return { key, name: String(rawSource || 'OTHER').toUpperCase(), badgeBg: 'bg-purple-600' };
}

function renderSourceFilterTabs(results) {
  const tabsContainer = document.getElementById('cv-source-filter-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  if (!results || results.length === 0) {
    tabsContainer.classList.add('hidden');
    return;
  }

  // Count results per source
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

  // "All" tab
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  const isAllActive = (cvState.activeSourceFilter || 'all') === 'all';
  allBtn.className = `px-2.5 py-1 text-xs font-semibold rounded-full transition-colors cursor-pointer ${
    isAllActive
      ? 'bg-red-600 text-white shadow-sm'
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
        ? 'bg-red-600 text-white shadow-sm'
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

function renderResultsList() {
  const resultsUl = document.getElementById('search-results') || document.getElementById('cv-results') || (typeof searchResultsUl !== 'undefined' ? searchResultsUl : null);
  if (!resultsUl) return;
  resultsUl.innerHTML = '';

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

    // Base row
    const baseRow = document.createElement('div');
    baseRow.className = 'flex items-center space-x-3 cursor-pointer';
    baseRow.innerHTML = `
      ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="cover" class="w-10 h-14 object-cover rounded flex-shrink-0 hover:brightness-110 transition-all shadow hover:shadow-lg"/>` : ''}
      <div class="flex-1 min-w-0">
        <span class="font-bold block truncate">${escapeHtml(displayName)}${badgeHtml}</span>
        <span class="text-sm text-gray-400 block truncate">${escapeHtml(subtitle)}</span>
      </div>
    `;

    // Allow clicking thumbnail image to preview full high-res cover
    const coverImg = baseRow.querySelector('img');
    if (coverImg) {
      coverImg.addEventListener('click', (e) => {
        e.stopPropagation();
        const previewUrl = result.image?.medium_url || result.image?.super_url || result.image?.original_url || coverUrl;
        openCoverPreviewModal(previewUrl, displayName);
      });
    }

    baseRow.addEventListener('click', () => {
      if (result.fullMetadata) {
        renderMetadataDisplay(result.fullMetadata, true);
        state.metadataHasUnsavedChanges = true;
        const metaForm = document.getElementById('metadata-form-container') || document.getElementById('metadata-form');
        if (metaForm) {
          metaForm.scrollIntoView({ behavior: 'smooth' });
        }
      } else {
        if (isIssue) {
          applyIssueMetadataFromSearch(result.id);
        } else {
          applyMetadataFromSearch(result.id);
        }
      }
    });

    li.appendChild(baseRow);

    // --- Volume expansion (Lazy Loaded for ComicVine volumes) ---
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

              issueList.innerHTML = '';
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
                    ${issueCoverUrl ? `<img src="${escapeHtml(issueCoverUrl)}" class="w-8 h-12 object-cover rounded flex-shrink-0 hover:brightness-110 transition-all shadow"/>` : ''}
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

                  issueLi.addEventListener('click', () => applyIssueMetadataFromSearch(issue.id));
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
}

// Performs the search and renders paged results with source badges + publisher + cover preview + source tabs
export async function performCvSearch() {
  // Disable search for local/device comics
  const comic = state.currentComic || window.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) {
    const statusDiv = document.getElementById('search-status') || document.getElementById('cv-status') || (typeof searchStatusDiv !== 'undefined' ? searchStatusDiv : null);
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

  const statusDiv = document.getElementById('search-status') || document.getElementById('cv-status') || (typeof searchStatusDiv !== 'undefined' ? searchStatusDiv : null);
  const resultsUl = document.getElementById('search-results') || document.getElementById('cv-results') || (typeof searchResultsUl !== 'undefined' ? searchResultsUl : null);
  const pageInfoEl = document.getElementById('cv-page-info') || (typeof cvPageInfo !== 'undefined' ? cvPageInfo : null);
  const prevBtn = document.getElementById('cv-prev') || (typeof cvPrevBtn !== 'undefined' ? cvPrevBtn : null);
  const nextBtn = document.getElementById('cv-next') || (typeof cvNextBtn !== 'undefined' ? cvNextBtn : null);

  if (statusDiv) statusDiv.textContent = 'Searching across sources...';
  if (resultsUl) resultsUl.innerHTML = '';
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

    // normalize response shape
    const raw     = Array.isArray(payload) ? payload : payload?.results;
    const results = Array.isArray(raw) ? raw : [];
    const total   = Number.isFinite(payload?.total) ? payload.total : results.length;
    cvState.total = total;
    cvState.allResults = results;
    cvState.activeSourceFilter = 'all';

    // update pager text
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

    // Render filter tabs & results
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

// --- ComicVine Search Form Handler ---
if (searchForm) {
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (searchQueryInput) {
      cvState.lastQuery = searchQueryInput.value || '';
    }
    const resourcesEl     = document.getElementById('cv-resources');
    const sortEl          = document.getElementById('cv-sort');
    const issueNumberEl   = document.getElementById('search-issue-number');
    const yearEl          = document.getElementById('search-year');

    cvState.lastResources = resourcesEl?.value || 'issue';
    cvState.lastSort      = sortEl?.value || '';
    cvState.lastIssueNumber = issueNumberEl?.value || '';
    cvState.lastYear      = yearEl?.value || '';
    cvState.page          = 1;
    await performCvSearch();
  });

  // Dynamic layout constraint toggle for Volume vs Issue fields and sorts
  const resourcesEl = document.getElementById('cv-resources');
  if (resourcesEl) {
    const handleResourceChange = () => {
      const mode = resourcesEl.value; // 'issue' or 'volume'
      const issueNumContainer = document.getElementById('cv-issue-number-container');
      const issueNumInput = document.getElementById('search-issue-number');
      const sortEl = document.getElementById('cv-sort');

      if (mode === 'volume') {
        if (issueNumContainer) issueNumContainer.classList.add('hidden');
        if (issueNumInput) {
          issueNumInput.value = '';
          issueNumInput.disabled = true;
        }
        if (sortEl) {
          Array.from(sortEl.options).forEach(opt => {
            if (opt.value.startsWith('cover_date:')) {
              opt.disabled = true;
              opt.classList.add('hidden');
              if (sortEl.value === opt.value) {
                sortEl.value = ''; // fallback to Relevance
              }
            }
          });
        }
      } else {
        if (issueNumContainer) issueNumContainer.classList.remove('hidden');
        if (issueNumInput) issueNumInput.disabled = false;
        if (sortEl) {
          Array.from(sortEl.options).forEach(opt => {
            if (opt.value.startsWith('cover_date:')) {
              opt.disabled = false;
              opt.classList.remove('hidden');
            }
          });
        }
      }
    };

    resourcesEl.addEventListener('change', handleResourceChange);
    // Initialize once on load
    handleResourceChange();
  }

  const sourceEl = document.getElementById('search-source');
  if (sourceEl) {
    const handleSourceChange = () => {
      const source = sourceEl.value;
      const isComicVine = source === 'comicvine';

      const issueNumContainer = document.getElementById('cv-issue-number-container');
      const yearContainer = document.getElementById('cv-year-container');
      const resourcesContainer = document.getElementById('cv-resources-container');
      const sortContainer = document.getElementById('cv-sort-container');

      if (isComicVine) {
        if (resourcesContainer) resourcesContainer.classList.remove('hidden');
        if (sortContainer) sortContainer.classList.remove('hidden');
        if (yearContainer) yearContainer.classList.remove('hidden');
        const resourcesEl = document.getElementById('cv-resources');
        if (resourcesEl && resourcesEl.value === 'volume') {
          if (issueNumContainer) issueNumContainer.classList.add('hidden');
        } else {
          if (issueNumContainer) issueNumContainer.classList.remove('hidden');
        }
      } else {
        if (issueNumContainer) issueNumContainer.classList.add('hidden');
        if (yearContainer) yearContainer.classList.add('hidden');
        if (resourcesContainer) resourcesContainer.classList.add('hidden');
        if (sortContainer) sortContainer.classList.add('hidden');
      }
    };

    sourceEl.addEventListener('change', handleSourceChange);
    // Initialize once on load
    handleSourceChange();
  }
}

// --- Pager Buttons ---
cvPrevBtn?.addEventListener('click', async () => {
  if (cvState.page > 1) {
    cvState.page -= 1;
    await performCvSearch();
  }
});

cvNextBtn?.addEventListener('click', async () => {
  const totalPages = Math.max(1, Math.ceil(cvState.total / cvState.limit));
  if (cvState.page < totalPages) {
    cvState.page += 1;
    await performCvSearch();
  }
});

export async function applyMetadataFromSearch(volumeId) {
  const comic = state.currentComic || window.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) return;

  const prevStatus = searchStatusDiv ? searchStatusDiv.textContent : '';
  if (searchStatusDiv) searchStatusDiv.textContent = 'Fetching details...';
  try {
    const response = await fetch(`${state.API_BASE_URL || ''}/api/v1/comicvine/volume/${volumeId}`);
    if (!response.ok) throw new Error('Could not fetch details.');
    const detailedMetadata = await response.json();
    renderMetadataDisplay(detailedMetadata, true);
    state.metadataHasUnsavedChanges = true; // Mark as having unsaved changes
    if (searchStatusDiv) searchStatusDiv.textContent = prevStatus;
  } catch (error) {
    if (searchStatusDiv) searchStatusDiv.textContent = `Error: ${error.message}`;
  }
}

// Apply ISSUE metadata from ComicVine to the Edit form
export async function applyIssueMetadataFromSearch(issueId) {
  const comic = state.currentComic || window.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) return;

  const prevStatus = searchStatusDiv ? searchStatusDiv.textContent : '';
  if (searchStatusDiv) searchStatusDiv.textContent = 'Fetching issue details...';
  try {
    const response = await fetch(`${state.API_BASE_URL || ''}/api/v1/comicvine/issue/${issueId}`);
    if (!response.ok) throw new Error('Could not fetch issue details.');
    const detailedMetadata = await response.json();
    renderMetadataDisplay(detailedMetadata, true);
    state.metadataHasUnsavedChanges = true; // Mark as having unsaved changes
    if (searchStatusDiv) searchStatusDiv.textContent = prevStatus;
  } catch (error) {
    if (searchStatusDiv) searchStatusDiv.textContent = `Error: ${error.message}`;
  }
}
