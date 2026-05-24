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
  lastResources: 'volume',
  lastSort: '',
  lastField: 'all'
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

// Performs the search and renders paged results with ISSUE/VOLUME badge + publisher + cover preview
export async function performCvSearch() {
  // Disable search for local/device comics
  const comic = state.currentComic || window.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) {
    if (searchStatusDiv) {
      searchStatusDiv.textContent = 'ComicVine search is disabled for folder mode library comics.';
    }
    return;
  }

  const query     = cvState.lastQuery;
  const resources = cvState.lastResources || 'volume';
  const sort      = cvState.lastSort || '';
  const field     = cvState.lastField || 'all';

  if (!query) return;

  if (searchStatusDiv) searchStatusDiv.textContent = 'Searching...';
  if (searchResultsUl) searchResultsUl.innerHTML = '';

  const params = new URLSearchParams({
    query,
    resources,
    page: String(cvState.page),
    limit: String(cvState.limit)
  });
  if (sort) params.set('sort', sort);
  if (field === 'title') params.set('filter', `name:${query}`);

  try {
    const response = await fetch(`${state.API_BASE_URL || ''}/api/v1/search/comicvine?${params.toString()}`);
    const payload  = await response.json();
    if (!response.ok) throw new Error(payload.message || 'Search failed');

    // normalize response shape
    const raw     = Array.isArray(payload) ? payload : payload?.results;
    const results = Array.isArray(raw) ? raw : [];
    const total   = Number.isFinite(payload?.total) ? payload.total : results.length;
    cvState.total = total;

    // update pager text
    const first = (cvState.page - 1) * cvState.limit + 1;
    const last  = Math.min(cvState.page * cvState.limit, total);
    if (searchStatusDiv) {
      searchStatusDiv.textContent = `${total} results found.`;
    }
    if (cvPageInfo) {
      cvPageInfo.textContent = total
        ? `Showing ${first}-${last} • Page ${cvState.page} of ${Math.max(1, Math.ceil(total / cvState.limit))}`
        : 'No results';
    }

    // Enable/disable prev/next buttons
    if (cvPrevBtn) cvPrevBtn.disabled = cvState.page <= 1;
    if (cvNextBtn) cvNextBtn.disabled = cvState.page >= Math.ceil(total / cvState.limit) || total === 0;

    // Render list
    for (const result of results) {
      const li = document.createElement('li');
      li.className = 'flex flex-col bg-gray-700 p-2 rounded-lg hover:bg-gray-600';

      const isIssue = result.type === 'issue';

      const displayName = isIssue
        ? `${result.name || result.volumeName || 'Unknown'}${result.issueNumber ? ` #${result.issueNumber}` : ''}`
        : `${result.name || 'Unknown'}`;

      const badgeHtml = isIssue
        ? '<span class="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-purple-600">ISSUE</span>'
        : '<span class="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-blue-600">VOLUME</span>';

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
        ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="cover" class="w-10 h-14 object-cover rounded flex-shrink-0"/>` : ''}
        <div class="flex-1">
          <span class="font-bold">${escapeHtml(displayName)}${badgeHtml}</span>
          <span class="text-sm text-gray-400 block">${escapeHtml(subtitle)}</span>
        </div>
      `;

      if (isIssue) {
        baseRow.addEventListener('click', () => applyIssueMetadataFromSearch(result.id));
      } else {
        baseRow.addEventListener('click', () => applyMetadataFromSearch(result.id));
      }

      li.appendChild(baseRow);

      // --- Volume expansion ---
      if (!isIssue && Array.isArray(result.issues) && result.issues.length > 0) {
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = 'Show Issues';
        toggleBtn.className = 'ml-14 mt-2 text-xs text-purple-400 hover:underline self-start';
        let expanded = false;

        const issueList = document.createElement('ul');
        issueList.className = 'ml-14 mt-2 space-y-1 hidden';

        for (const issue of result.issues) {
          const issueLi = document.createElement('li');
          issueLi.className = 'flex items-center bg-gray-600 p-2 rounded cursor-pointer hover:bg-gray-500 space-x-2';

          const coverUrl = issue.image?.thumb_url || '';
          const subtitleParts = [];
          if (issue.volumeName) subtitleParts.push(issue.volumeName);
          if (issue.publisher)  subtitleParts.push(issue.publisher);
          if (issue.coverDate)  subtitleParts.push(issue.coverDate);
          const subtitle = subtitleParts.join(' • ');

          issueLi.innerHTML = `
            ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" class="w-8 h-12 object-cover rounded flex-shrink-0"/>` : ''}
            <div>
              <span class="font-bold">${escapeHtml(issue.name || 'Unknown')}${issue.issueNumber ? ` #${escapeHtml(issue.issueNumber)}` : ''}</span>
              <span class="text-sm text-gray-400 block">${escapeHtml(subtitle)}</span>
            </div>
          `;

          issueLi.addEventListener('click', () => applyIssueMetadataFromSearch(issue.id));
          issueList.appendChild(issueLi);
        }

        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          expanded = !expanded;
          toggleBtn.textContent = expanded ? 'Hide Issues' : 'Show Issues';
          issueList.classList.toggle('hidden', !expanded);
        });

        li.appendChild(toggleBtn);
        li.appendChild(issueList);
      }

      if (searchResultsUl) {
        searchResultsUl.appendChild(li);
      }
    }
  } catch (err) {
    if (searchStatusDiv) {
      searchStatusDiv.textContent = `Search failed: ${err.message || err}`;
    }
    if (cvPageInfo) cvPageInfo.textContent = '';
    if (cvPrevBtn) cvPrevBtn.disabled = true;
    if (cvNextBtn) cvNextBtn.disabled = true;
  } 
}

// --- ComicVine Search Form Handler ---
if (searchForm) {
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (searchQueryInput) {
      cvState.lastQuery = searchQueryInput.value || '';
    }
    const fieldEl         = document.getElementById('cv-field');
    const resourcesEl     = document.getElementById('cv-resources');
    const sortEl          = document.getElementById('cv-sort');
    cvState.lastField     = fieldEl?.value || 'all';
    cvState.lastResources = resourcesEl?.value || 'volume';
    cvState.lastSort      = sortEl?.value || '';
    cvState.page          = 1;
    await performCvSearch();
  });
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
  if (isLocal || (comic && comic.libraryMode === 'folder')) return;

  const prevStatus = searchStatusDiv ? searchStatusDiv.textContent : '';
  if (searchStatusDiv) searchStatusDiv.textContent = 'Fetching details...';
  try {
    const response = await fetch(`${state.API_BASE_URL || ''}/api/v1/comicvine/volume/${volumeId}`);
    if (!response.ok) throw new Error('Could not fetch details.');
    const detailedMetadata = await response.json();
    renderMetadataDisplay(detailedMetadata, true);
    if (searchStatusDiv) searchStatusDiv.textContent = prevStatus;
  } catch (error) {
    if (searchStatusDiv) searchStatusDiv.textContent = `Error: ${error.message}`;
  }
}

// Apply ISSUE metadata from ComicVine to the Edit form
export async function applyIssueMetadataFromSearch(issueId) {
  if (isLocal || (comic && comic.libraryMode === 'folder')) return;

  const prevStatus = searchStatusDiv ? searchStatusDiv.textContent : '';
  if (searchStatusDiv) searchStatusDiv.textContent = 'Fetching issue details...';
  try {
    const response = await fetch(`${state.API_BASE_URL || ''}/api/v1/comicvine/issue/${issueId}`);
    if (!response.ok) throw new Error('Could not fetch issue details.');
    const detailedMetadata = await response.json();
    renderMetadataDisplay(detailedMetadata, true);
    if (searchStatusDiv) searchStatusDiv.textContent = prevStatus;
  } catch (error) {
    if (searchStatusDiv) searchStatusDiv.textContent = `Error: ${error.message}`;
  }
}
