/**
 * ReadingOrders Database Management & Query Tests
 */
const { initReadingOrdersDb } = require('../server/readingOrdersDb');

describe('ReadingOrders Database Service', () => {
  let dbService;

  beforeEach(() => {
    // Use an in-memory SQLite database for test isolation
    dbService = initReadingOrdersDb(':memory:');
  });

  afterEach(() => {
    if (dbService && dbService.db) {
      dbService.db.close();
    }
  });

  it('initializes schemas without errors', () => {
    const orders = dbService.getReadingOrders();
    expect(orders).toEqual([]);
  });

  it('upserts a reading order and retrieves it', () => {
    dbService.upsertReadingOrder({
      id: 'civil-war',
      title: 'Civil War',
      publisher: 'Marvel Comics',
      url: 'https://readingorders.com/reading-orders/civil-war',
      description: 'The landmark crossover event.',
      coverImage: 'https://readingorders.com/images/issues/4228.png',
      category: 'Event'
    });

    const order = dbService.getReadingOrderById('civil-war');
    expect(order).toBeDefined();
    expect(order.title).toBe('Civil War');
    expect(order.publisher).toBe('Marvel Comics');
  });

  it('upserts issues and queries continuity by series and issue number', () => {
    dbService.upsertReadingOrder({
      id: 'civil-war',
      title: 'Civil War',
      publisher: 'Marvel Comics'
    });

    dbService.upsertIssues('civil-war', [
      {
        position: 1,
        seriesName: 'Civil War',
        issueNumber: '1',
        importance: 'Essential',
        storyParts: 'Part 1',
        publicationDate: 'May 2006'
      },
      {
        position: 2,
        seriesName: 'Civil War: Front Line',
        issueNumber: '1',
        importance: 'Tie-In',
        storyParts: 'Embedded: Part 1',
        publicationDate: 'May 2006'
      },
      {
        position: 3,
        seriesName: 'Civil War',
        issueNumber: '2',
        importance: 'Essential',
        storyParts: 'Part 2',
        publicationDate: 'Jun 2006'
      }
    ]);

    const issues = dbService.getReadingOrderIssues('civil-war');
    expect(issues).toHaveLength(3);

    // Query continuity for Front Line #1
    const continuity = dbService.findArcForIssue('Civil War: Front Line', '1');
    expect(continuity).toBeDefined();
    expect(continuity.readingOrderId).toBe('civil-war');
    expect(continuity.position).toBe(2);
    expect(continuity.previousIssue.seriesName).toBe('Civil War');
    expect(continuity.previousIssue.issueNumber).toBe('1');
    expect(continuity.nextIssue.seriesName).toBe('Civil War');
    expect(continuity.nextIssue.issueNumber).toBe('2');
  });

  it('upserts and retrieves collected editions', () => {
    dbService.upsertReadingOrder({
      id: 'civil-war',
      title: 'Civil War'
    });

    dbService.upsertCollections('civil-war', [
      {
        position: 1,
        title: 'Civil War',
        subtitle: 'Companion',
        pageCount: 224,
        releaseYear: 2007,
        description: 'Companion volume',
        contentsRaw: 'Civil War Files #1'
      }
    ]);

    const collections = dbService.getReadingOrderCollections('civil-war');
    expect(collections).toHaveLength(1);
    expect(collections[0].title).toBe('Civil War');
    expect(collections[0].pageCount).toBe(224);
  });
});
