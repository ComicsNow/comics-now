/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClientScript(filepath, sandbox) {
  if (filepath.endsWith('comicvine.js')) {
    const cvDir = path.join(path.dirname(filepath), 'comicvine');
    if (fs.existsSync(cvDir)) {
      const subs = ['source-info.js', 'cover-preview.js', 'staging.js', 'candidate-card.js', 'search-api.js'];
      for (const sub of subs) {
        const subPath = path.join(cvDir, sub);
        if (fs.existsSync(subPath)) {
          const subContent = fs.readFileSync(subPath, 'utf8')
            .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
            .replace(/export\s+const\s+/g, 'var ')
            .replace(/export\s+let\s+/g, 'var ')
            .replace(/export\s+function\s+/g, 'function ')
            .replace(/export\s+async\s+function\s+/g, 'async function ')
            .replace(/\bexport\s+/g, '');
          vm.createContext(sandbox);
          new vm.Script(subContent).runInContext(sandbox);
        }
      }
    }
  }

  const fileContent = fs.readFileSync(filepath, 'utf8');
  const cleanContent = fileContent
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+const\s+/g, 'var ')
    .replace(/export\s+let\s+/g, 'var ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/\bexport\s+/g, '');
  vm.createContext(sandbox);
  new vm.Script(cleanContent).runInContext(sandbox);
  return sandbox;
}

