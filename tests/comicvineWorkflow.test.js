/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- Helper to load and run ES modules in vm context ---
function loadClientScript(filepath, sandbox) {
  const fileContent = fs.readFileSync(filepath, 'utf8');
  const cleanContent = fileContent
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/\bexport\s+/g, '');
  const script = new vm.Script(cleanContent);
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  return sandbox;
}

describe('ComicVine Rework & Unsaved Changes Warning Integration', () => {
  let sandbox;

  beforeEach(() => {
    // 1. Setup Document HTML structure
    document.body.innerHTML = `
      <div id="metadata-content">
        <div id="metadata-subtabs"></div>
        <section id="metadata-sub-cv">
          <form id="search-form">
            <input id="cv-query" value="Batman" />
            <select id="cv-resources">
              <option value="issue">Issue</option>
              <option value="volume">Volume</option>
            </select>
            <div id="cv-issue-number-container">
              <input id="search-issue-number" value="" />
            </div>
            <div id="cv-year-container">
              <input id="search-year" value="" />
            </div>
            <select id="cv-sort">
              <option value="">Relevance</option>
              <option value="name:asc">Name ↑</option>
              <option value="name:desc">Name ↓</option>
              <option value="cover_date:desc" class="cover-date-option">Cover date ↓</option>
              <option value="cover_date:asc" class="cover-date-option">Cover date ↑</option>
            </select>
          </form>
          <div id="cv-status"></div>
          <ul id="cv-results"></ul>
          <button id="cv-prev"></button>
          <button id="cv-next"></button>
          <div id="cv-page-info"></div>
        </section>
        <section id="metadata-sub-form">
          <form id="metadata-form">
            <input name="Title" value="Detective Comics" />
            <input name="Series" value="Batman" />
            <button type="submit">Save</button>
          </form>
          <div id="save-status"></div>
        </section>
      </div>
      <div id="library-view">
        <div class="comic-card" id="card-123">Comic Card</div>
      </div>
    `;

    // 2. Setup Sandbox Context
    sandbox = {
      window: window,
      document: document,
      console: console,
      state: {
        API_BASE_URL: 'http://localhost:3000',
        currentComic: { path: '/comics/issue.cbz' },
        metadataHasUnsavedChanges: false
      },
      escapeHtml: (str) => str,
      searchStatusDiv: document.getElementById('cv-status'),
      searchResultsUl: document.getElementById('cv-results'),
      searchForm: document.getElementById('search-form'),
      searchQueryInput: document.getElementById('cv-query'),
      metadataForm: document.getElementById('metadata-form'),
      saveStatusDiv: document.getElementById('save-status'),
      cvPrevBtn: document.getElementById('cv-prev'),
      cvNextBtn: document.getElementById('cv-next'),
      cvPageInfo: document.getElementById('cv-page-info'),
      confirm: jest.fn(),
      alert: jest.fn(),
      setTimeout: setTimeout,
      apiCall: jest.fn(),
      encodePath: (p) => p,
      ctButton: null,
      ctModal: null,
      ctScheduleInput: null,
      ctSaveBtn: null,
      ctApplyBtn: null,
      ctSkipBtn: null,
      ctConfirmYes: null,
      ctConfirmNo: null,
      ctClearOutputBtn: null,
      ctOutputDiv: null,
      ctRunBtn: null,
      ctTabSettings: null,
      ctTabMatches: null,
      ctTabOutput: null,
      ctTabManagement: null,
      ctContentSettings: null,
      ctContentMatches: null,
      ctContentOutput: null,
      ctContentManagement: null,
      ctMatchesBadge: null,
      clearDownloadsBtn: null
    };
    sandbox.globalThis = window;
  });

  // ==========================================
  // CLIENT-SIDE TEST CASE 1: Dynamic UI Constraints
  // ==========================================
  test('Dynamic UI Constraints: Volume disables Issue input and cover_date sorts', () => {
    loadClientScript(path.resolve(__dirname, '../public/js/comicvine.js'), sandbox);

    const resourcesEl = document.getElementById('cv-resources');
    const issueNumContainer = document.getElementById('cv-issue-number-container');
    const issueNumInput = document.getElementById('search-issue-number');
    const sortEl = document.getElementById('cv-sort');

    // Default is issue mode
    expect(resourcesEl.value).toBe('issue');
    expect(issueNumContainer.classList.contains('hidden')).toBe(false);
    expect(issueNumInput.disabled).toBe(false);

    // Switch to volume mode
    resourcesEl.value = 'volume';
    resourcesEl.dispatchEvent(new Event('change'));

    expect(issueNumContainer.classList.contains('hidden')).toBe(true);
    expect(issueNumInput.disabled).toBe(true);
    expect(issueNumInput.value).toBe('');

    // Sort options starting with cover_date should be hidden & disabled
    const coverDateOpts = Array.from(sortEl.options).filter(o => o.value.startsWith('cover_date:'));
    expect(coverDateOpts.length).toBe(2);
    coverDateOpts.forEach(opt => {
      expect(opt.disabled).toBe(true);
      expect(opt.classList.contains('hidden')).toBe(true);
    });

    // Switch back to issue mode
    resourcesEl.value = 'issue';
    resourcesEl.dispatchEvent(new Event('change'));

    expect(issueNumContainer.classList.contains('hidden')).toBe(false);
    expect(issueNumInput.disabled).toBe(false);
    coverDateOpts.forEach(opt => {
      expect(opt.disabled).toBe(false);
      expect(opt.classList.contains('hidden')).toBe(false);
    });
  });

  // ==========================================
  // CLIENT-SIDE TEST CASE 2: Unsaved Changes Click Interceptor
  // ==========================================
  test('Unsaved Changes: Global click intercepts navigating away from metadata', () => {
    // Load events script which registers click interceptor
    loadClientScript(path.resolve(__dirname, '../public/js/events.js'), sandbox);

    const otherCard = document.getElementById('card-123');
    const metadataPanel = document.getElementById('metadata-content');

    // Case A: No unsaved changes -> Event goes through normally without alert
    let clicked = false;
    otherCard.addEventListener('click', () => { clicked = true; });
    otherCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(clicked).toBe(true);
    expect(sandbox.confirm).not.toHaveBeenCalled();

    // Reset clicked state
    clicked = false;

    // Case B: Unsaved changes active -> clicking inside metadata panel passes through
    sandbox.state.metadataHasUnsavedChanges = true;
    metadataPanel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.confirm).not.toHaveBeenCalled();

    // Case C: Unsaved changes active -> click outside metadata prompts confirm
    sandbox.confirm.mockReturnValue(false); // User clicks Cancel on the confirm dialog
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    otherCard.dispatchEvent(clickEvent);

    expect(sandbox.confirm).toHaveBeenCalledWith(
      'You have unsaved changes in metadata. Are you sure you want to discard them?'
    );
    expect(clickEvent.defaultPrevented).toBe(true); // Navigation cancelled!
    expect(sandbox.state.metadataHasUnsavedChanges).toBe(true); // Flag remains true

    // Case D: Unsaved changes active -> user clicks OK to discard
    sandbox.confirm.mockClear();
    sandbox.confirm.mockReturnValue(true); // User clicks OK on confirm dialog
    const clickEventOk = new MouseEvent('click', { bubbles: true, cancelable: true });
    otherCard.dispatchEvent(clickEventOk);

    expect(sandbox.confirm).toHaveBeenCalled();
    expect(clickEventOk.defaultPrevented).toBe(false); // Navigation allowed!
    expect(sandbox.state.metadataHasUnsavedChanges).toBe(false); // Flag reset to false
  });
});

