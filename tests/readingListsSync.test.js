const {
  syncDefaultReadingLists,
  syncDefaultReadingListsToAllUsers,
  deleteReadingListGlobally,
  autoSeedNewUserReadingLists
} = require('../server/services/readingLists');

describe('Reading Lists Sync Service', () => {
  let mockDb = {};
  let mockDbRun;
  let mockDbGet;
  let mockDbAll;

  beforeEach(() => {
    mockDb = {
      users: [
        { userId: 'default-user', email: 'local@localhost' },
        { userId: 'user-1', email: 'user1@example.com' },
        { userId: 'user-2', email: 'user2@example.com' }
      ],
      reading_lists: [
        { id: 'list-1', userId: 'default-user', name: 'Batman Saga', description: 'All batman', sortOrder: 0, created: 1000, updated: 1000 },
        { id: 'list-2', userId: 'default-user', name: 'Spider-Man', description: 'Spidey', sortOrder: 1, created: 2000, updated: 2000 }
      ],
      reading_list_items: [
        { listId: 'list-1', comicId: 'comic-100', addedAt: 1000, sortOrder: 0 },
        { listId: 'list-1', comicId: 'comic-101', addedAt: 1000, sortOrder: 1 },
        { listId: 'list-2', comicId: 'comic-200', addedAt: 2000, sortOrder: 0 }
      ]
    };

    mockDbAll = jest.fn(async (query, params = []) => {
      if (query.includes('FROM reading_lists WHERE userId = ?')) {
        return mockDb.reading_lists.filter(l => l.userId === params[0]);
      }
      if (query.includes('FROM users WHERE userId != ?')) {
        return mockDb.users.filter(u => u.userId !== params[0]);
      }
      if (query.includes('FROM reading_list_items WHERE listId = ?')) {
        return mockDb.reading_list_items.filter(i => i.listId === params[0]);
      }
      if (query.includes('FROM reading_lists WHERE name = ? OR id = ?')) {
        return mockDb.reading_lists.filter(l => l.name === params[0] || l.id === params[1]);
      }
      return [];
    });

    mockDbGet = jest.fn(async (query, params = []) => {
      if (query.includes('FROM reading_lists WHERE userId = ? AND name = ?')) {
        return mockDb.reading_lists.find(l => l.userId === params[0] && l.name === params[1]) || null;
      }
      if (query.includes('FROM reading_lists WHERE id = ? LIMIT 1')) {
        return mockDb.reading_lists.find(l => l.id === params[0]) || null;
      }
      if (query.includes('COUNT(*) as count FROM reading_lists WHERE userId = ?')) {
        const count = mockDb.reading_lists.filter(l => l.userId === params[0]).length;
        return { count };
      }
      return null;
    });

    mockDbRun = jest.fn(async (query, params = []) => {
      if (query.includes('INSERT INTO reading_lists')) {
        mockDb.reading_lists.push({
          id: params[0],
          userId: params[1],
          name: params[2],
          description: params[3],
          sortOrder: params[4],
          created: params[5],
          updated: params[6]
        });
      }
      if (query.includes('UPDATE reading_lists SET')) {
        const list = mockDb.reading_lists.find(l => l.id === params[3]);
        if (list) {
          list.description = params[0];
          list.sortOrder = params[1];
          list.updated = params[2];
        }
      }
      if (query.includes('DELETE FROM reading_list_items WHERE listId = ?')) {
        mockDb.reading_list_items = mockDb.reading_list_items.filter(i => i.listId !== params[0]);
      }
      if (query.includes('DELETE FROM reading_lists WHERE id = ?')) {
        mockDb.reading_lists = mockDb.reading_lists.filter(l => l.id !== params[0]);
        mockDb.reading_list_items = mockDb.reading_list_items.filter(i => i.listId !== params[0]);
      }
      if (query.includes('INSERT INTO reading_list_items') || query.includes('INSERT OR IGNORE INTO reading_list_items')) {
        mockDb.reading_list_items.push({
          listId: params[0],
          comicId: params[1],
          addedAt: params[2],
          sortOrder: params[3]
        });
      }
      return { changes: 1 };
    });
  });

  test('syncDefaultReadingLists clones lists from default-user to target user', async () => {
    const result = await syncDefaultReadingLists('user-1', {
      dbRun: mockDbRun,
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      log: jest.fn()
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(2);

    const user1Lists = mockDb.reading_lists.filter(l => l.userId === 'user-1');
    expect(user1Lists.length).toBe(2);
    expect(user1Lists.map(l => l.name)).toEqual(['Batman Saga', 'Spider-Man']);

    const user1ListIds = user1Lists.map(l => l.id);
    const user1Items = mockDb.reading_list_items.filter(i => user1ListIds.includes(i.listId));
    expect(user1Items.length).toBe(3);
  });

  test('syncDefaultReadingLists skips existing lists with same name when overwrite=false', async () => {
    // Pre-populate one list for user-1
    mockDb.reading_lists.push({
      id: 'existing-list',
      userId: 'user-1',
      name: 'Batman Saga',
      description: 'Custom',
      sortOrder: 0,
      created: 500,
      updated: 500
    });

    const result = await syncDefaultReadingLists('user-1', {
      dbRun: mockDbRun,
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      log: jest.fn()
    });

    expect(result.created).toBe(1); // Only Spider-Man created
    expect(result.skipped).toBe(1); // Batman skipped
  });

  test('syncDefaultReadingLists overwrites existing lists when overwrite=true', async () => {
    // Pre-populate an outdated list for user-1
    mockDb.reading_lists.push({
      id: 'existing-list',
      userId: 'user-1',
      name: 'Batman Saga',
      description: 'Old description',
      sortOrder: 5,
      created: 500,
      updated: 500
    });
    mockDb.reading_list_items.push({
      listId: 'existing-list',
      comicId: 'comic-999',
      addedAt: 500,
      sortOrder: 0
    });

    const result = await syncDefaultReadingLists('user-1', {
      dbRun: mockDbRun,
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      log: jest.fn()
    }, { overwrite: true });

    expect(result.created).toBe(1); // Spider-Man created
    expect(result.updated).toBe(1); // Batman updated
    expect(result.skipped).toBe(0);

    const updatedList = mockDb.reading_lists.find(l => l.id === 'existing-list');
    expect(updatedList.description).toBe('All batman');

    const updatedItems = mockDb.reading_list_items.filter(i => i.listId === 'existing-list');
    expect(updatedItems.length).toBe(2);
    expect(updatedItems.map(i => i.comicId)).toEqual(['comic-100', 'comic-101']);
  });

  test('syncDefaultReadingLists prunes obsolete lists when prune=true', async () => {
    // Pre-populate an obsolete list
    mockDb.reading_lists.push({
      id: 'obsolete-list',
      userId: 'user-1',
      name: 'Obsolete List',
      description: 'No longer exists in default-user',
      sortOrder: 0
    });

    const result = await syncDefaultReadingLists('user-1', {
      dbRun: mockDbRun,
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      log: jest.fn()
    }, { prune: true });

    expect(result.pruned).toBe(1);
    expect(mockDb.reading_lists.find(l => l.id === 'obsolete-list')).toBeUndefined();
  });

  test('syncDefaultReadingListsToAllUsers syncs to all non-default users', async () => {
    const result = await syncDefaultReadingListsToAllUsers({
      dbRun: mockDbRun,
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      log: jest.fn()
    });

    expect(result.usersCount).toBe(2);
    expect(result.totalCreated).toBe(4); // 2 lists x 2 users
  });

  test('deleteReadingListGlobally deletes list across all users', async () => {
    mockDb.reading_lists.push({
      id: 'user1-list',
      userId: 'user-1',
      name: 'Batman Saga'
    });

    const result = await deleteReadingListGlobally('Batman Saga', {
      dbRun: mockDbRun,
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      log: jest.fn()
    });

    expect(result.deletedCount).toBe(2); // default-user list and user-1 list
    expect(mockDb.reading_lists.filter(l => l.name === 'Batman Saga').length).toBe(0);
  });

  test('autoSeedNewUserReadingLists seeds if user has 0 lists', async () => {
    await autoSeedNewUserReadingLists('user-1', {
      dbRun: mockDbRun,
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      log: jest.fn()
    });

    const user1Lists = mockDb.reading_lists.filter(l => l.userId === 'user-1');
    expect(user1Lists.length).toBe(2);
  });

  test('autoSeedNewUserReadingLists does not seed if user already has lists', async () => {
    mockDb.reading_lists.push({
      id: 'existing-1',
      userId: 'user-1',
      name: 'My Custom List'
    });

    await autoSeedNewUserReadingLists('user-1', {
      dbRun: mockDbRun,
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      log: jest.fn()
    });

    // Should still only have that 1 list
    const user1Lists = mockDb.reading_lists.filter(l => l.userId === 'user-1');
    expect(user1Lists.length).toBe(1);
  });
});
