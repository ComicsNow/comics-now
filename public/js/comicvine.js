/**
 * Comics Now! - ComicVine & Multi-Source Search Controller Facade
 *
 * Coordinates dialog form, source staging, cover previews, candidate rendering, and search API.
 */

import {
  searchForm,
  searchQueryInput
} from './globals.js';

import {
  SOURCE_DISPLAY_CONFIG,
  getSourceInfo
} from './comicvine/source-info.js';

import {
  cvState,
  getSourceKey,
  isSourceStaged,
  toggleStageSource,
  unstageSource,
  clearStagedSources,
  updateStageButtons,
  renderStagingTray
} from './comicvine/staging.js';

import {
  openCoverPreviewModal
} from './comicvine/cover-preview.js';

import {
  renderMetadataDisplay,
  sanitizeMetadata,
  renderSourceFilterTabs,
  renderResultsList,
  applyMetadataFromSearch,
  applyIssueMetadataFromSearch
} from './comicvine/candidate-card.js';

import {
  performCvSearch
} from './comicvine/search-api.js';

// --- Form & Pager Event Listeners ---
const formEl = (typeof searchForm !== 'undefined' && searchForm) ? searchForm : (typeof document !== 'undefined' ? document.getElementById('search-form') : null);
const queryInputEl = (typeof searchQueryInput !== 'undefined' && searchQueryInput) ? searchQueryInput : (typeof document !== 'undefined' ? document.getElementById('cv-query') : null);

if (formEl) {
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (queryInputEl) {
      cvState.lastQuery = queryInputEl.value || '';
    }
    const resourcesEl   = document.getElementById('cv-resources');
    const sortEl        = document.getElementById('cv-sort');
    const issueNumberEl = document.getElementById('search-issue-number');
    const yearEl        = document.getElementById('search-year');

    cvState.lastResources   = resourcesEl?.value || 'issue';
    cvState.lastSort        = sortEl?.value || '';
    cvState.lastIssueNumber = issueNumberEl?.value || '';
    cvState.lastYear        = yearEl?.value || '';
    cvState.page            = 1;
    await performCvSearch();
  });

  const resourcesEl = document.getElementById('cv-resources');
  if (resourcesEl) {
    const handleResourceChange = () => {
      const mode = resourcesEl.value;
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
                sortEl.value = '';
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
    handleSourceChange();
  }
}

const prevBtn = typeof document !== 'undefined' ? document.getElementById('cv-prev') : null;
const nextBtn = typeof document !== 'undefined' ? document.getElementById('cv-next') : null;

prevBtn?.addEventListener('click', async () => {
  if (cvState.page > 1) {
    cvState.page -= 1;
    await performCvSearch();
  }
});

nextBtn?.addEventListener('click', async () => {
  const totalPages = Math.max(1, Math.ceil(cvState.total / cvState.limit));
  if (cvState.page < totalPages) {
    cvState.page += 1;
    await performCvSearch();
  }
});

// Window namespace registration for backwards compatibility
if (typeof window !== 'undefined') {
  window.ComicsNow = window.ComicsNow || {};
  window.ComicsNow.comicvine = {
    cvState,
    getSourceInfo,
    getSourceKey,
    isSourceStaged,
    toggleStageSource,
    unstageSource,
    clearStagedSources,
    updateStageButtons,
    renderStagingTray,
    openCoverPreviewModal,
    renderSourceFilterTabs,
    renderResultsList,
    applyMetadataFromSearch,
    applyIssueMetadataFromSearch,
    performCvSearch
  };
}

export {
  SOURCE_DISPLAY_CONFIG,
  getSourceInfo,
  cvState,
  getSourceKey,
  isSourceStaged,
  toggleStageSource,
  unstageSource,
  clearStagedSources,
  updateStageButtons,
  renderStagingTray,
  openCoverPreviewModal,
  renderMetadataDisplay,
  sanitizeMetadata,
  renderSourceFilterTabs,
  renderResultsList,
  applyMetadataFromSearch,
  applyIssueMetadataFromSearch,
  performCvSearch
};
