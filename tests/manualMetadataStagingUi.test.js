/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClientScript(filepath, sandbox) {
  const fileContent = fs.readFileSync(filepath, 'utf8');
  const cleanContent = fileContent
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/\bexport\s+/g, '')
    + '\nwindow.cvState = cvState;\nwindow.renderResultsList = renderResultsList;\nwindow.performCvSearch = performCvSearch;\n';
  const script = new vm.Script(cleanContent);
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  return sandbox;
}

describe('Manual Tagging Source Staging Tray & Gemini Flash Synthesis UI', () => {
  let sandbox;

  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    document.body.innerHTML = `
      <div id="metadata-content">
        <section id="metadata-sub-cv">
          <form id="search-form">
            <input id="cv-query" value="Batman" />
            <select id="cv-resources">
              <option value="issue">Issue</option>
            </select>
            <input id="search-issue-number" value="1" />
            <input id="search-year" value="2011" />
            <select id="search-source">
              <option value="comicvine">ComicVine</option>
            </select>
          </form>
          <div id="cv-status"></div>
          <div id="cv-source-filter-tabs" class="hidden"></div>
          
          <!-- Source Staging Tray -->
          <div id="source-staging-tray" class="hidden">
            <span id="staged-sources-count">0</span>
            <p id="staging-tray-hint"></p>
            <button id="clear-staged-sources-btn" type="button">Clear All</button>
            <button id="synthesize-staged-sources-btn" type="button" disabled>Synthesize with Gemini Flash</button>
            <div id="staged-sources-list"></div>
          </div>

          <ul id="search-results"></ul>
          <button id="cv-prev"></button>
          <button id="cv-next"></button>
          <div id="cv-page-info"></div>
        </section>

        <section id="metadata-sub-form">
          <div id="metadata-form-container">
            <form id="metadata-form">
              <input name="Title" value="" />
              <input name="Series" value="" />
              <input name="Number" value="" />
              <button type="submit">Save</button>
            </form>
          </div>
        </section>
      </div>
    `;

    sandbox = {
      window: {
        currentComic: { id: 'comic-123', name: 'Batman 001.cbz', filename: 'Batman 001.cbz' },
        currentMetadata: { Series: 'Batman' }
      },
      document,
      console,
      setTimeout,
      clearTimeout,
      state: {
        API_BASE_URL: '',
        currentComic: { id: 'comic-123', name: 'Batman 001.cbz', filename: 'Batman 001.cbz' },
        currentMetadata: { Series: 'Batman' },
        metadataHasUnsavedChanges: false,
        renderMetadataDisplay: jest.fn(),
        sanitizeMetadata: jest.fn(m => m)
      },
      escapeHtml: (str) => String(str || ''),
      searchStatusDiv: document.getElementById('cv-status'),
      searchResultsUl: document.getElementById('search-results'),
      searchForm: document.getElementById('search-form'),
      searchQueryInput: document.getElementById('cv-query'),
      fetch: jest.fn()
    };
  });

  it('preserves single-source direct click to apply metadata immediately', () => {
    loadClientScript(path.join(__dirname, '../public/js/comicvine.js'), sandbox);

    const testResults = [
      {
        id: 'external-gcd-1',
        type: 'issue',
        source: 'gcd',
        name: 'Batman #1',
        volumeName: 'Batman',
        issueNumber: '1',
        fullMetadata: {
          Title: 'Batman',
          Series: 'Batman',
          Number: '1',
          Publisher: 'DC Comics',
          Writer: 'Scott Snyder'
        }
      }
    ];

    sandbox.window.cvState.allResults = testResults;
    sandbox.window.renderResultsList();

    const resultLi = document.getElementById('search-results').querySelector('li');
    expect(resultLi).not.toBeNull();

    // Clicking the result row directly applies single-source metadata
    const baseRow = resultLi.querySelector('.cursor-pointer');
    baseRow.click();

    expect(sandbox.state.renderMetadataDisplay).toHaveBeenCalledWith(
      testResults[0].fullMetadata,
      true
    );
    expect(sandbox.state.metadataHasUnsavedChanges).toBe(true);
  });

  it('allows staging multiple sources and updates the staging tray UI', () => {
    loadClientScript(path.join(__dirname, '../public/js/comicvine.js'), sandbox);

    const testResults = [
      {
        id: 'external-gcd-1',
        type: 'issue',
        source: 'gcd',
        name: 'Batman #1',
        volumeName: 'Batman',
        issueNumber: '1',
        fullMetadata: { Series: 'Batman', Number: '1', Publisher: 'DC Comics' }
      },
      {
        id: 'external-metron-2',
        type: 'issue',
        source: 'metron',
        name: 'Batman #1',
        volumeName: 'Batman (2011)',
        issueNumber: '1',
        fullMetadata: { Series: 'Batman', Title: 'The Court of Owls', Number: '1' }
      }
    ];

    sandbox.window.cvState.allResults = testResults;
    sandbox.window.renderResultsList();

    const stageBtns = document.querySelectorAll('.stage-source-btn');
    expect(stageBtns.length).toBe(2);

    // Stage first source
    stageBtns[0].click();
    expect(sandbox.window.cvState.stagedSources.length).toBe(1);
    expect(document.getElementById('staged-sources-count').textContent).toBe('1');
    expect(document.getElementById('source-staging-tray').classList.contains('hidden')).toBe(false);

    // Synthesize button is still disabled with 1 source
    const synthBtn = document.getElementById('synthesize-staged-sources-btn');
    expect(synthBtn.disabled).toBe(true);

    // Stage second source
    stageBtns[1].click();
    expect(sandbox.window.cvState.stagedSources.length).toBe(2);
    expect(document.getElementById('staged-sources-count').textContent).toBe('2');
    expect(synthBtn.disabled).toBe(false);

    // Unstage first source via tray remove button
    const removeBtns = document.querySelectorAll('.remove-staged-btn');
    expect(removeBtns.length).toBe(2);
    removeBtns[0].click();

    expect(sandbox.window.cvState.stagedSources.length).toBe(1);
    expect(synthBtn.disabled).toBe(true);

    // Clear all
    document.getElementById('clear-staged-sources-btn').click();
    expect(sandbox.window.cvState.stagedSources.length).toBe(0);
    expect(document.getElementById('source-staging-tray').classList.contains('hidden')).toBe(true);
  });

  it('triggers synthesis with Gemini Flash and applies synthesized result to form', async () => {
    loadClientScript(path.join(__dirname, '../public/js/comicvine.js'), sandbox);

    const testResults = [
      {
        id: 'external-gcd-1',
        type: 'issue',
        source: 'gcd',
        name: 'Batman #1',
        fullMetadata: { Series: 'Batman', Number: '1', Publisher: 'DC Comics' }
      },
      {
        id: 'external-metron-2',
        type: 'issue',
        source: 'metron',
        name: 'Batman #1',
        fullMetadata: { Series: 'Batman', Title: 'The Court of Owls', Number: '1' }
      }
    ];

    sandbox.window.cvState.allResults = testResults;
    sandbox.window.renderResultsList();

    const stageBtns = document.querySelectorAll('.stage-source-btn');
    stageBtns[0].click();
    stageBtns[1].click();

    const synthResult = {
      Series: 'Batman',
      Title: 'The Court of Owls',
      Number: '1',
      Publisher: 'DC Comics'
    };

    sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, metadata: synthResult })
    });

    const synthBtn = document.getElementById('synthesize-staged-sources-btn');
    await synthBtn.onclick();

    expect(sandbox.fetch).toHaveBeenCalledWith(
      '/api/v1/metadata/synthesize',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"sources"')
      })
    );

    expect(sandbox.state.renderMetadataDisplay).toHaveBeenCalledWith(
      synthResult,
      true
    );
    expect(sandbox.state.metadataHasUnsavedChanges).toBe(true);
  });
});
