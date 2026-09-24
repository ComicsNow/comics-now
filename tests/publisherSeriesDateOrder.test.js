/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createModuleSandbox() {
  const state = {
    currentView: 'series',
    currentRootFolder: 'Library1',
    currentPublisher: 'Marvel',
    currentSeries: null,
    activeSmartFilter: null,
    activeFilter: 'all',
    activeAlphaFilter: 'All',
    seriesSortOrder: 'name',
    downloadedComicIds: new Set(),
    library: {}
  };

  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  const sandbox = {
    window: window,
    document: document,
    state: state,
    console: console,
    requestAnimationFrame: window.requestAnimationFrame,
    fetch: jest.fn(),
    localStorage: {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; },
      clear() { this._data = {}; }
    },
    escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
    applyDisplayInfoToComic: jest.fn(c => ({
      displayTitle: c.name || '',
      subtitle: '',
      altText: c.name || ''
    })),
    getComicStatus: jest.fn(() => 'unread'),
    getComicStatusCounts: jest.fn(() => ({ total: 1, unread: 1, inProgress: 0, read: 0 })),
    statusCountsMatchFilter: jest.fn(() => true),
    makeCountChips: jest.fn(() => '<div class="chips"></div>'),
    getSeriesStatusBanner: jest.fn(() => ''),
    createEmptyMessage: jest.fn(msg => `<div>${msg}</div>`),
    showRootFolderList: jest.fn(),
    showPublisherList: jest.fn(),
    showComicList: jest.fn(),
    showView: jest.fn(),
    mountSmartFilterHostInto: jest.fn(),
    updateBreadcrumb: jest.fn(),
    syncSmartFilterButtons: jest.fn(),
    updateFilterButtonCounts: jest.fn(),
    renderAlphaFilter: jest.fn((target, data, renderFn) => renderFn(data)),
    API_BASE_URL: 'http://localhost:3000',
    ICONS: {
      READ: '<span>read-icon</span>',
      UNREAD: '<span>unread-icon</span>',
      DOWNLOAD: '<span>down-icon</span>'
    },
    filterSeriesByActiveFilter: jest.fn(s => s || {})
  };
  sandbox.globalThis = sandbox;
  sandbox.window.state = state;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.escapeHtml = sandbox.escapeHtml;
  sandbox.window.applyDisplayInfoToComic = sandbox.applyDisplayInfoToComic;
  sandbox.window.ICONS = sandbox.ICONS;
  sandbox.window.API_BASE_URL = sandbox.API_BASE_URL;
  sandbox.window.getComicStatusCounts = sandbox.getComicStatusCounts;
  sandbox.window.statusCountsMatchFilter = sandbox.statusCountsMatchFilter;
  sandbox.window.makeCountChips = sandbox.makeCountChips;
  sandbox.window.getSeriesStatusBanner = sandbox.getSeriesStatusBanner;
  sandbox.window.createEmptyMessage = sandbox.createEmptyMessage;

  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (match, p1) => {
        const names = p1.split(',').map(n => n.trim()).filter(Boolean);
        return names.map(n => `var ${n.replace(/\s+as\s+\w+/, '')} = typeof ${n} !== 'undefined' ? ${n} : (globalThis['${n}'] || (() => {}));`).join('\n');
      })
      .replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"][^'"]+['"];?/g, 'var $1 = typeof $1 !== "undefined" ? $1 : {};')
      .replace(/import\s+(\w+)\s+from\s+['"][^'"]+['"];?/g, 'var $1 = typeof $1 !== "undefined" ? $1 : {};')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    const script = new vm.Script(cleanContent);
    script.runInContext(sandbox);
  }

  return { sandbox, loadFile, state };
}

