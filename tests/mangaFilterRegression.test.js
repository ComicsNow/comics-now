/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getReadingPrefMaps, setReadingPreference, resolveReadingModes, dbRun } = require('../server/db');

function createModuleSandbox() {
  const state = {
    currentView: 'root',
    currentRootFolder: null,
    activeSmartFilter: null,
    comicIdMap: new Map(),
    mangaModePreference: false
  };

  const sandbox = {
    window: window,
    document: document,
    state: state,
    console: console,
    fetch: jest.fn(),
    applyDisplayInfoToComic: jest.fn(c => c)
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
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
  }

  return { sandbox, loadFile, state };
}

describe('Manga Smart Filter Regression Tests', () => {
  describe('Frontend Smartlists Manga Filter Pill Behavior', () => {
    let env;

    beforeEach(() => {
      document.body.innerHTML = `
        <div id="dynamic-manga-filter-btn" class="hidden">
          <span id="dynamic-manga-filter-label">Manga</span>
          <span id="dynamic-manga-filter-count">0</span>
        </div>
      `;

      env = createModuleSandbox();
      env.loadFile('../public/js/library/smartlists.js');
    });

    test('reveals Manga filter button with correct count when manga comics exist', () => {
      env.state.comicIdMap = new Map([
        ['c1', { id: 'c1', name: 'Berserk 01', mangaMode: true }],
        ['c2', { id: 'c2', name: 'One Piece 01', mangaMode: true }],
        ['c3', { id: 'c3', name: 'Spider-Man 01', mangaMode: false }]
      ]);

      env.sandbox.rebuildMangaSmartLists();

      const btn = document.getElementById('dynamic-manga-filter-btn');
      const count = document.getElementById('dynamic-manga-filter-count');
      const label = document.getElementById('dynamic-manga-filter-label');

      expect(btn.classList.contains('hidden')).toBe(false);
      expect(count.textContent).toBe('2');
      expect(label.textContent).toBe('Manga');
      expect(env.sandbox.getMangaComics().length).toBe(2);
      expect(env.sandbox.getNonMangaComics().length).toBe(1);
    });

    test('hides Manga filter button when no comics have mangaMode: true', () => {
      env.state.comicIdMap = new Map([
        ['c1', { id: 'c1', name: 'Batman 01', mangaMode: false }],
        ['c2', { id: 'c2', name: 'Superman 01', mangaMode: false }]
      ]);

      env.sandbox.rebuildMangaSmartLists();

      const btn = document.getElementById('dynamic-manga-filter-btn');
      const count = document.getElementById('dynamic-manga-filter-count');

      expect(btn.classList.contains('hidden')).toBe(true);
      expect(count.textContent).toBe('0');
      expect(env.sandbox.getMangaComics().length).toBe(0);
    });

    test('displays "Non-Manga" filter button when default library preference is manga', () => {
      env.state.mangaModePreference = true;
      env.state.comicIdMap = new Map([
        ['c1', { id: 'c1', name: 'Berserk 01', mangaMode: true }],
        ['c2', { id: 'c2', name: 'Spider-Man 01', mangaMode: false }]
      ]);

      env.sandbox.rebuildMangaSmartLists();

      const btn = document.getElementById('dynamic-manga-filter-btn');
      const count = document.getElementById('dynamic-manga-filter-count');
      const label = document.getElementById('dynamic-manga-filter-label');

      expect(btn.classList.contains('hidden')).toBe(false);
      expect(count.textContent).toBe('1');
      expect(label.textContent).toBe('Non-Manga');
    });
  });

  describe('Backend Reading Preferences Fallback & Resolution', () => {
    const testUserId = 'test-manga-user-' + Date.now();
    const mangaComicId = 'test-manga-comic-' + Date.now();
    const westernComicId = 'test-western-comic-' + Date.now();
    const overrideComicId = 'test-override-comic-' + Date.now();

    beforeAll(async () => {
      await dbRun(`INSERT INTO users (userId, email, role) VALUES (?, ?, 'user')`, [
        testUserId,
        `${testUserId}@example.com`
      ]);

      // Baseline settings for default-user
      await setReadingPreference('default-user', 'comic', mangaComicId, true, false);
      await setReadingPreference('default-user', 'comic', westernComicId, false, false);
      await setReadingPreference('default-user', 'comic', overrideComicId, true, false);

      // User explicitly overrides only overrideComicId to false
      await setReadingPreference(testUserId, 'comic', overrideComicId, false, false);
    });

    afterAll(async () => {
      await dbRun(`DELETE FROM users WHERE userId = ?`, [testUserId]);
      await dbRun(`DELETE FROM user_reading_preferences WHERE targetId IN (?, ?, ?)`, [
        mangaComicId,
        westernComicId,
        overrideComicId
      ]);
    });

    test('authenticated user with no custom record for manga comic inherits default-user mangaMode=true', async () => {
      const prefMaps = await getReadingPrefMaps(testUserId);
      const res = resolveReadingModes(mangaComicId, 'Series', 'Pub', '/lib/file.cbz', prefMaps, ['/lib']);

      expect(res.mangaMode).toBe(true);
    });

    test('authenticated user retains explicit override mangaMode=false over default-user mangaMode=true', async () => {
      const prefMaps = await getReadingPrefMaps(testUserId);
      const res = resolveReadingModes(overrideComicId, 'Series', 'Pub', '/lib/file.cbz', prefMaps, ['/lib']);

      expect(res.mangaMode).toBe(false);
    });

    test('western comic remains mangaMode=false', async () => {
      const prefMaps = await getReadingPrefMaps(testUserId);
      const res = resolveReadingModes(westernComicId, 'Series', 'Pub', '/lib/file.cbz', prefMaps, ['/lib']);

      expect(res.mangaMode).toBe(false);
    });
  });

  afterAll(async () => {
    try {
      const db = require('../server/db');
      if (db && typeof db.closeDb === 'function') {
        await db.closeDb();
      }
    } catch (e) {
      // ignore
    }
  });
});
