const Database = require('better-sqlite3');
const {
  initLoreDatabase,
  indexReadingOrder,
  getMissingIssuesForOrder,
  syncLoreOrderToComicsNow
} = require('../server/services/lore-index-manager');

describe('Lore Index Manager & Database Bridge (TDD)', () => {
  let loreDb;
  let mockComicsNowDb;

  beforeEach(() => {
    // In-memory lore database
    loreDb = initLoreDatabase(':memory:');

    // In-memory mock comics-now database matching production schema
    mockComicsNowDb = new Database(':memory:');
    mockComicsNowDb.exec(`
      CREATE TABLE users (userId TEXT PRIMARY KEY, email TEXT);
      CREATE TABLE comics (id TEXT PRIMARY KEY, publisher TEXT, series TEXT, name TEXT, issueNumber TEXT);
      CREATE TABLE reading_lists (id TEXT PRIMARY KEY, userId TEXT, name TEXT, description TEXT, sortOrder INTEGER, created INTEGER);
      CREATE TABLE reading_list_items (listId TEXT NOT NULL, comicId TEXT NOT NULL, sortOrder INTEGER, PRIMARY KEY (listId, comicId));

      INSERT INTO users (userId, email) VALUES ('default-user', 'default@localhost');
      INSERT INTO users (userId, email) VALUES ('user-2', 'reader2@localhost');

      INSERT INTO comics (id, publisher, series, name, issueNumber) VALUES
        ('c1', 'Top Shelf', 'The League of Extraordinary Gentlemen: The Tempest', 'Tempest #1', '1'),
        ('c2', 'Top Shelf', 'The League of Extraordinary Gentlemen: The Tempest', 'Tempest #2', '2'),
        ('c3', 'DC Comics', 'The League of Extraordinary Gentlemen: The Omnibus Edition', 'Omnibus', '1');
    `);
  });

  afterEach(() => {
    if (loreDb) loreDb.close();
    if (mockComicsNowDb) mockComicsNowDb.close();
  });

  test('initLoreDatabase creates tables and indexes cleanly', () => {
    const tables = loreDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('reading_orders');
    expect(tables).toContain('reading_order_issues');
    expect(tables).toContain('story_arcs');
    expect(tables).toContain('crossover_bridges');
  });

  test('indexReadingOrder stores canonical issues and flags owned vs missing library comics', () => {
    const canonicalOrder = {
      name: 'The League of Extraordinary Gentlemen Chronology',
      publisher: 'Multiple',
      description: 'The complete Moore & O\'Neill run across 4 publishers.',
      source_url: 'https://example.com/loeg-order',
      issues: [
        { series: 'The League of Extraordinary Gentlemen: The Omnibus Edition', number: '1', title: 'Omnibus', role: 'Core Anchor' },
        { series: 'The League of Extraordinary Gentlemen: The Black Dossier', number: '1', title: 'Black Dossier', role: 'Bridge' },
        { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '1', title: 'Tempest #1', role: 'Finale' },
        { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '2', title: 'Tempest #2', role: 'Finale' },
        { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '3', title: 'Tempest #3', role: 'Finale' }
      ]
    };

    const libraryComics = [
      { id: 'c1', series: 'The League of Extraordinary Gentlemen: The Tempest', issueNumber: '1', publisher: 'Top Shelf', name: 'Tempest #1' },
      { id: 'c2', series: 'The League of Extraordinary Gentlemen: The Tempest', issueNumber: '2', publisher: 'Top Shelf', name: 'Tempest #2' },
      { id: 'c3', series: 'The League of Extraordinary Gentlemen: The Omnibus Edition', issueNumber: '1', publisher: 'DC Comics', name: 'Omnibus' }
    ];

    const orderId = indexReadingOrder(loreDb, canonicalOrder, libraryComics);
    expect(orderId).toBeDefined();

    const orderRow = loreDb.prepare('SELECT * FROM reading_orders WHERE id = ?').get(orderId);
    expect(orderRow.name).toBe('The League of Extraordinary Gentlemen Chronology');
    expect(orderRow.total_canonical_issues).toBe(5);
    expect(orderRow.owned_issues_count).toBe(3);

    const issues = loreDb.prepare('SELECT * FROM reading_order_issues WHERE reading_order_id = ? ORDER BY sequence_num').all(orderId);
    expect(issues.length).toBe(5);
    expect(issues[0].is_owned).toBe(1); // Omnibus is owned
    expect(issues[0].local_comic_id).toBe('c3');
    expect(issues[1].is_owned).toBe(0); // Black Dossier is missing
    expect(issues[1].local_comic_id).toBeNull();
    expect(issues[2].is_owned).toBe(1); // Tempest 1 is owned
    expect(issues[4].is_owned).toBe(0); // Tempest 3 is missing
  });

  test('getMissingIssuesForOrder returns unowned canonical issues for gap tracking', () => {
    const canonicalOrder = {
      name: 'The Tick & Invincible Crossover Event',
      publisher: 'Multiple',
      issues: [
        { series: 'Invincible', number: '1', title: 'Issue 1' },
        { series: 'The Tick: The Tick Meets Invincible', number: '100', title: 'Crossover' }
      ]
    };

    const libraryComics = [
      { id: 't1', series: 'The Tick: The Tick Meets Invincible', issueNumber: '100', name: 'Tick 100' }
    ];

    const orderId = indexReadingOrder(loreDb, canonicalOrder, libraryComics);
    const missing = getMissingIssuesForOrder(loreDb, orderId);

    expect(missing.length).toBe(1);
    expect(missing[0].series).toBe('Invincible');
    expect(missing[0].number).toBe('1');
  });

  test('syncLoreOrderToComicsNow validates threshold rules and creates multi-user parity lists', async () => {
    const canonicalOrder = {
      name: 'The League of Extraordinary Gentlemen Chronology',
      publisher: 'Multiple',
      issues: [
        { series: 'The League of Extraordinary Gentlemen: The Omnibus Edition', number: '1', title: 'Omnibus' },
        { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '1', title: 'Tempest 1' },
        { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '2', title: 'Tempest 2' }
      ]
    };

    const libraryComics = [
      { id: 'c1', series: 'The League of Extraordinary Gentlemen: The Tempest', issueNumber: '1', publisher: 'Top Shelf', name: 'Tempest #1' },
      { id: 'c2', series: 'The League of Extraordinary Gentlemen: The Tempest', issueNumber: '2', publisher: 'Top Shelf', name: 'Tempest #2' },
      { id: 'c3', series: 'The League of Extraordinary Gentlemen: The Omnibus Edition', issueNumber: '1', publisher: 'DC Comics', name: 'Omnibus' }
    ];

    const orderId = indexReadingOrder(loreDb, canonicalOrder, libraryComics);
    const syncResult = await syncLoreOrderToComicsNow(loreDb, mockComicsNowDb, orderId);

    expect(syncResult.success).toBe(true);
    expect(syncResult.matchedComics).toBe(3);
    expect(syncResult.usersSynced).toBe(2); // default-user + user-2

    // Check reading_lists in comics-now.db
    const lists = mockComicsNowDb.prepare('SELECT * FROM reading_lists WHERE name = ?').all('The League of Extraordinary Gentlemen Chronology');
    expect(lists.length).toBe(2); // Synced to both users

    // Check reading_list_items
    const defaultList = lists.find(l => l.userId === 'default-user');
    const items = mockComicsNowDb.prepare('SELECT * FROM reading_list_items WHERE listId = ? ORDER BY sortOrder').all(defaultList.id);
    expect(items.length).toBe(3);
    expect(items[0].comicId).toBe('c3'); // Omnibus
    expect(items[1].comicId).toBe('c1'); // Tempest 1
    expect(items[2].comicId).toBe('c2'); // Tempest 2
  });

  test('syncLoreOrderToComicsNow rejects single-series lists (Rule 3)', async () => {
    const singleSeriesOrder = {
      name: 'Batman Solo Arc',
      publisher: 'DC Comics',
      issues: [
        { series: 'Batman', number: '1' },
        { series: 'Batman', number: '2' },
        { series: 'Batman', number: '3' }
      ]
    };

    const libraryComics = [
      { id: 'b1', series: 'Batman', issueNumber: '1', publisher: 'DC Comics', name: 'Batman 1' },
      { id: 'b2', series: 'Batman', issueNumber: '2', publisher: 'DC Comics', name: 'Batman 2' },
      { id: 'b3', series: 'Batman', issueNumber: '3', publisher: 'DC Comics', name: 'Batman 3' }
    ];

    const orderId = indexReadingOrder(loreDb, singleSeriesOrder, libraryComics);
    const syncResult = await syncLoreOrderToComicsNow(loreDb, mockComicsNowDb, orderId);

    expect(syncResult.success).toBe(false);
    expect(syncResult.reason).toMatch(/Rule 3 violation/i);
  });
});