describe('Publisher Series Published Date Ordering and Year Display', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="series-list">
        <h2 id="series-title">Marvel</h2>
        <div class="smart-filter-mount"></div>
        <div id="series-alpha-filter"></div>
        <div id="series-sort-container">
          <select id="series-sort-select">
            <option value="name">Name (A-Z)</option>
            <option value="date-asc">Published Date (Oldest first)</option>
            <option value="date-desc">Published Date (Newest first)</option>
          </select>
        </div>
        <div id="series-list-container"></div>
      </div>
    `;

    env = createModuleSandbox();
    env.loadFile('../public/js/library/render.js');
  });

  describe('Date and Issue Extraction Helpers', () => {
    test('getComicIssueNumber extracts numeric issue numbers from metadata or name', () => {
      const getComicIssueNumber = env.sandbox.getComicIssueNumber;
      expect(getComicIssueNumber({ metadata: { Number: '1' } })).toBe(1);
      expect(getComicIssueNumber({ metadata: { Number: '02' } })).toBe(2);
      expect(getComicIssueNumber({ metadata: { Issue: '3.5' } })).toBe(3.5);
      expect(getComicIssueNumber({ metadata: { IssueNumber: '#4' } })).toBe(4);
      expect(getComicIssueNumber({ name: 'Batman #005 (1940).cbz' })).toBe(5);
      expect(getComicIssueNumber({ name: '01 Closer to Danger.cbz' })).toBe(1);
      expect(getComicIssueNumber({ metadata: {}, name: 'Special Edition.cbz' })).toBeNull();
    });

    test('getComicPublishedDate extracts year, month, day, and calculates sortKey', () => {
      const getComicPublishedDate = env.sandbox.getComicPublishedDate;

      // From Year, Month, Day metadata
      const date1 = getComicPublishedDate({
        metadata: { Year: '2024', Month: '8', Day: '7' }
      });
      expect(date1.year).toBe('2024');
      expect(date1.month).toBe(8);
      expect(date1.day).toBe(7);
      expect(date1.sortKey).toBe(20240807);

      // From Year only
      const date2 = getComicPublishedDate({
        metadata: { Year: '2021' }
      });
      expect(date2.year).toBe('2021');
      expect(date2.sortKey).toBe(20210101);

      // From CoverDate (ISO format)
      const date3 = getComicPublishedDate({
        metadata: { CoverDate: '2022-06-15' }
      });
      expect(date3.year).toBe('2022');
      expect(date3.month).toBe(6);
      expect(date3.day).toBe(15);
      expect(date3.sortKey).toBe(20220615);

      // From filename fallback
      const date4 = getComicPublishedDate({
        name: '01 Wild Thing [Ablaze] (2020) #155.cbz'
      });
      expect(date4.year).toBe('2020');
      expect(date4.sortKey).toBe(20200101);

      // When no date information exists
      const date5 = getComicPublishedDate({
        name: 'NoDateComic.cbz',
        metadata: {}
      });
      expect(date5.year).toBeNull();
      expect(date5.sortKey).toBeNull();
    });

    test('getFirstComicInSeries correctly identifies the first comic in a series', () => {
      const getFirstComicInSeries = env.sandbox.getFirstComicInSeries;

      const comics = [
        { name: 'Issue 3', metadata: { Number: '3', Year: '2025' } },
        { name: 'Issue 1', metadata: { Number: '1', Year: '2023' } },
        { name: 'Issue 2', metadata: { Number: '2', Year: '2024' } }
      ];

      const first = getFirstComicInSeries(comics);
      expect(first).toBeDefined();
      expect(first.name).toBe('Issue 1');
      expect(first.metadata.Number).toBe('1');
    });

    test('getSeriesPublishedInfo returns published date of first comic in series', () => {
      const getSeriesPublishedInfo = env.sandbox.getSeriesPublishedInfo;

      const seriesComics = [
        { name: 'Issue 3', metadata: { Number: '3', Year: '2025', Month: '9', Day: '24' } },
        { name: 'Issue 1', metadata: { Number: '1', Year: '2024', Month: '8', Day: '7' } },
        { name: 'Issue 2', metadata: { Number: '2', Year: '2025', Month: '4', Day: '30' } }
      ];

      const info = getSeriesPublishedInfo(seriesComics);
      expect(info.firstComic.name).toBe('Issue 1');
      expect(info.year).toBe('2024');
      expect(info.sortKey).toBe(20240807);
    });

    test('getSeriesPublishedInfo falls back to earliest comic if first comic lacks date', () => {
      const getSeriesPublishedInfo = env.sandbox.getSeriesPublishedInfo;

      const seriesComics = [
        { name: 'Issue 1', metadata: { Number: '1' } }, // No date
        { name: 'Issue 2', metadata: { Number: '2', Year: '2022' } }
      ];

      const info = getSeriesPublishedInfo(seriesComics);
      expect(info.year).toBe('2022');
      expect(info.sortKey).toBe(20220101);
    });
  });

  describe('Series Ordering and Year Display in renderSeriesCards', () => {
    let mockSeriesData;

    beforeEach(() => {
      mockSeriesData = {
        'Zeta Series': [
          { name: 'Zeta #1', metadata: { Number: '1', Year: '2019', Month: '5', Day: '1' } }
        ],
        'Alpha Series': [
          { name: 'Alpha #1', metadata: { Number: '1', Year: '2024', Month: '1', Day: '10' } }
        ],
        'Beta Series': [
          { name: 'Beta #1', metadata: { Number: '1', Year: '2021', Month: '11', Day: '1' } }
        ],
        'Undated Series': [
          { name: 'Undated #1', metadata: { Number: '1' } }
        ]
      };
    });

    test('Default (name) sort orders series alphabetically and does NOT show year', () => {
      env.state.seriesSortOrder = 'name';
      env.sandbox.renderSeriesCards(mockSeriesData);

      const cards = document.querySelectorAll('.series-card');
      expect(cards.length).toBe(4);

      const titles = Array.from(cards).map(card => card.querySelector('h3').textContent.trim());
      expect(titles).toEqual([
        'Alpha Series',
        'Beta Series',
        'Undated Series',
        'Zeta Series'
      ]);

      // Verify no year is shown against any series name
      titles.forEach(title => {
        expect(title).not.toMatch(/\(\d{4}\)/);
      });
      expect(document.querySelector('.series-year')).toBeNull();
    });

    test('Published date order (date-asc) orders series by published date of first comic and shows year', () => {
      env.state.seriesSortOrder = 'date-asc';
      env.sandbox.renderSeriesCards(mockSeriesData);

      const cards = document.querySelectorAll('.series-card');
      expect(cards.length).toBe(4);

      const headings = Array.from(cards).map(card => card.querySelector('h3').textContent.trim());
      // Zeta (2019) -> Beta (2021) -> Alpha (2024) -> Undated Series (at end)
      expect(headings).toEqual([
        'Zeta Series (2019)',
        'Beta Series (2021)',
        'Alpha Series (2024)',
        'Undated Series'
      ]);

      // Verify year badge/element exists
      const yearElements = document.querySelectorAll('.series-year');
      expect(yearElements.length).toBe(3);
      expect(yearElements[0].textContent).toBe('(2019)');
      expect(yearElements[1].textContent).toBe('(2021)');
      expect(yearElements[2].textContent).toBe('(2024)');
    });

    test('Published date order (date-desc) orders series newest first and shows year', () => {
      env.state.seriesSortOrder = 'date-desc';
      env.sandbox.renderSeriesCards(mockSeriesData);

      const cards = document.querySelectorAll('.series-card');
      const headings = Array.from(cards).map(card => card.querySelector('h3').textContent.trim());

      // Alpha (2024) -> Beta (2021) -> Zeta (2019) -> Undated Series (at end)
      expect(headings).toEqual([
        'Alpha Series (2024)',
        'Beta Series (2021)',
        'Zeta Series (2019)',
        'Undated Series'
      ]);
    });

    test('value "date" is treated as date order (oldest first)', () => {
      env.state.seriesSortOrder = 'date';
      env.sandbox.renderSeriesCards(mockSeriesData);

      const cards = document.querySelectorAll('.series-card');
      const headings = Array.from(cards).map(card => card.querySelector('h3').textContent.trim());
      expect(headings[0]).toBe('Zeta Series (2019)');
      expect(headings[1]).toBe('Beta Series (2021)');
      expect(headings[2]).toBe('Alpha Series (2024)');
    });

    test('does not duplicate year if series name already ends with year', () => {
      const dataWithYearInName = {
        'Love Everlasting (2022)': [
          { name: 'Love Everlasting #1', metadata: { Number: '1', Year: '2022' } }
        ]
      };

      env.state.seriesSortOrder = 'date-asc';
      env.sandbox.renderSeriesCards(dataWithYearInName);

      const heading = document.querySelector('.series-card h3').textContent.trim();
      expect(heading).toBe('Love Everlasting (2022)');
      expect(heading).not.toBe('Love Everlasting (2022) (2022)');
    });
  });

  describe('UI Controls and Interaction', () => {
    test('initSeriesSortControls syncs select value with state and per-publisher localStorage', () => {
      env.sandbox.localStorage.setItem('publisher_series_sort_Marvel', 'date-asc');
      env.sandbox.initSeriesSortControls();

      const select = document.getElementById('series-sort-select');
      expect(select.value).toBe('date-asc');
      expect(env.state.seriesSortOrder).toBe('date-asc');
    });

    test('defaults to name (A-Z) if no per-publisher preference exists', () => {
      env.state.currentPublisher = 'DC Comics';
      env.sandbox.initSeriesSortControls();

      const select = document.getElementById('series-sort-select');
      expect(select.value).toBe('name');
      expect(env.state.seriesSortOrder).toBe('name');
    });

    test('changing series sort select updates state, per-publisher localStorage, and re-renders', () => {
      env.state.currentPublisher = 'Marvel';
      env.state.library = {
        Library1: {
          publishers: {
            Marvel: {
              series: {
                'Series A': [{ name: 'A #1' }],
                'Series B': [{ name: 'B #1' }]
              }
            }
          }
        }
      };

      env.sandbox.initSeriesSortControls();
      const select = document.getElementById('series-sort-select');

      select.value = 'date-asc';
      select.dispatchEvent(new Event('change'));

      expect(env.state.seriesSortOrder).toBe('date-asc');
      expect(env.sandbox.localStorage.getItem('publisher_series_sort_Marvel')).toBe('date-asc');
      expect(env.sandbox.renderAlphaFilter).toHaveBeenCalled();
    });

    test('setSeriesSortOrder programmatically changes sort order and re-renders', () => {
      env.state.currentPublisher = 'Marvel';
      env.state.library = {
        Library1: {
          publishers: {
            Marvel: {
              series: {
                'Series A': [{ name: 'A #1' }]
              }
            }
          }
        }
      };

      env.sandbox.setSeriesSortOrder('date-desc');

      expect(env.state.seriesSortOrder).toBe('date-desc');
      expect(env.sandbox.localStorage.getItem('publisher_series_sort_Marvel')).toBe('date-desc');
      const select = document.getElementById('series-sort-select');
      expect(select.value).toBe('date-desc');
      expect(env.sandbox.renderAlphaFilter).toHaveBeenCalled();
    });

    test('showSeriesList hides sort controls when in reading-list smart filter mode', () => {
      env.state.library = {
        Library1: {
          publishers: {
            Marvel: { series: {} }
          }
        }
      };
      env.state.activeSmartFilter = 'reading-list';

      const sortContainer = document.getElementById('series-sort-container');
      expect(sortContainer.classList.contains('hidden')).toBe(false);

      env.sandbox.showSeriesList('Marvel', { force: true });
      expect(sortContainer.classList.contains('hidden')).toBe(true);

      // Switch back to normal series view
      env.state.activeSmartFilter = null;
      env.sandbox.showSeriesList('Marvel', { force: true });
      expect(sortContainer.classList.contains('hidden')).toBe(false);
    });
  });
});
