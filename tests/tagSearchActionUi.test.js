/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODULE_PATH = path.join(__dirname, '..', 'public', 'js', 'context-menu', 'actions-tag-search.js');
const COMIC_MENU_PATH = path.join(__dirname, '..', 'public', 'js', 'context-menu', 'actions-comic.js');
const APP_ENTRY_PATH = path.join(__dirname, '..', 'public', 'app.js');

function loadTagSearchModule(sandboxOverrides = {}) {
  const content = fs.readFileSync(MODULE_PATH, 'utf8')
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+(async\s+)?function\s+/g, '$1function ')
    .replace(/export\s+const\s+/g, 'var ')
    .replace(/\bexport\s+/g, '');

  const sandbox = {
    window,
    document,
    console,
    fetch: jest.fn(),
    alert: jest.fn(),
    confirm: jest.fn(() => false),
    state: { API_BASE_URL: '' },
    ICONS: { SEARCH: '<svg></svg>' },
    createMenuItem: jest.fn((content, onClick) => ({ content, onClick })),
    ...sandboxOverrides
  };
  sandbox.state = { API_BASE_URL: '', ...(sandboxOverrides.state || {}) };

  vm.createContext(sandbox);
  new vm.Script(content + '\n__tagSearch = { createTagSearchItem, runTagSearchForComic };')
    .runInContext(sandbox);
  return sandbox;
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe('per-comic Tag Search context menu action', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="ct-tab-matches"></button>';
    window.syncManager = { userRole: 'admin' };
    window.openCTModal = jest.fn();
    window.alert = jest.fn();
  });

  afterEach(() => {
    delete window.syncManager;
    delete window.openCTModal;
    delete window.__tagSearch;
  });

  test('is only offered to admins', () => {
    const sandbox = loadTagSearchModule();
    const comic = { id: 'mock-comic-id', name: 'mock-comic.cbr' };

    expect(sandbox.__tagSearch.createTagSearchItem(comic)).toBeTruthy();

    window.syncManager.userRole = 'user';
    expect(sandbox.__tagSearch.createTagSearchItem(comic)).toBeNull();

    delete window.syncManager;
    expect(sandbox.__tagSearch.createTagSearchItem(comic)).toBeNull();
  });

  test('is not offered for local device comics', () => {
    const sandbox = loadTagSearchModule();

    expect(sandbox.__tagSearch.createTagSearchItem({ id: 'device-42' })).toBeNull();
    expect(sandbox.__tagSearch.createTagSearchItem({ id: 'mock-comic-id', handle: {} })).toBeNull();
    expect(sandbox.__tagSearch.createTagSearchItem({ id: 'mock-comic-id', file: new Blob() })).toBeNull();
  });

  test('posts the relative run-file endpoint with the comic id', async () => {
    const sandbox = loadTagSearchModule({
      state: { API_BASE_URL: '/comics-test' }
    });
    sandbox.fetch.mockResolvedValue(okResponse({ ok: true, status: 'tagged' }));

    await sandbox.__tagSearch.runTagSearchForComic({ id: 'mock-comic-id', name: 'mock-comic.cbr' });

    expect(sandbox.fetch).toHaveBeenCalledWith('/comics-test/api/v1/tag-comics-now/run-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comicId: 'mock-comic-id', force: false })
    });
    expect(sandbox.alert).not.toHaveBeenCalled();
  });

  test('opens the ComicTagger matches view when the engine returns review matches', async () => {
    const sandbox = loadTagSearchModule();
    const tab = document.getElementById('ct-tab-matches');
    tab.click = jest.fn();
    sandbox.fetch.mockResolvedValue(okResponse({
      ok: true,
      status: 'review',
      matches: [{ choice: '1', title: 'Mock Series #1' }]
    }));

    await sandbox.__tagSearch.runTagSearchForComic({ id: 'mock-comic-id' });

    expect(window.openCTModal).toHaveBeenCalled();
    expect(tab.click).toHaveBeenCalled();
  });

  test('opens the matches view when another review already holds the slot', async () => {
    const sandbox = loadTagSearchModule();
    sandbox.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, code: 'review_pending', message: 'A match is awaiting review' })
    });

    await sandbox.__tagSearch.runTagSearchForComic({ id: 'mock-comic-id' });

    expect(window.openCTModal).toHaveBeenCalled();
    expect(sandbox.alert).not.toHaveBeenCalled();
  });

  test('surfaces busy states without opening the review modal', async () => {
    const sandbox = loadTagSearchModule();
    sandbox.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, code: 'library_scan_running', message: 'A library scan is running' })
    });

    await sandbox.__tagSearch.runTagSearchForComic({ id: 'mock-comic-id' });

    expect(window.openCTModal).not.toHaveBeenCalled();
    expect(sandbox.alert).toHaveBeenCalledWith(expect.stringContaining('library scan is running'));
  });

  test('offers a forced retry when the engine skips an already-tagged comic', async () => {
    const sandbox = loadTagSearchModule();
    sandbox.confirm.mockReturnValue(true);
    sandbox.fetch
      .mockResolvedValueOnce(okResponse({ ok: true, status: 'skipped', reason: 'already complete' }))
      .mockResolvedValueOnce(okResponse({ ok: true, status: 'tagged' }));

    await sandbox.__tagSearch.runTagSearchForComic({ id: 'mock-comic-id' });

    expect(sandbox.confirm).toHaveBeenCalled();
    expect(sandbox.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(sandbox.fetch.mock.calls[1][1].body)).toEqual({
      comicId: 'mock-comic-id',
      force: true
    });
  });

  test('guards against a second in-flight tag search for the same comic', async () => {
    const sandbox = loadTagSearchModule();
    let releaseFirst;
    sandbox.fetch.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = () => resolve(okResponse({ ok: true, status: 'tagged' }));
    }));

    const first = sandbox.__tagSearch.runTagSearchForComic({ id: 'mock-comic-id' });
    await sandbox.__tagSearch.runTagSearchForComic({ id: 'mock-comic-id' });

    expect(sandbox.fetch).toHaveBeenCalledTimes(1);
    expect(sandbox.alert).toHaveBeenCalledWith(expect.stringContaining('already running'));

    releaseFirst();
    await first;
  });

  test('is wired into the comic context menu and the app entrypoint', () => {
    const comicMenu = fs.readFileSync(COMIC_MENU_PATH, 'utf8');
    expect(comicMenu).toContain("createTagSearchItem");
    expect(comicMenu).toContain("actions-tag-search.js");

    const appEntry = fs.readFileSync(APP_ENTRY_PATH, 'utf8');
    expect(appEntry).toContain("actions-tag-search.js");
  });
});
