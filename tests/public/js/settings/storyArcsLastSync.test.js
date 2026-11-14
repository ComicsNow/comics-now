/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadStoryArcsModule(relPath, extraScope = {}) {
  const fullPath = path.resolve(__dirname, '../../../../', relPath);
  let code = fs.readFileSync(fullPath, 'utf8');
  code = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/export\s+async\s+function\s+/g, 'async function ');
  code = code.replace(/export\s+function\s+/g, 'function ');

  const sandbox = {
    document,
    window,
    console,
    Date,
    Number,
    String,
    Proxy,
    globalThis,
    state: { API_BASE_URL: 'http://localhost:3000' },
    canonicalGlobal: { API_BASE_URL: 'http://localhost:3000' },
    fetch: (...args) => global.fetch(...args),
    ...extraScope
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

describe('Story Arcs Last Synchronization timestamp formatting', () => {
  afterEach(() => {
    delete global.fetch;
    document.body.innerHTML = '';
  });

  test('converts Unix seconds from Python crawler to a current date instead of 1970', () => {
    const mod = loadStoryArcsModule('public/js/settings/story-arcs-settings.js');
    const unixSeconds = 1794626217; // 2026-11-14
    const formatted = mod.formatLastSyncTimestamp(unixSeconds);
    expect(formatted).not.toContain('1970');
    expect(formatted).toContain('2026');
  });

  test('preserves millisecond timestamps without double-multiplying', () => {
    const mod = loadStoryArcsModule('public/js/settings/story-arcs-settings.js');
    const unixMs = 1794626217000;
    expect(mod.formatLastSyncTimestamp(unixMs)).toBe(mod.formatLastSyncTimestamp(1794626217));
  });

  test('returns Never for null, undefined, or zero', () => {
    const mod = loadStoryArcsModule('public/js/settings/story-arcs-settings.js');
    expect(mod.formatLastSyncTimestamp(null)).toBe('Never');
    expect(mod.formatLastSyncTimestamp(undefined)).toBe('Never');
    expect(mod.formatLastSyncTimestamp(0)).toBe('Never');
  });

  test('refreshStoryArcsStatus renders non-1970 date in #story-arcs-last-sync-text', async () => {
    const settingsMod = loadStoryArcsModule('public/js/settings/story-arcs-settings.js');
    const tabMod = loadStoryArcsModule('public/js/settings/story-arcs-tab.js', {
      formatLastSyncTimestamp: settingsMod.formatLastSyncTimestamp,
      smartScrollToBottom: () => {},
      fetchBatchTagPublishers: () => {},
      refreshBatchTagStatus: () => {},
      initBatchTaggerListeners: () => {},
      clearStoryArcsCache: () => {},
      fetchAllStoryArcs: () => {}
    });

    document.body.innerHTML = '<span id="story-arcs-last-sync-text">Never</span>';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        isSyncing: false,
        orderCount: 146,
        lastSyncTime: 1794626217
      })
    });

    await tabMod.refreshStoryArcsStatus();

    const text = document.getElementById('story-arcs-last-sync-text').textContent;
    expect(text).not.toContain('1970');
    expect(text).toContain('2026');
  });

  test('refreshStoryArcsSyncStatus renders non-1970 date in #reading-orders-last-sync-text', async () => {
    const settingsMod = loadStoryArcsModule('public/js/settings/story-arcs-settings.js');
    document.body.innerHTML = '<span id="reading-orders-last-sync-text">Last Sync: Never</span>';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        isSyncing: false,
        orderCount: 146,
        lastSyncTime: 1794626217
      })
    });

    await settingsMod.refreshStoryArcsSyncStatus();

    const text = document.getElementById('reading-orders-last-sync-text').textContent;
    expect(text).not.toContain('1970');
    expect(text).toContain('2026');
  });
});
