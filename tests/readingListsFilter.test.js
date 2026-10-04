/**
 * Tests for reading list filter/search logic.
 * filterReadingLists(lists, { search, publisher }) — pure function, no DOM.
 */

const { filterReadingLists } = require('../server/utils/readingListsFilter');

const LISTS = [
  {
    id: 'list-1',
    name: 'Batman: Year One',
    publishers: ['DC Comics'],
    totalComics: 4
  },
  {
    id: 'list-2',
    name: 'Spider-Man Essentials',
    publishers: ['Marvel'],
    totalComics: 12
  },
  {
    id: 'list-3',
    name: 'Batman: The Long Halloween',
    publishers: ['DC Comics'],
    totalComics: 13
  },
  {
    id: 'list-4',
    name: 'X-Men: Dark Phoenix',
    publishers: ['Marvel'],
    totalComics: 6
  },
  {
    id: 'list-5',
    name: 'Saga Vol. 1',
    publishers: ['Image'],
    totalComics: 6
  },
  {
    id: 'list-6',
    name: 'Mixed Publisher List',
    publishers: ['DC Comics', 'Marvel'],
    totalComics: 3
  },
  {
    id: 'list-7',
    name: 'Empty Publishers',
    publishers: [],
    totalComics: 2
  }
];

describe('filterReadingLists', () => {
  describe('no filters', () => {
    it('returns all lists when called with empty options', () => {
      expect(filterReadingLists(LISTS, {})).toHaveLength(LISTS.length);
    });

    it('returns all lists when called with null search and null publisher', () => {
      expect(filterReadingLists(LISTS, { search: null, publisher: null })).toHaveLength(LISTS.length);
    });

    it('returns all lists when search is empty string', () => {
      expect(filterReadingLists(LISTS, { search: '  ' })).toHaveLength(LISTS.length);
    });
  });

  describe('search by name', () => {
    it('matches case-insensitively', () => {
      const result = filterReadingLists(LISTS, { search: 'batman' });
      expect(result).toHaveLength(2);
      expect(result.map(l => l.id)).toEqual(expect.arrayContaining(['list-1', 'list-3']));
    });

    it('matches partial name', () => {
      const result = filterReadingLists(LISTS, { search: 'spider' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('list-2');
    });

    it('returns empty array when no match', () => {
      const result = filterReadingLists(LISTS, { search: 'zzznomatch' });
      expect(result).toHaveLength(0);
    });

    it('trims whitespace from search term', () => {
      const result = filterReadingLists(LISTS, { search: '  saga  ' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('list-5');
    });

    it('matches mid-word substring', () => {
      const result = filterReadingLists(LISTS, { search: 'ong' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('list-3'); // "The Long Halloween"
    });
  });

  describe('filter by publisher', () => {
    it('returns lists whose publishers array includes the given publisher', () => {
      const result = filterReadingLists(LISTS, { publisher: 'DC Comics' });
      // list-1, list-3, and list-6 (mixed) all include DC Comics
      expect(result.map(l => l.id)).toEqual(expect.arrayContaining(['list-1', 'list-3', 'list-6']));
      expect(result.find(l => l.id === 'list-2')).toBeUndefined();
    });

    it('returns lists for Marvel publisher', () => {
      const result = filterReadingLists(LISTS, { publisher: 'Marvel' });
      expect(result.map(l => l.id)).toEqual(expect.arrayContaining(['list-2', 'list-4', 'list-6']));
    });

    it('does not return lists with no publishers for a publisher filter', () => {
      const result = filterReadingLists(LISTS, { publisher: 'Image' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('list-5');
    });

    it('returns empty array when no lists match the publisher', () => {
      const result = filterReadingLists(LISTS, { publisher: 'Dark Horse' });
      expect(result).toHaveLength(0);
    });

    it('returns all lists when publisher filter is empty string', () => {
      const result = filterReadingLists(LISTS, { publisher: '' });
      expect(result).toHaveLength(LISTS.length);
    });

    it('returns all lists when publisher filter is null', () => {
      const result = filterReadingLists(LISTS, { publisher: null });
      expect(result).toHaveLength(LISTS.length);
    });
  });

  describe('combined search + publisher filter', () => {
    it('applies both filters with AND logic', () => {
      const result = filterReadingLists(LISTS, { search: 'batman', publisher: 'DC Comics' });
      expect(result).toHaveLength(2);
      expect(result.map(l => l.id)).toEqual(expect.arrayContaining(['list-1', 'list-3']));
    });

    it('returns empty when search matches but publisher does not', () => {
      const result = filterReadingLists(LISTS, { search: 'batman', publisher: 'Marvel' });
      expect(result).toHaveLength(0);
    });

    it('returns empty when publisher matches but search does not', () => {
      const result = filterReadingLists(LISTS, { search: 'zzznomatch', publisher: 'DC Comics' });
      expect(result).toHaveLength(0);
    });
  });

  describe('extractPublishers', () => {
    const { extractPublishers } = require('../server/utils/readingListsFilter');

    it('returns unique sorted publisher names from a list of reading lists', () => {
      const result = extractPublishers(LISTS);
      expect(result).toEqual(['DC Comics', 'Image', 'Marvel']);
    });

    it('excludes empty publisher entries', () => {
      const result = extractPublishers(LISTS);
      expect(result).not.toContain('');
    });

    it('handles lists with no publishers', () => {
      const result = extractPublishers([{ publishers: [] }, { publishers: ['Image'] }]);
      expect(result).toEqual(['Image']);
    });
  });

  describe('edge cases', () => {
    it('handles null/undefined list items gracefully', () => {
      const listsWithNulls = [...LISTS, null, undefined];
      expect(() => filterReadingLists(listsWithNulls, { search: 'batman' })).not.toThrow();
    });

    it('handles missing publishers field', () => {
      const lists = [{ id: 'x', name: 'Test', totalComics: 1 }];
      const result = filterReadingLists(lists, { publisher: 'DC Comics' });
      expect(result).toHaveLength(0);
    });

    it('returns empty array for empty input', () => {
      expect(filterReadingLists([], { search: 'batman' })).toHaveLength(0);
    });
  });
});
