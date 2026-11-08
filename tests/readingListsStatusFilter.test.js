/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createModuleSandbox() {
  const state = {
    currentView: 'series',
    currentPublisher: 'DC Comics',
    activeSmartFilter: 'reading-list',
    activeFilter: 'all',
  };

  const sandbox = {
    window: window,
    document: document,
    state: state,
    console: console,
    clearElement: el => { if (el) el.innerHTML = ''; },
    render: (el, content) => { if (el) el.innerHTML = String(content?.html || content || ''); },
    html: (strings, ...values) => ({ html: strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '') }),
    raw: v => String(v || ''),
    escapeHtml: s => String(s || ''),
    createEmptyMessage: msg => `<div class="empty">${msg}</div>`,
    showSeriesList: jest.fn(),
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

describe('Reading Lists Status Filter', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="series-list-container"></div>
      <div id="smart-scope-mode-toggle"></div>
      <div id="series-alpha-filter"></div>
    `;

    env = createModuleSandbox();
    env.loadFile('../public/js/library/render/reading-lists.js');
  });

  const mockLists = [
    { id: '1', name: 'Batman: Knightfall', totalComics: 10, readComics: 3 }, // in-progress
    { id: '2', name: 'Superman: Death of Superman', totalComics: 8, readComics: 0 }, // unread
    { id: '3', name: 'Crisis on Infinite Earths', totalComics: 12, readComics: 12 }, // completed
    { id: '4', name: 'Flashpoint', totalComics: 5, readComics: 0 }, // unread
  ];

  test('filterReadingListsByStatus correctly segments in-progress, unread, completed, and all', () => {
    const filterReadingListsByStatus = env.sandbox.filterReadingListsByStatus;
    expect(typeof filterReadingListsByStatus).toBe('function');

    const inProgress = filterReadingListsByStatus(mockLists, 'in-progress');
    expect(inProgress.map(l => l.name)).toEqual(['Batman: Knightfall']);

    const unread = filterReadingListsByStatus(mockLists, 'unread');
    expect(unread.map(l => l.name)).toEqual(['Superman: Death of Superman', 'Flashpoint']);

    const completed = filterReadingListsByStatus(mockLists, 'completed');
    expect(completed.map(l => l.name)).toEqual(['Crisis on Infinite Earths']);

    const all = filterReadingListsByStatus(mockLists, 'all');
    expect(all.length).toBe(4);
  });
});
