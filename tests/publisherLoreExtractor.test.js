const {
  extractReadingListSchema,
  validateReadingListRules,
  syncExtractedLoreToDatabase,
  buildLorePrompt
} = require('../server/services/publisher-lore-extractor');

describe('Publisher Lore & Reading Order Extractor (TDD)', () => {
  describe('extractReadingListSchema & Validation', () => {
    test('enforces Rule 3: rejects single-series lists', () => {
      const singleSeriesData = {
        name: 'Batman by Snyder',
        publisher: 'DC Comics',
        issues: [
          { series: 'Batman', number: '1', sort_order: 1 },
          { series: 'Batman', number: '2', sort_order: 2 },
          { series: 'Batman', number: '3', sort_order: 3 },
          { series: 'Batman', number: '4', sort_order: 4 }
        ]
      };

      const result = validateReadingListRules(singleSeriesData);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/multi-series/i);
    });

    test('enforces Rule 4: rejects lists with fewer than 3 comics', () => {
      const shortListData = {
        name: 'Short Crossover',
        publisher: 'DC Comics',
        issues: [
          { series: 'Batman', number: '1', sort_order: 1 },
          { series: 'Superman', number: '1', sort_order: 2 }
        ]
      };

      const result = validateReadingListRules(shortListData);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/threshold|fewer than 3/i);
    });

    test('accepts valid multi-series storyline meeting threshold >= 3', () => {
      const validListData = {
        name: 'Crisis on Infinite Earths Event',
        publisher: 'DC Comics',
        issues: [
          { series: 'Crisis on Infinite Earths', number: '1', sort_order: 1 },
          { series: 'All-Star Squadron', number: '53', sort_order: 2 },
          { series: 'Crisis on Infinite Earths', number: '2', sort_order: 3 }
        ]
      };

      const result = validateReadingListRules(validListData);
      expect(result.valid).toBe(true);
    });
  });

  describe('syncExtractedLoreToDatabase with Rules & Multi-User Parity', () => {
    let mockDb;
    let tables;

    beforeEach(() => {
      tables = {
        users: [
          { userId: 'default-user' },
          { userId: 'user-2' },
          { userId: 'user-3' }
        ],
        comics: [
          { id: 'c1', series: 'Crisis on Infinite Earths', name: 'Crisis on Infinite Earths #1', publisher: 'DC Comics' },
          { id: 'c2', series: 'All-Star Squadron', name: 'All-Star Squadron #53', publisher: 'DC Comics' },
          { id: 'c3', series: 'Crisis on Infinite Earths', name: 'Crisis on Infinite Earths #2', publisher: 'DC Comics' }
        ],
        reading_lists: [],
        reading_list_items: []
      };

      mockDb = {
        dbAll: async (sql, params = []) => {
          if (sql.includes('FROM users')) return tables.users;
          if (sql.includes('FROM comics')) return tables.comics;
          if (sql.includes('FROM reading_lists')) return tables.reading_lists;
          if (sql.includes('FROM reading_list_items')) return tables.reading_list_items;
          return [];
        },
        dbGet: async (sql, params = []) => {
          if (sql.includes('FROM reading_lists WHERE name = ?')) {
            return tables.reading_lists.find(r => r.name === params[0] && r.userId === params[1]);
          }
          return null;
        },
        dbRun: async (sql, params = []) => {
          if (sql.includes('INSERT INTO reading_lists')) {
            const [id, userId, name, desc, sortOrder, created, updated] = params;
            tables.reading_lists.push({ id, userId, name, description: desc, sortOrder, created, updated });
            return { lastID: tables.reading_lists.length };
          }
          if (sql.includes('INSERT OR IGNORE INTO reading_list_items')) {
            const [listId, comicId, addedAt, sortOrder] = params;
            const exists = tables.reading_list_items.some(i => i.listId === listId && i.comicId === comicId);
            if (!exists) {
              tables.reading_list_items.push({ listId, comicId, addedAt, sortOrder });
            }
            return { changes: exists ? 0 : 1 };
          }
          return { changes: 1 };
        }
      };
    });

    test('syncs extracted list to database across all registered users with parity', async () => {
      const extractedData = {
        reading_list: {
          name: 'Crisis on Infinite Earths Chronology',
          description: 'The multiverse collapse and rebirth storyline.',
          publisher: 'DC Comics',
          issues: [
            { series: 'Crisis on Infinite Earths', number: '1', sort_order: 1 },
            { series: 'All-Star Squadron', number: '53', sort_order: 2 },
            { series: 'Crisis on Infinite Earths', number: '2', sort_order: 3 }
          ]
        },
        story_arc: {
          name: 'Crisis on Infinite Earths',
          publisher: 'DC Comics'
        },
        multiverse_lore: [
          { designation: 'Earth-1', reality_name: 'Silver/Bronze Age DC Universe' }
        ]
      };

      const res = await syncExtractedLoreToDatabase(mockDb, extractedData);
      expect(res.success).toBe(true);
      expect(res.matchedComicsCount).toBe(3);
      expect(res.usersSynced).toBe(3);

      // Verify list was created for all 3 users
      const defaultList = tables.reading_lists.find(r => r.userId === 'default-user');
      expect(defaultList).toBeDefined();
      expect(defaultList.name).toBe('Crisis on Infinite Earths Chronology');

      const user2List = tables.reading_lists.find(r => r.userId === 'user-2');
      expect(user2List).toBeDefined();

      const user3List = tables.reading_lists.find(r => r.userId === 'user-3');
      expect(user3List).toBeDefined();

      // Verify items were synced with correct sortOrder
      const defaultItems = tables.reading_list_items.filter(i => i.listId === defaultList.id);
      expect(defaultItems.length).toBe(3);
      expect(defaultItems[0].sortOrder).toBe(1);
      expect(defaultItems[1].sortOrder).toBe(2);
      expect(defaultItems[2].sortOrder).toBe(3);
    });

    test('enforces Rule 5: skips creation if reading list already exists for user', async () => {
      tables.reading_lists.push({
        id: 'existing-1',
        userId: 'default-user',
        name: 'Crisis on Infinite Earths Chronology'
      });

      const extractedData = {
        reading_list: {
          name: 'Crisis on Infinite Earths Chronology',
          publisher: 'DC Comics',
          issues: [
            { series: 'Crisis on Infinite Earths', number: '1', sort_order: 1 },
            { series: 'All-Star Squadron', number: '53', sort_order: 2 },
            { series: 'Crisis on Infinite Earths', number: '2', sort_order: 3 }
          ]
        }
      };

      const res = await syncExtractedLoreToDatabase(mockDb, extractedData);
      expect(res.success).toBe(false);
      expect(res.reason).toMatch(/duplicate|already exists/i);
    });
  });
});