describe('Manual Metadata Search UX Fixes', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="metadata-content">
        <section id="metadata-sub-cv">
          <form id="search-form">
            <input id="search-query" value="Batman" />
            <select id="search-source"><option value="all">All Sources</option></select>
            <select id="cv-resources"><option value="issue">Issue</option><option value="volume">Volume</option></select>
            <div id="cv-issue-number-container"><input id="search-issue-number" value="" /></div>
            <div id="cv-year-container"><input id="search-year" value="" /></div>
            <select id="cv-sort"><option value="">Relevance</option></select>
          </form>
          <p id="search-status"></p>
          <div id="source-staging-tray" class="hidden">
            <span id="staged-sources-count">0</span>
            <button id="clear-staged-sources-btn" type="button">Clear All</button>
            <button id="synthesize-staged-sources-btn" type="button" disabled><span>Synthesize with Gemini Flash</span></button>
            <p id="staging-tray-hint"></p>
            <div id="staged-sources-list"></div>
          </div>
          <ul id="search-results"></ul>
          <button id="cv-prev"></button>
          <button id="cv-next"></button>
          <span id="cv-page-info"></span>
        </section>
        <section id="metadata-sub-form">
          <form id="metadata-form">
            <div id="save-status"></div>
            <input name="Title" value="Detective Comics" />
            <input name="Series" value="Batman" />
            <button type="submit">Save Changes</button>
          </form>
        </section>
      </div>
      <div id="library-view">
        <div class="comic-card" id="card-123">Comic Card</div>
      </div>
    `;

    sandbox = {
      window,
      document,
      console,
      URLSearchParams,
      state: {
        API_BASE_URL: 'http://localhost:3000',
        currentComic: { path: '/comics/issue.cbz', name: 'Batman 001.cbz' },
        currentMetadata: {},
        metadataHasUnsavedChanges: false,
        renderMetadataDisplay: jest.fn(),
        sanitizeMetadata: jest.fn()
      },
      escapeHtml: (str) => String(str ?? ''),
      clearElement: (el) => { if (el) el.innerHTML = ''; },
      renderMetadataDisplay: jest.fn(),
      sanitizeMetadata: jest.fn(),
      searchStatusDiv: document.getElementById('search-status'),
      searchResultsUl: document.getElementById('search-results'),
      searchForm: document.getElementById('search-form'),
      searchQueryInput: document.getElementById('search-query'),
      metadataForm: document.getElementById('metadata-form'),
      saveStatusDiv: document.getElementById('save-status'),
      cvPrevBtn: document.getElementById('cv-prev'),
      cvNextBtn: document.getElementById('cv-next'),
      cvPageInfo: document.getElementById('cv-page-info'),
      confirm: jest.fn(() => false),
      alert: jest.fn(),
      setTimeout,
      clearTimeout,
      apiCall: jest.fn(),
      encodePath: (p) => p,
      ctButton: null, ctModal: null, ctScheduleInput: null, ctSaveBtn: null,
      ctApplyBtn: null, ctSkipBtn: null, ctConfirmYes: null, ctConfirmNo: null,
      ctClearOutputBtn: null, ctOutputDiv: null, ctRunBtn: null,
      ctTabSettings: null, ctTabMatches: null, ctTabOutput: null, ctTabSearch: null,
      ctTabLogs: null, ctTabManagement: null, ctContentSettings: null,
      ctContentMatches: null, ctContentOutput: null, ctContentSearch: null,
      ctContentLogs: null, ctContentManagement: null, ctMatchesBadge: null,
      clearDownloadsBtn: null
    };
    sandbox.globalThis = window;
    sandbox.fetch = (...args) => sandbox.window.fetch(...args);
  });

  test('Fix 1: Closing #cover-preview-modal (via backdrop or close button) does not trigger unsaved metadata warning', () => {
    loadClientScript(path.resolve(__dirname, '../public/js/events.js'), sandbox);
    loadClientScript(path.resolve(__dirname, '../public/js/comicvine.js'), sandbox);

    // User has unsaved changes in metadata (e.g. after selecting a search result or editing a field)
    sandbox.state.metadataHasUnsavedChanges = true;

    // User clicks on a cover thumbnail to open the cover preview modal
    sandbox.openCoverPreviewModal('https://example.com/cover.jpg', 'Batman #1');
    const modal = document.getElementById('cover-preview-modal');
    expect(modal).toBeTruthy();

    // Clicking on the backdrop to exit the cover view should NOT prompt confirm('You have unsaved changes...')
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.confirm).not.toHaveBeenCalled();
    expect(sandbox.state.metadataHasUnsavedChanges).toBe(true);

    // Clicking on the close button inside the cover preview modal should also NOT prompt confirm
    const closeBtn = modal.querySelector('button');
    expect(closeBtn).toBeTruthy();
    closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sandbox.confirm).not.toHaveBeenCalled();
    expect(sandbox.state.metadataHasUnsavedChanges).toBe(true);
  });

  test('Fix 2: Selecting a search result provides visual feedback (card highlight, badge, search-status, save-status) for both fullMetadata and ComicVine fetch results', async () => {
    loadClientScript(path.resolve(__dirname, '../public/js/comicvine.js'), sandbox);

    sandbox.cvState.allResults = [
      {
        id: 'metron-101',
        name: 'Absolute Batman',
        issueNumber: '1',
        type: 'issue',
        source: 'metron',
        publisher: 'DC Comics',
        fullMetadata: {
          Series: 'Absolute Batman',
          Number: '1',
          Writer: 'Scott Snyder'
        }
      },
      {
        id: 999,
        name: 'Detective Comics',
        issueNumber: '27',
        type: 'issue',
        source: 'comicvine',
        publisher: 'DC Comics'
      }
    ];

    sandbox.renderResultsList();

    const items = document.querySelectorAll('#search-results > li');
    expect(items.length).toBe(2);

    // Click first result (direct fullMetadata)
    const firstRow = items[0].querySelector('.cursor-pointer');
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(sandbox.state.renderMetadataDisplay).toHaveBeenCalledWith(
      expect.objectContaining({ Series: 'Absolute Batman', Number: '1' }),
      true
    );
    expect(items[0].classList.contains('selected-search-result')).toBe(true);
    expect(items[0].querySelector('.applied-result-badge')?.textContent).toContain('Applied');
    expect(document.getElementById('search-status').textContent).toContain('Applied metadata from "Absolute Batman #1"');
    expect(document.getElementById('save-status').textContent).toContain('Loaded metadata from "Absolute Batman #1"');

    // Click second result (async ComicVine issue fetch)
    sandbox.window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Series: 'Detective Comics',
        Number: '27',
        Title: 'The Case of the Chemical Syndicate'
      })
    });

    const secondRow = items[1].querySelector('.cursor-pointer');
    secondRow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 20));

    expect(items[0].classList.contains('selected-search-result')).toBe(false);
    expect(items[1].classList.contains('selected-search-result')).toBe(true);
    expect(items[1].querySelector('.applied-result-badge')?.textContent).toContain('Applied');
    expect(document.getElementById('search-status').textContent).toContain('Applied metadata from "Detective Comics #27"');
    expect(document.getElementById('save-status').textContent).toContain('Loaded metadata from "Detective Comics #27"');
  });

  test('Fix 3: Staging 2+ sources when Gemini is disabled enables synthesis button and synthesizes deterministically via /api/v1/metadata/synthesize', async () => {
    sandbox.window._geminiState = { _loaded: true, enabled: false };
    loadClientScript(path.resolve(__dirname, '../public/js/comicvine.js'), sandbox);

    const src1 = {
      id: 'cv-1',
      source: 'comicvine',
      type: 'issue',
      name: 'Absolute Batman',
      issueNumber: '1',
      fullMetadata: { Series: 'Absolute Batman', Number: '1', Writer: 'Scott Snyder' }
    };
    const src2 = {
      id: 'metron-1',
      source: 'metron',
      type: 'issue',
      name: 'Absolute Batman',
      issueNumber: '1',
      fullMetadata: { Series: 'Absolute Batman', Title: 'The Zoo', Number: '1', Penciller: 'Nick Dragotta' }
    };

    sandbox.toggleStageSource(src1);
    const synthBtn = document.getElementById('synthesize-staged-sources-btn');
    expect(synthBtn.disabled).toBe(true);

    sandbox.toggleStageSource(src2);
    expect(synthBtn.disabled).toBe(false);
    expect(synthBtn.textContent).toContain('Synthesize Sources');
    expect(document.getElementById('staging-tray-hint').textContent).toContain('merge the best metadata fields across 2 staged sources');

    sandbox.window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        mode: 'deterministic',
        metadata: {
          Series: 'Absolute Batman',
          Title: 'The Zoo',
          Number: '1',
          Writer: 'Scott Snyder',
          Penciller: 'Nick Dragotta'
        }
      })
    });

    await sandbox.synthesizeStagedSources();

    expect(sandbox.window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/metadata/synthesize'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(sandbox.state.renderMetadataDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        Series: 'Absolute Batman',
        Title: 'The Zoo',
        Writer: 'Scott Snyder',
        Penciller: 'Nick Dragotta'
      }),
      true
    );
    expect(document.getElementById('search-status').textContent).toContain('Successfully synthesized metadata across 2 sources');
  });
});
