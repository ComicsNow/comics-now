/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');

function realEscapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripEsmSyntax(source) {
  return source
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');
}

describe('Phase 1A Bug Fixes & safeHtml XSS Fallback Hardening', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  describe('comics-defaults.js', () => {
    test('normalizes array-shaped preferences from GET /api/v1/user/library-preferences', async () => {
      document.body.innerHTML = `
        <input type="checkbox" id="master-manga-toggle" />
        <input type="checkbox" id="master-continuous-toggle" />
        <select id="allowed-formats-select"><option value="cbz">cbz</option></select>
        <select id="cbr-conversion-originals-select"><option value="keep">keep</option></select>
        <select id="pdf-conversion-originals-select"><option value="keep">keep</option></select>
        <button id="comics-defaults-save-btn"></button>
        <span id="comics-defaults-dirty-indicator" class="hidden"></span>
        <span id="comics-defaults-save-status"></span>
        <div id="library-preferences-container"></div>
      `;

      const fetchMock = jest.fn(async (url) => {
        if (url.endsWith('/api/v1/settings')) {
          return { ok: true, json: async () => ({ allowedFormats: 'cbz' }) };
        }
        if (url.endsWith('/api/v1/manga-mode-preference')) {
          return { ok: true, json: async () => ({ mangaMode: false }) };
        }
        if (url.endsWith('/api/v1/continuous-mode-preference')) {
          return { ok: true, json: async () => ({ continuousMode: false }) };
        }
        if (url.endsWith('/api/v1/admin/libraries')) {
          return {
            ok: true,
            json: async () => ({
              libraries: [{ path: '/comics/marvel', name: 'Marvel' }]
            })
          };
        }
        if (url.endsWith('/api/v1/user/library-preferences')) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              preferences: [
                { path: '/comics/marvel', mangaMode: true, continuousMode: false }
              ]
            })
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const formatControlsCode = stripEsmSyntax(
        fs.readFileSync(path.join(ROOT_DIR, 'public/js/settings/format-controls.js'), 'utf8')
      );
      const prefRowCode = stripEsmSyntax(
        fs.readFileSync(path.join(ROOT_DIR, 'public/js/settings/library-pref-row.js'), 'utf8')
      );
      const defaultsCode = stripEsmSyntax(
        fs.readFileSync(path.join(ROOT_DIR, 'public/js/settings/comics-defaults.js'), 'utf8')
      );

      const sandbox = {
        document,
        window,
        state: { API_BASE_URL: '' },
        clearElement: (el) => { el.innerHTML = ''; },
        html: undefined,
        raw: undefined,
        render: undefined,
        showSettingsMessage: jest.fn(),
        initStoryArcReaderSettings: jest.fn(),
        fetch: fetchMock,
        confirm: jest.fn(() => true),
        console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        Set,
        Object,
        Array,
        Promise
      };
      vm.createContext(sandbox);
      vm.runInContext(formatControlsCode + '\n' + prefRowCode + '\n' + defaultsCode, sandbox);

      await sandbox.reloadAll();

      const mangaCheckbox = document.querySelector('[data-lib-path="/comics/marvel"] .lib-toggle-manga');
      const scrollCheckbox = document.querySelector('[data-lib-path="/comics/marvel"] .lib-toggle-scroll');
      expect(mangaCheckbox).not.toBeNull();
      expect(mangaCheckbox.checked).toBe(true);
      expect(scrollCheckbox.checked).toBe(false);
    });

    test('safeHtml fallback escapes HTML special characters in interpolated values', () => {
      const code = stripEsmSyntax(
        fs.readFileSync(path.join(ROOT_DIR, 'public/js/settings/comics-defaults.js'), 'utf8')
      );

      const sandbox = {
        document,
        window,
        state: {},
        clearElement: jest.fn(),
        html: undefined,
        raw: undefined,
        render: undefined,
        showSettingsMessage: jest.fn(),
        buildLibraryPrefRow: jest.fn(),
        initStoryArcReaderSettings: jest.fn(),
        wireFormatControlListeners: jest.fn(),
        console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        Set,
        Object,
        Array
      };
      vm.createContext(sandbox);
      vm.runInContext(code + '\nthis.__safeHtml = safeHtml;', sandbox);

      const rendered = sandbox.__safeHtml`<p>${'<script>alert("xss")</script>'}</p>`.toHTML();
      expect(rendered).not.toContain('<script>');
      expect(rendered).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });
  });

  describe('reading-list-modal.js & reading-list-detail-cards.js', () => {
    test('filter listener uses latest lists after refreshReadingListModal re-runs and escapes thumbUrl', async () => {
      document.body.innerHTML = `
        <div id="reading-list-modal">
          <div class="mb-6 space-y-2"></div>
          <input id="reading-list-search" type="text" value="" />
          <select id="reading-list-publisher-filter"><option value="">All publishers</option></select>
          <div id="reading-lists-container"></div>
        </div>
      `;

      let currentLists = [
        { id: 'list-1', name: 'Alpha Old', publishers: ['DC'], totalComics: 1, readComics: 0 }
      ];

      const sandbox = {
        document,
        window,
        navigator: { onLine: true },
        escapeHtml: realEscapeHtml,
        ICONS: { READ: 'R', DOWNLOAD: 'D' },
        isAppOnline: () => true,
        appGlobal: {
          API_BASE_URL: '',
          ReadingLists: {
            fetchReadingLists: async () => currentLists
          }
        },
        closeReadingListModal: jest.fn(),
        deleteReadingList: jest.fn(),
        showReadingListDetail: jest.fn(),
        confirm: jest.fn(() => false),
        alert: jest.fn(),
        console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        Date,
        Set,
        Array,
        encodeURIComponent
      };
      vm.createContext(sandbox);
      const modalCode = stripEsmSyntax(
        fs.readFileSync(path.join(ROOT_DIR, 'public/js/app/reading-list-modal.js'), 'utf8')
      );
      vm.runInContext(modalCode, sandbox);

      await sandbox.refreshReadingListModal();
      expect(document.getElementById('reading-lists-container').textContent).toContain('Alpha Old');

      // Now update server lists & refresh modal again while filter listener was already bound on call 1
      currentLists = [
        {
          id: 'list-2',
          name: 'Beta New',
          publishers: ['Marvel'],
          totalComics: 2,
          readComics: 0,
          thumbnailPath: 'evil.jpg" onerror="alert(1)'
        }
      ];
      await sandbox.refreshReadingListModal();

      const searchEl = document.getElementById('reading-list-search');
      searchEl.value = 'Beta';
      searchEl.dispatchEvent(new window.Event('input'));

      const containerHtml = document.getElementById('reading-lists-container').innerHTML;
      expect(containerHtml).toContain('Beta New');
      expect(containerHtml).not.toContain('No lists match your filter');
      // thumbUrl attribute must be escaped
      expect(containerHtml).not.toContain('onerror="alert(1)"');
    });

    test('createReadingListComicCard escapes coverUrl in grid mode', () => {
      const cardsCode = stripEsmSyntax(
        fs.readFileSync(path.join(ROOT_DIR, 'public/js/app/reading-list-detail-cards.js'), 'utf8')
      );

      const sandbox = {
        document,
        window,
        state: { downloadedComicIds: new Set() },
        escapeHtml: realEscapeHtml,
        ICONS: { READ: 'R', DOWNLOAD: 'D' },
        appGlobal: {
          API_BASE_URL: 'https://example.com" onerror="alert(1)',
          applyDisplayInfoToComic: () => ({ displayTitle: 'Issue 1' })
        },
        Set,
        Array,
        Boolean,
        Math,
        String,
        console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
      };
      vm.createContext(sandbox);
      vm.runInContext(cardsCode, sandbox);

      const card = sandbox.createReadingListComicCard({
        item: { comicId: 'c1', totalPages: 10, lastReadPage: 0 },
        comic: { id: 'c1', name: 'Issue 1', thumbnailPath: 'thumb.jpg" onclick="alert(2)' },
        listId: 'l1',
        listName: 'List 1',
        isEditMode: false,
        isOffline: false,
        viewMode: 'grid',
        comicsContainer: document.createElement('div'),
        renderComics: jest.fn(),
        hideReadingListDetail: jest.fn(),
        showReadingListDetail: jest.fn()
      });

      const img = card.querySelector('img');
      expect(img).not.toBeNull();
      expect(img.getAttribute('onerror')).toBeNull();
      expect(img.getAttribute('onclick')).toBeNull();
      expect(card.innerHTML).toContain('&quot;');
    });
  });

  describe('continuous/lifecycle.js toggleContinuousMode', () => {
    test('persists toggle via POST /api/v1/comics/continuous-mode and flips mode synchronously', () => {
      const fetchMock = jest.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, continuousMode: true }) })
      );

      const continuousFiles = [
        'public/js/continuous/state.js',
        'public/js/continuous/progress.js',
        'public/js/continuous/virtualizer.js',
        'public/js/continuous/lifecycle.js'
      ];

      const sandbox = {
        window: { API_BASE_URL: '' },
        document,
        state: { API_BASE_URL: '', GuidedView: { disableAll: jest.fn() } },
        continuousState: { isSwitchingContinuousMode: false },
        fetch: fetchMock,
        console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        setTimeout,
        clearTimeout,
        JSON,
        Promise
      };
      vm.createContext(sandbox);

      for (const rel of continuousFiles) {
        const code = stripEsmSyntax(fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8'));
        vm.runInContext(code, sandbox);
      }

      const result = sandbox.toggleContinuousMode('comic-123', false);
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/comics/continuous-mode',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comicId: 'comic-123', continuousMode: true })
        })
      );
    });
  });

  describe('Offline download safeHtml fallbacks', () => {
    const offlineFiles = [
      'public/js/offline/download-progress.js',
      'public/js/offline/download-actions.js',
      'public/js/offline/downloads/ui-helpers.js'
    ];

    test.each(offlineFiles)('%s safeHtml fallback escapes XSS payloads', (relPath) => {
      const code = stripEsmSyntax(fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8'));
      const sandbox = {
        document,
        window,
        navigator: { onLine: true },
        state: {},
        downloadQueueDiv: null,
        clearElement: jest.fn(),
        html: undefined,
        raw: undefined,
        render: undefined,
        console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        Array,
        Object,
        String
      };
      vm.createContext(sandbox);
      vm.runInContext(code + '\nthis.__safeHtml = safeHtml;', sandbox);

      const output = sandbox.__safeHtml`<div>${'"><img src=x onerror=alert(1)>'}</div>`.toHTML();
      expect(output).not.toContain('<img');
      expect(output).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    });
  });
});
