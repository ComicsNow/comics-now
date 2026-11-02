/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('ComicVine Search & Staging Submodules', () => {
  let sandbox;

  function loadClientScript(relPath, customSandbox = sandbox) {
    const fullPath = path.resolve(__dirname, '../../..', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    vm.runInContext(cleanContent, customSandbox);
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="source-staging-tray" class="hidden">
        <span id="staged-sources-count">0</span>
        <div id="staged-sources-list"></div>
        <p id="staging-tray-hint"></p>
        <button id="synthesize-staged-sources-btn" disabled></button>
        <button id="clear-staged-sources-btn"></button>
      </div>
      <div id="search-status"></div>
      <ul id="search-results"></ul>
      <div id="cv-source-filter-tabs" class="hidden"></div>
      <span id="cv-page-info"></span>
      <button id="cv-prev"></button>
      <button id="cv-next"></button>
    `;

    sandbox = {
      window,
      document,
      console,
      state: { API_BASE_URL: 'http://localhost:3000' },
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      fetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, results: [] }) }))
    };
    vm.createContext(sandbox);

    loadClientScript('public/js/comicvine/source-info.js');
    loadClientScript('public/js/comicvine/cover-preview.js');
    loadClientScript('public/js/comicvine/staging.js');
    loadClientScript('public/js/comicvine/candidate-card.js');
    loadClientScript('public/js/comicvine/search-api.js');
    loadClientScript('public/js/comicvine.js');
  });

  test('getSourceInfo resolves known and unknown comic sources with badges', () => {
    const cvInfo = sandbox.getSourceInfo('comicvine');
    expect(cvInfo.name).toBe('ComicVine');
    expect(cvInfo.badgeBg).toBe('bg-purple-600');

    const customInfo = sandbox.getSourceInfo('custom_src');
    expect(customInfo.name).toBe('CUSTOM_SRC');
  });

  test('staging sources management adds, checks, and clears staged sources', () => {
    const item1 = { id: 101, source: 'comicvine', name: 'Batman', number: '1' };
    const item2 = { id: 102, source: 'gcd', name: 'Batman', number: '1' };

    expect(sandbox.isSourceStaged(item1)).toBe(false);
    sandbox.toggleStageSource(item1);
    expect(sandbox.isSourceStaged(item1)).toBe(true);

    sandbox.toggleStageSource(item2);
    expect(sandbox.cvState.stagedSources.length).toBe(2);

    sandbox.unstageSource(101);
    expect(sandbox.isSourceStaged(item1)).toBe(false);
    expect(sandbox.cvState.stagedSources.length).toBe(1);

    sandbox.clearStagedSources();
    expect(sandbox.cvState.stagedSources.length).toBe(0);
  });
});
