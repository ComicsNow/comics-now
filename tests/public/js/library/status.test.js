/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createStatusSandbox() {
  const state = {
    currentView: 'comics',
    currentRootFolder: 'Comics',
    activeFilter: 'all',
    activeSmartFilter: null,
    library: {}
  };

  const sandbox = {
    window: window,
    document: document,
    Element: window.Element,
    state: state,
    console: console,
    jest: jest,
    fetch: jest.fn(),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve('/opt/comics-now', relPath);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+class\s+/g, 'class ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+/g, '')
      .replace(/const\s+global\s*=/g, 'var global =');
    vm.runInContext(content, sandbox);
  }

  return { sandbox, loadFile, state };
}

describe('Library Status Module', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="in-progress-count"></div>
      <div id="read-count"></div>
      <div id="unread-count"></div>
      <button class="filter-btn" data-filter="unread"><span class="pill-label">Unread</span></button>
      <button class="filter-btn" data-filter="in-progress"><span class="pill-label">In Progress</span></button>
      <button class="filter-btn" data-filter="read"><span class="pill-label">Read</span></button>
    `;
    env = createStatusSandbox();
    env.loadFile('public/js/library/status/calculator.js');
    env.loadFile('public/js/library/status/dom-sync.js');
    env.loadFile('public/js/library/status.js');
  });

  test('getComicStatus accurately evaluates unread, in-progress, and read states', () => {
    const { getComicStatus } = env.sandbox;

    expect(getComicStatus(null)).toBe('unread');
    expect(getComicStatus({ progress: { totalPages: 20, lastReadPage: 0 } })).toBe('unread');
    expect(getComicStatus({ progress: { totalPages: 20, lastReadPage: 10 } })).toBe('in-progress');
    expect(getComicStatus({ progress: { totalPages: 20, lastReadPage: 19 } })).toBe('read');
    expect(getComicStatus({ progress: { totalPages: 20, lastReadPage: 20 } })).toBe('read');
  });

  test('getSeriesStatus aggregates comic progress across series issues', () => {
    const { getSeriesStatus } = env.sandbox;

    expect(getSeriesStatus([])).toBe('unread');
    expect(getSeriesStatus([
      { progress: { totalPages: 10, lastReadPage: 0 } },
      { progress: { totalPages: 10, lastReadPage: 0 } }
    ])).toBe('unread');

    expect(getSeriesStatus([
      { progress: { totalPages: 10, lastReadPage: 9 } },
      { progress: { totalPages: 10, lastReadPage: 0 } }
    ])).toBe('in-progress');

    expect(getSeriesStatus([
      { progress: { totalPages: 10, lastReadPage: 9 } },
      { progress: { totalPages: 10, lastReadPage: 10 } }
    ])).toBe('read');
  });

  test('getComicStatusCounts computes total, inProgress, read, and unread counts', () => {
    const { getComicStatusCounts } = env.sandbox;

    const comics = [
      { progress: { totalPages: 10, lastReadPage: 0 } },
      { progress: { totalPages: 10, lastReadPage: 5 } },
      { progress: { totalPages: 10, lastReadPage: 9 } }
    ];

    const counts = getComicStatusCounts(comics);
    expect(counts).toEqual({
      total: 3,
      unread: 1,
      inProgress: 1,
      read: 1
    });
  });

  test('updateLibraryReadStatus marks comic as read or unread and refreshes DOM counts', () => {
    const { updateLibraryReadStatus, state } = env.sandbox;

    const comic1 = { id: 'c1', pageCount: 22, progress: { totalPages: 22, lastReadPage: 0 } };
    state.library = {
      Comics: {
        publishers: {
          DC: {
            series: {
              Batman: [comic1]
            }
          }
        }
      }
    };

    updateLibraryReadStatus({ comicId: 'c1', status: 'read' });
    expect(comic1.progress.lastReadPage).toBe(21);
    expect(document.getElementById('read-count').textContent).toBe('1');
    expect(document.getElementById('unread-count').textContent).toBe('0');

    updateLibraryReadStatus({ comicId: 'c1', status: 'unread' });
    expect(comic1.progress.lastReadPage).toBe(0);
    expect(document.getElementById('unread-count').textContent).toBe('1');
    expect(document.getElementById('read-count').textContent).toBe('0');
  });
});
