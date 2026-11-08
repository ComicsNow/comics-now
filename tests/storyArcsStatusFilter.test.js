/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Story Arcs Status Filter UI & Logic', () => {
  let sandbox;
  let sampleArcs;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="series-list">
        <h2 id="series-title">DC Comics</h2>
        <div class="smart-filter-mount"></div>
        <div id="series-alpha-filter"></div>
        <div id="series-sort-container"></div>
        <div id="series-list-container"></div>
      </div>
    `;

    sampleArcs = [
      // 1. In Progress (owned > 0, reading > 0 or 0 < read < total)
      {
        id: 'arc-in-progress',
        title: 'Dark Nights: Metal',
        publisher: 'DC Comics',
        edition: 'collection',
        totalCollections: 8,
        totalIssues: 29,
        ownedCount: 5,
        readCount: 2,
        readPercent: 25.0,
        completenessPercent: 62.5,
        readStatusCounts: { reading: 1, read: 2, unread: 2, missing: 3 }
      },
      // 2. Unread (owned > 0, read == 0, reading == 0)
      {
        id: 'arc-unread',
        title: 'Absolute Power',
        publisher: 'DC Comics',
        edition: 'collection',
        totalCollections: 12,
        totalIssues: 49,
        ownedCount: 4,
        readCount: 0,
        readPercent: 0.0,
        completenessPercent: 33.3,
        readStatusCounts: { reading: 0, read: 0, unread: 4, missing: 8 }
      },
      // 3. Not in Library (owned == 0)
      {
        id: 'arc-not-in-library',
        title: '52',
        publisher: 'DC Comics',
        edition: 'collection',
        totalCollections: 5,
        totalIssues: 52,
        ownedCount: 0,
        readCount: 0,
        readPercent: 0.0,
        completenessPercent: 0.0,
        readStatusCounts: { reading: 0, read: 0, unread: 0, missing: 5 }
      },
      // 4. Completed (read == total, or read == owned when 100% complete)
      {
        id: 'arc-completed',
        title: 'Watchmen',
        publisher: 'DC Comics',
        edition: 'collection',
        totalCollections: 1,
        totalIssues: 12,
        ownedCount: 1,
        readCount: 1,
        readPercent: 100.0,
        completenessPercent: 100.0,
        readStatusCounts: { reading: 0, read: 1, unread: 0, missing: 0 }
      }
    ];

    const state = {
      API_BASE_URL: 'http://localhost:3000'
    };

    sandbox = {
      window,
      document,
      console,
      setTimeout,
      clearTimeout,
      state,
      getStoryArcsForPublisher: jest.fn().mockReturnValue(sampleArcs),
      fetchStoryArcsForPublisher: jest.fn().mockResolvedValue(sampleArcs),
      getStoryArcEditionPreference: jest.fn().mockReturnValue('collections'),
      showStoryArcDetail: jest.fn(),
      clearElement: el => { if (el) el.innerHTML = ''; },
      render: (el, content) => { if (el) el.innerHTML = content?.toHTML ? content.toHTML() : String(content || ''); },
      html: (strings, ...values) => ({ toHTML: () => strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '') }),
      raw: v => String(v || ''),
      escapeHtml: str => String(str || ''),
      createEmptyMessage: msg => `<div>${msg}</div>`
    };

    vm.createContext(sandbox);

    const loadModule = (relPath) => {
      const fullPath = path.resolve(__dirname, relPath);
      const code = fs.readFileSync(fullPath, 'utf8')
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
        .replace(/^\s*import\s+['"][^'"]+['"];?/gm, '')
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+let\s+/g, 'let ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/export\s+\{[\s\S]*?\};?/g, '')
        .replace(/export\s+default\s+[\s\S]*?;?/g, '');
      vm.runInContext(code, sandbox);
    };

    loadModule('../public/js/library/render/story-arcs.js');
  });

  test('filterStoryArcsByStatus correctly classifies arcs into 4 status categories', () => {
    expect(typeof sandbox.filterStoryArcsByStatus).toBe('function');

    const inProgress = sandbox.filterStoryArcsByStatus(sampleArcs, 'in-progress');
    expect(inProgress.map(a => a.id)).toEqual(['arc-in-progress']);

    const unread = sandbox.filterStoryArcsByStatus(sampleArcs, 'unread');
    expect(unread.map(a => a.id)).toEqual(['arc-unread']);

    const notInLibrary = sandbox.filterStoryArcsByStatus(sampleArcs, 'not-in-library');
    expect(notInLibrary.map(a => a.id)).toEqual(['arc-not-in-library']);

    const completed = sandbox.filterStoryArcsByStatus(sampleArcs, 'completed');
    expect(completed.map(a => a.id)).toEqual(['arc-completed']);

    const all = sandbox.filterStoryArcsByStatus(sampleArcs, 'all');
    expect(all.length).toBe(4);
  });

  test('unread filter strictly requires ownedCount > 0 and readCount == 0 and reading == 0', () => {
    // Arc with 0 owned should NOT be unread
    const notOwned = { ownedCount: 0, readCount: 0, readStatusCounts: { reading: 0 } };
    expect(sandbox.filterStoryArcsByStatus([notOwned], 'unread')).toHaveLength(0);

    // Arc with owned > 0 and 0 read should be unread
    const unreadOwned = { ownedCount: 2, readCount: 0, readStatusCounts: { reading: 0 } };
    expect(sandbox.filterStoryArcsByStatus([unreadOwned], 'unread')).toHaveLength(1);

    // Arc with owned > 0 but reading > 0 should NOT be unread
    const readingOwned = { ownedCount: 2, readCount: 0, readStatusCounts: { reading: 1 } };
    expect(sandbox.filterStoryArcsByStatus([readingOwned], 'unread')).toHaveLength(0);
  });

  test('renderPublisherStoryArcs defaults to in-progress filter and renders filter pills with counts', async () => {
    await sandbox.renderPublisherStoryArcs('DC Comics');

    const filterBar = document.getElementById('story-arcs-status-filter');
    expect(filterBar).not.toBeNull();

    // Verify pills exist
    const inProgBtn = filterBar.querySelector('[data-status="in-progress"]');
    const unreadBtn = filterBar.querySelector('[data-status="unread"]');
    const notInLibBtn = filterBar.querySelector('[data-status="not-in-library"]');
    const compBtn = filterBar.querySelector('[data-status="completed"]');
    const allBtn = filterBar.querySelector('[data-status="all"]');

    expect(inProgBtn).not.toBeNull();
    expect(unreadBtn).not.toBeNull();
    expect(notInLibBtn).not.toBeNull();
    expect(compBtn).not.toBeNull();
    expect(allBtn).not.toBeNull();

    // In Progress is active by default
    expect(inProgBtn.classList.contains('active')).toBe(true);

    // Counts inside labels
    expect(inProgBtn.textContent).toContain('1');
    expect(unreadBtn.textContent).toContain('1');
    expect(notInLibBtn.textContent).toContain('1');
    expect(compBtn.textContent).toContain('1');
    expect(allBtn.textContent).toContain('4');

    // Only in-progress cards are displayed initially
    const cards = document.querySelectorAll('.story-arc-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Dark Nights: Metal');
  });

  test('clicking unread filter switches displayed cards to unread story arcs', async () => {
    await sandbox.renderPublisherStoryArcs('DC Comics');

    const filterBar = document.getElementById('story-arcs-status-filter');
    const unreadBtn = filterBar.querySelector('[data-status="unread"]');
    unreadBtn.click();

    const activeBtn = filterBar.querySelector('[data-status="unread"]');
    expect(activeBtn.classList.contains('active')).toBe(true);

    const cards = document.querySelectorAll('.story-arc-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Absolute Power');
  });
});
