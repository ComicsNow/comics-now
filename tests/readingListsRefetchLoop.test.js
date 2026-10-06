/**
 * Regression: unbounded reading-lists refetch loop with zero reading lists.
 *
 * Found during the Tailwind v4 migration Phase 0 e2e runs: with an empty
 * reading-list collection, the lazy loaders in smartlists.js re-triggered each
 * other (fetchAndCacheReadingLists -> updateReadingListFilterButtonCount ->
 * fetchAndCacheReadingLists -> ...), hammering GET /api/v1/reading-lists at
 * ~200 req/s for as long as the page stayed open. That burned the server rate
 * limiter and caused 429 waves in Playwright runs. The same loop affected the
 * prod client for any user with no reading lists.
 *
 * Contract verified here:
 *  - render-time triggers fetch once and remember an empty result (no storm);
 *  - concurrent render-time triggers share a single in-flight request;
 *  - an explicit fetchAndCacheReadingLists() call still refreshes (mutations);
 *  - setCachedReadingLists() marks the cache fresh without refetching.
 *
 * The fetch mock stops resolving after a bounded number of calls so a RED run
 * (the buggy code recursing) fails fast instead of starving the event loop.
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MAX_RESOLVED_FETCHES = 40;

function createModuleSandbox(fetchImpl) {
  const state = {
    currentView: 'root',
    currentRootFolder: null,
    currentPublisher: null,
    activeSmartFilter: null,
    activeFilter: 'all',
    library: {}
  };

  const sandbox = {
    window: window,
    document: document,
    state: state,
    console: console,
    fetch: fetchImpl
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // Helper to load ES-module-like file into sandbox
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

// Responds with an empty reading-list collection, exactly like a user account
// that has never created a list. Cuts off after MAX_RESOLVED_FETCHES with a
// never-settling promise so a runaway loop stalls instead of hanging jest.
function createEmptyListFetchMock() {
  let calls = 0;
  const impl = jest.fn(() => {
    calls += 1;
    if (calls > MAX_RESOLVED_FETCHES) {
      return new Promise(() => {});
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, lists: [] })
    });
  });
  return { impl, getCalls: () => calls };
}

// Macrotask drain: lets the async fetch chain run to completion (or to the
// mock's cutoff) before asserting.
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

describe('smartlists reading-list lazy fetch (no refetch loop on empty library)', () => {
  let env;
  let fetchMock;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="dynamic-reading-list-filter-btn" class="hidden">
        <span id="dynamic-reading-list-filter-count">0</span>
      </div>
    `;

    fetchMock = createEmptyListFetchMock();
    env = createModuleSandbox(fetchMock.impl);
    env.loadFile('../public/js/library/smartlists.js');
  });

  test('render-time triggers fetch once and remember the empty result', async () => {
    env.sandbox.getReadingListsForPublisher('Marvel');
    await settle();
    env.sandbox.updateReadingListFilterButtonCount();
    await settle();
    env.sandbox.getReadingListsForPublisher('DC');
    await settle();

    expect(fetchMock.getCalls()).toBe(1);
  });

  test('concurrent render-time triggers share one in-flight request', async () => {
    env.sandbox.getReadingListsForPublisher('Marvel');
    env.sandbox.updateReadingListFilterButtonCount();
    env.sandbox.getReadingListsForPublisher('DC');
    await settle();

    expect(fetchMock.getCalls()).toBe(1);
  });

  test('explicit fetchAndCacheReadingLists() still refreshes (mutation flow)', async () => {
    await env.sandbox.fetchAndCacheReadingLists();
    expect(fetchMock.getCalls()).toBe(1);

    await env.sandbox.fetchAndCacheReadingLists();
    expect(fetchMock.getCalls()).toBe(2);
  });

  test('setCachedReadingLists() marks the cache fresh without refetching', async () => {
    env.sandbox.setCachedReadingLists([]);
    await settle();
    env.sandbox.updateReadingListFilterButtonCount();
    await settle();

    expect(fetchMock.getCalls()).toBe(0);
  });
});
