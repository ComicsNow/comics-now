const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModuleInVm(relPath, sandbox) {
  const fullPath = path.resolve(__dirname, '../../../..', relPath);
  const content = fs.readFileSync(fullPath, 'utf8');

  const cleanContent = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+class\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = class $1')
    .replace(/export\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = function $1')
    .replace(/export\s+async\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = async function $1')
    .replace(/export\s+const\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+let\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');

  const script = new vm.Script(cleanContent);
  script.runInContext(sandbox);
}

describe('Series Sort & Date Extraction Module (series-sort.js)', () => {
  let sandbox;
  let state;
  let localStorageStore;

  beforeEach(() => {
    localStorageStore = {};
    state = {
      seriesSortOrder: 'name',
      currentPublisher: 'Marvel',
      currentView: 'series',
      library: {}
    };

    sandbox = {
      state,
      window: {
        location: { search: '' },
        seriesSortOrder: 'name'
      },
      document: {
        getElementById: jest.fn()
      },
      localStorage: {
        getItem: jest.fn(key => localStorageStore[key] || null),
        setItem: jest.fn((key, val) => { localStorageStore[key] = String(val); }),
        removeItem: jest.fn(key => { delete localStorageStore[key]; })
      },
      console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    loadModuleInVm('public/js/library/render/series-sort.js', sandbox);
  });

  describe('isOrderBySeriesDate', () => {
    test('returns true for date-related sort orders', () => {
      const { isOrderBySeriesDate } = sandbox;
      expect(isOrderBySeriesDate('date')).toBe(true);
      expect(isOrderBySeriesDate('date-asc')).toBe(true);
      expect(isOrderBySeriesDate('date-desc')).toBe(true);
      expect(isOrderBySeriesDate('published-date')).toBe(true);
    });

    test('returns false for name and falsy values', () => {
      const { isOrderBySeriesDate } = sandbox;
      expect(isOrderBySeriesDate('name')).toBe(false);
      expect(isOrderBySeriesDate('')).toBe(false);
      expect(isOrderBySeriesDate(null)).toBe(false);
      expect(isOrderBySeriesDate(undefined)).toBe(false);
    });
  });

  describe('getComicIssueNumber', () => {
    test('extracts numeric issue number from metadata Number, Issue, or IssueNumber', () => {
      const { getComicIssueNumber } = sandbox;
      expect(getComicIssueNumber({ metadata: { Number: '1' } })).toBe(1);
      expect(getComicIssueNumber({ metadata: { Number: '02' } })).toBe(2);
      expect(getComicIssueNumber({ metadata: { Issue: '3.5' } })).toBe(3.5);
      expect(getComicIssueNumber({ metadata: { IssueNumber: '#4' } })).toBe(4);
      expect(getComicIssueNumber({ metadata: { SortNumber: '10' } })).toBe(10);
    });

    test('extracts issue number from comic filename when metadata is absent', () => {
      const { getComicIssueNumber } = sandbox;
      expect(getComicIssueNumber({ name: 'Batman #005 (1940).cbz' })).toBe(5);
      expect(getComicIssueNumber({ name: '01 Closer to Danger.cbz' })).toBe(1);
      expect(getComicIssueNumber({ name: 'Special Edition.cbz' })).toBeNull();
      expect(getComicIssueNumber(null)).toBeNull();
    });
  });

  describe('getComicPublishedDate', () => {
    test('parses year, month, and day from metadata Year, Month, Day', () => {
      const { getComicPublishedDate } = sandbox;
      const res = getComicPublishedDate({ metadata: { Year: '2020', Month: '5', Day: '12' } });
      expect(res.year).toBe('2020');
      expect(res.month).toBe(5);
      expect(res.day).toBe(12);
      expect(res.sortKey).toBe(20200512);
    });

    test('parses ISO date string from CoverDate', () => {
      const { getComicPublishedDate } = sandbox;
      const res = getComicPublishedDate({ metadata: { CoverDate: '1986-09-01' } });
      expect(res.year).toBe('1986');
      expect(res.month).toBe(9);
      expect(res.day).toBe(1);
      expect(res.sortKey).toBe(19860901);
    });

    test('extracts year from comic name when metadata is missing date', () => {
      const { getComicPublishedDate } = sandbox;
      const res = getComicPublishedDate({ name: 'Detective Comics (1939) #27.cbz' });
      expect(res.year).toBe('1939');
      expect(res.sortKey).toBe(19390101);
    });
  });

  describe('getFirstComicInSeries', () => {
    test('identifies issue #1 as the first comic in a series', () => {
      const { getFirstComicInSeries } = sandbox;
      const c1 = { name: 'Comic #1', metadata: { Number: '1' } };
      const c2 = { name: 'Comic #2', metadata: { Number: '2' } };
      const c3 = { name: 'Comic #3', metadata: { Number: '3' } };

      expect(getFirstComicInSeries([c3, c1, c2])).toBe(c1);
    });

    test('sorts by lowest issue number if #1 is not present', () => {
      const { getFirstComicInSeries } = sandbox;
      const c4 = { name: 'Comic #4', metadata: { Number: '4' } };
      const c2 = { name: 'Comic #2', metadata: { Number: '2' } };

      expect(getFirstComicInSeries([c4, c2])).toBe(c2);
    });
  });

  describe('getSeriesPublishedInfo', () => {
    test('calculates earliest published year and sortKey across series issues', () => {
      const { getSeriesPublishedInfo } = sandbox;
      const c1 = { name: 'Issue 1', metadata: { Number: '1', Year: '2015', Month: '3' } };
      const c2 = { name: 'Issue 2', metadata: { Number: '2', Year: '2015', Month: '4' } };

      const info = getSeriesPublishedInfo([c1, c2]);
      expect(info.firstComic).toBe(c1);
      expect(info.year).toBe('2015');
      expect(info.sortKey).toBe(20150301);
    });
  });
});
