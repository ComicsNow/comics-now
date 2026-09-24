/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const attachComicTaggerRoutes = require('../server/routes/admin/comictagger');

describe('ComicTagger Review & Cancellation Integration Tests', () => {
  describe('Admin ComicTagger Route Endpoints', () => {
    let router;
    let deps;
    let pendingHandler;
    let pendingDetailsHandler;
    let cancelHandler;
    let applyHandler;
    let skipHandler;

    beforeEach(() => {
      jest.clearAllMocks();

      router = {
        get: jest.fn((path, ...args) => {
          if (path === '/api/v1/comictagger/pending') pendingHandler = args[args.length - 1];
          if (path === '/api/v1/comictagger/pending-details') pendingDetailsHandler = args[args.length - 1];
        }),
        post: jest.fn((path, ...args) => {
          if (path === '/api/v1/comictagger/cancel') cancelHandler = args[args.length - 1];
          if (path === '/api/v1/comictagger/apply') applyHandler = args[args.length - 1];
          if (path === '/api/v1/comictagger/skip') skipHandler = args[args.length - 1];
        })
      };

      deps = {
        log: jest.fn(),
        cancelComicTagger: jest.fn(() => true),
        isTaggerRunning: jest.fn(() => false),
        applyUserSelection: jest.fn().mockResolvedValue(),
        skipCurrentMatch: jest.fn(),
        getPendingMatch: jest.fn(() => ({
          fileName: 'Spider-Man #1.cbz',
          filePath: '/comics/Spider-Man #1.cbz',
          waitingForResponse: true,
          previewBuffer: Buffer.from([1, 2, 3, 4]),
          previewMime: 'image/jpeg',
          matches: [
            { choice: '1', title: 'Spider-Man #1', score: 85, publisher: 'Marvel' }
          ]
        })),
        formatErrorMessage: jest.fn((err, req, msg) => msg || err.message)
      };

      attachComicTaggerRoutes(router, deps);
    });

    test('GET /api/v1/comictagger/pending returns pending match details even when scan is not running', () => {
      const req = {};
      const res = { json: jest.fn() };

      pendingHandler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'Spider-Man #1.cbz',
          waitingForResponse: true,
          isRunning: false
        })
      );
    });

    test('GET /api/v1/comictagger/pending-details omits bulky previewBuffer from JSON payload', async () => {
      const req = {};
      const res = {
        json: jest.fn(),
        set: jest.fn()
      };

      await pendingDetailsHandler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'Spider-Man #1.cbz',
          waitingForResponse: true,
          matches: expect.any(Array)
        })
      );
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.previewBuffer).toBeUndefined();
    });

    test('POST /api/v1/comictagger/cancel triggers cancelComicTagger and responds ok', async () => {
      const req = {};
      const res = { json: jest.fn() };

      await cancelHandler(req, res);

      expect(deps.cancelComicTagger).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true, cancelled: true });
    });

    test('POST /api/v1/comictagger/apply applies user selection and responds ok', async () => {
      const req = { body: { selections: ['1'] } };
      const res = { json: jest.fn() };

      await applyHandler(req, res);

      expect(deps.applyUserSelection).toHaveBeenCalledWith(['1']);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('POST /api/v1/comictagger/skip skips pending match and responds ok', async () => {
      const req = {};
      const res = { json: jest.fn() };

      await skipHandler(req, res);

      expect(deps.skipCurrentMatch).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('Frontend DOM State & Review Cleanliness', () => {
    let sandbox;
    let ctModule;

    beforeEach(() => {
      document.body.innerHTML = `
        <div id="ct-content-matches">
          <div id="ct-preview-container" class="hidden"></div>
          <div id="ct-no-matches">No matches</div>
          <table id="ct-match-table" class="hidden">
            <tbody id="ct-match-body"></tbody>
          </table>
          <button id="ct-apply-btn" disabled></button>
          <button id="ct-skip-btn" disabled></button>
        </div>
        <button id="ct-tab-matches">
          <span id="ct-matches-badge" class="hidden"></span>
        </button>
      `;

      const escapeHtml = (s) =>
        String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');

      sandbox = {
        window,
        document,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        JSON,
        Math,
        fetch: jest.fn(),
        state: { API_BASE_URL: '' },
        escapeHtml,
        getRelativePath: () => '/comictagger',
        ctButton: document.createElement('button'),
        ctModal: document.createElement('div'),
        ctScheduleInput: document.createElement('input'),
        ctMatchBody: document.getElementById('ct-match-body'),
        ctApplyBtn: document.getElementById('ct-apply-btn'),
        ctSkipBtn: document.getElementById('ct-skip-btn'),
        ctConfirmBar: document.createElement('div'),
        ctConfirmMessage: document.createElement('div'),
        ctConfirmYes: document.createElement('button'),
        ctConfirmNo: document.createElement('button'),
        ctOutputDiv: document.createElement('div'),
        ctTabMatches: document.getElementById('ct-tab-matches'),
        ctMatchesBadge: document.getElementById('ct-matches-badge')
      };
      sandbox.globalThis = sandbox;
      vm.createContext(sandbox);

      const filePath = path.resolve(__dirname, '../public/js/comictagger.js');
      const content = fs.readFileSync(filePath, 'utf8');
      const cleanContent = content
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+let\s+/g, 'let ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/export\s+\{[\s\S]*?\};?/g, '')
        .replace(/export\s+default\s+[\s\S]*?;?/g, '');

      const script = new vm.Script(cleanContent);
      script.runInContext(sandbox);
      ctModule = sandbox;
    });

    test('checkPendingMatch correctly renders indicator and unhides badge when waitingForResponse is true', async () => {
      sandbox.fetch.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          waitingForResponse: true,
          fileName: 'Batman 01.cbz',
          timestamp: new Date().toISOString()
        })
      });

      await ctModule.checkPendingMatch();

      const indicator = document.getElementById('ct-pending-indicator');
      const badge = document.getElementById('ct-matches-badge');
      const applyBtn = document.getElementById('ct-apply-btn');
      const skipBtn = document.getElementById('ct-skip-btn');

      expect(indicator).toBeTruthy();
      expect(indicator.textContent).toContain('Batman 01.cbz');
      expect(badge.classList.contains('hidden')).toBe(false);
      expect(applyBtn.disabled).toBe(false);
      expect(skipBtn.disabled).toBe(false);
    });

    test('checkPendingMatch cleanly removes indicator and hides badge when waitingForResponse is false', async () => {
      // Simulate leftover indicator and active badge
      const indicator = document.createElement('div');
      indicator.id = 'ct-pending-indicator';
      document.getElementById('ct-content-matches').appendChild(indicator);
      const badge = document.getElementById('ct-matches-badge');
      badge.classList.remove('hidden');

      sandbox.fetch.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          waitingForResponse: false
        })
      });

      await ctModule.checkPendingMatch();

      expect(document.getElementById('ct-pending-indicator')).toBeNull();
      expect(badge.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('ct-apply-btn').disabled).toBe(true);
      expect(document.getElementById('ct-skip-btn').disabled).toBe(true);
    });

    test('clearCtMatches resets table, removes indicator, and restores no-matches display', () => {
      const matchTable = document.getElementById('ct-match-table');
      const noMatches = document.getElementById('ct-no-matches');
      const badge = document.getElementById('ct-matches-badge');
      const matchBody = document.getElementById('ct-match-body');
      matchBody.innerHTML = '<tr><td>Mock Candidate</td></tr>';
      matchTable.classList.remove('hidden');
      noMatches.classList.add('hidden');
      badge.classList.remove('hidden');

      const indicator = document.createElement('div');
      indicator.id = 'ct-pending-indicator';
      document.getElementById('ct-content-matches').appendChild(indicator);

      ctModule.clearCtMatches();

      expect(matchBody.innerHTML).toBe('');
      expect(matchTable.classList.contains('hidden')).toBe(true);
      expect(noMatches.classList.contains('hidden')).toBe(false);
      expect(badge.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('ct-pending-indicator')).toBeNull();
    });

    test('fetchPendingMatchDetails displays candidates and hides ct-no-matches when match is pending', async () => {
      sandbox.fetch.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          waitingForResponse: true,
          fileName: 'Iron Man 01.cbz',
          matches: [
            {
              choice: '1',
              title: 'Invincible Iron Man',
              publisher: 'Marvel',
              score: 80,
              source: 'comicvine'
            }
          ]
        })
      });

      await ctModule.fetchPendingMatchDetails(true);

      const noMatches = document.getElementById('ct-no-matches');
      const matchTable = document.getElementById('ct-match-table');
      const matchBody = document.getElementById('ct-match-body');

      expect(noMatches.classList.contains('hidden')).toBe(true);
      expect(matchTable.classList.contains('hidden')).toBe(false);
      expect(matchBody.innerHTML).toContain('Invincible Iron Man');
      expect(matchBody.innerHTML).toContain('80% Match');
    });

    test('fetchPendingMatchDetails clears table and removes indicator when waitingForResponse is false', async () => {
      // Simulate leftover state
      const matchBody = document.getElementById('ct-match-body');
      matchBody.innerHTML = '<tr><td>Stale Match</td></tr>';
      const indicator = document.createElement('div');
      indicator.id = 'ct-pending-indicator';
      document.getElementById('ct-content-matches').appendChild(indicator);

      sandbox.fetch.mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          waitingForResponse: false
        })
      });

      await ctModule.fetchPendingMatchDetails(true);

      expect(matchBody.innerHTML).toBe('');
      expect(document.getElementById('ct-no-matches').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('ct-match-table').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('ct-pending-indicator')).toBeNull();
    });
  });
});