// ==========================================
// BACKEND TEST SUITE: Structured Search & Sorting
// ==========================================
describe('Backend ComicVine Search Rework & Sorting API', () => {
  let routes, mockDeps, router;

  beforeEach(() => {
    routes = {};
    router = {
      get: (path, handler) => {
        routes[path] = handler;
      }
    };

    mockDeps = {
      getComicVineApiKey: () => 'valid-api-key',
      cvFetchJson: jest.fn(),
      COMICVINE_API_URL: 'https://comicvine.gamespot.com/api',
      formatErrorMessage: (e) => e.message,
      resolvePath: (p) => p,
      isPathSafe: () => true,
      checkComicAccess: () => true,
      getComicsDirectories: () => [],
      createId: (p) => p,
      stripHtml: (s) => s,
      normalizeCvId: (id) => id
    };

    // Attach our routes to the mock router
    const attachRoutes = require('../server/routes/user/metadata');
    attachRoutes(router, mockDeps);
  });

  test('Fuzzy Fallback: In-memory fallback sorting is applied successfully', async () => {
    // 1. Mock ComicVine /search endpoint response
    mockDeps.cvFetchJson.mockResolvedValue({
      number_of_total_results: 3,
      results: [
        { id: 1, name: 'C - Comic Book', cover_date: '2020-05-01', api_detail_url: '/issue/1' },
        { id: 2, name: 'A - Comic Book', cover_date: '2022-05-01', api_detail_url: '/issue/2' },
        { id: 3, name: 'B - Comic Book', cover_date: '2021-05-01', api_detail_url: '/issue/3' }
      ]
    });

    const handler = routes['/api/v1/search/comicvine'];
    expect(handler).toBeDefined();

    // A. Test Name Ascending Sort
    const req = {
      query: { query: 'test', resources: 'issue', sort: 'name:asc' }
    };
    const res = {
      json: jest.fn()
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalled();
    const sortedByNameAsc = res.json.mock.calls[0][0].results;
    expect(sortedByNameAsc[0].name).toBe('A - Comic Book');
    expect(sortedByNameAsc[1].name).toBe('B - Comic Book');
    expect(sortedByNameAsc[2].name).toBe('C - Comic Book');

    // B. Test Cover Date Descending Sort
    res.json.mockClear();
    req.query.sort = 'cover_date:desc';

    await handler(req, res);

    const sortedByDateDesc = res.json.mock.calls[0][0].results;
    expect(sortedByDateDesc[0].name).toBe('A - Comic Book'); // 2022
    expect(sortedByDateDesc[1].name).toBe('B - Comic Book'); // 2021
    expect(sortedByDateDesc[2].name).toBe('C - Comic Book'); // 2020
  });

  test('Structured Search: Two-stage resolution searches volumes then issues', async () => {
    // 1. Mock structured search calls
    // First call is volumes lookup:
    mockDeps.cvFetchJson.mockResolvedValueOnce({
      results: [{ id: 101, name: 'Batman (1940)' }]
    });
    // Second call is issues lookup for volume 101, issue 12:
    mockDeps.cvFetchJson.mockResolvedValueOnce({
      number_of_total_results: 1,
      results: [{
        id: 9999,
        name: 'Batman #12',
        issue_number: '12',
        cover_date: '1942-08-01',
        image: { thumb_url: 'cover.jpg' },
        volume: { id: 101, name: 'Batman (1940)' }
      }]
    });

    const handler = routes['/api/v1/search/comicvine'];
    const req = {
      query: { query: 'Batman', resources: 'issue', issueNumber: '12', year: '1940' }
    };
    const res = {
      json: jest.fn()
    };

    await handler(req, res);

    expect(mockDeps.cvFetchJson).toHaveBeenCalledTimes(2);
    expect(mockDeps.cvFetchJson.mock.calls[0][0]).toContain('/volumes/');
    expect(mockDeps.cvFetchJson.mock.calls[0][0]).toContain('filter=name%3ABatman%2Cstart_year%3A1940');
    expect(mockDeps.cvFetchJson.mock.calls[1][0]).toContain('/issues/');
    expect(mockDeps.cvFetchJson.mock.calls[1][0]).toContain('volume%3A4050-101');

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0].results[0];
    expect(result.id).toBe(9999);
    expect(result.name).toBe('Batman #12');
    expect(result.issueNumber).toBe('12');
  });

  test('Lazy Loading: Fetches volume issues accurately', async () => {
    // Mock volume details lookup
    mockDeps.cvFetchJson.mockResolvedValueOnce({
      results: { name: 'Spider-Man', publisher: { name: 'Marvel' } }
    });
    // Mock issues list lookup
    mockDeps.cvFetchJson.mockResolvedValueOnce({
      results: [
        {
          id: 501,
          name: 'Issue #1',
          issue_number: '1',
          volume: { id: 202, name: 'Spider-Man' },
          cover_date: '1963-03-01'
        }
      ]
    });

    const handler = routes['/api/v1/comicvine/volume/:volumeId/issues'];
    expect(handler).toBeDefined();

    const req = {
      params: { volumeId: '202' }
    };
    const res = {
      json: jest.fn()
    };

    await handler(req, res);

    expect(mockDeps.cvFetchJson).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalled();
    const list = res.json.mock.calls[0][0];
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(501);
    expect(list[0].name).toBe('Issue #1');
    expect(list[0].publisher).toBe('Marvel');
  });
});
