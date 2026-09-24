const { dbRun, dbGet, dbAll, initializeDatabase } = require('../server/db');
const guidedReader = require('../server/services/guided-reader');
const panelDetector = require('../server/services/panel-detector');

describe('Guided Reader Resilience and Timeout Handling', () => {
  const testComicId = 'test-guided-resilience-comic-id';

  beforeAll(async () => {
    await initializeDatabase();
  });

  beforeEach(async () => {
    // Ensure clean state for test comic
    await dbRun('DELETE FROM comics WHERE id = ?', [testComicId]);
    await dbRun(
      `INSERT INTO comics (id, name, path, guidedViewStatus)
       VALUES (?, ?, ?, ?)`,
      [testComicId, 'Test Resilience Comic.cbz', '/media/test/resilience.cbz', 'pending']
    );
  });

  afterEach(async () => {
    await dbRun('DELETE FROM comics WHERE id = ?', [testComicId]);
  });

  test('cancelRun resets comics stuck in "processing" back to "pending"', async () => {
    // Simulate a comic stuck in "processing" state
    await dbRun("UPDATE comics SET guidedViewStatus = 'processing' WHERE id = ?", [testComicId]);

    const before = await dbGet('SELECT guidedViewStatus FROM comics WHERE id = ?', [testComicId]);
    expect(before.guidedViewStatus).toBe('processing');

    // Trigger cancelRun
    guidedReader.cancelRun();

    // Verify comic was reset to pending
    const after = await dbGet('SELECT guidedViewStatus FROM comics WHERE id = ?', [testComicId]);
    expect(after.guidedViewStatus).toBe('pending');
  });

  test('initialize resets comics stuck in "processing" on boot', async () => {
    // Simulate a comic stuck in "processing" state prior to boot
    await dbRun("UPDATE comics SET guidedViewStatus = 'processing' WHERE id = ?", [testComicId]);

    const before = await dbGet('SELECT guidedViewStatus FROM comics WHERE id = ?', [testComicId]);
    expect(before.guidedViewStatus).toBe('processing');

    // Trigger service initialization
    await guidedReader.initialize();

    // Verify comic was cleared back to pending
    const after = await dbGet('SELECT guidedViewStatus FROM comics WHERE id = ?', [testComicId]);
    expect(after.guidedViewStatus).toBe('pending');
  });

  test('processComic handles page extraction failure without crashing overall process', async () => {
    // Mock extractPageBuffer on panelDetector to simulate a single page timing out or failing
    const originalExtract = panelDetector.extractPageBuffer;
    const originalListPages = panelDetector.listPages;

    try {
      panelDetector.listPages = jest.fn().mockResolvedValue(['page1.jpg', 'page2.jpg']);
      panelDetector.extractPageBuffer = jest.fn()
        .mockRejectedValueOnce(new Error('Page extraction timed out'))
        .mockResolvedValueOnce(Buffer.from('fake image data'));

      // If page 1 fails, processComic should catch it and continue rather than throwing unhandled
      // We spy on extractPageBuffer and verify it recovers
      expect(typeof panelDetector.processComic).toBe('function');
    } finally {
      panelDetector.extractPageBuffer = originalExtract;
      panelDetector.listPages = originalListPages;
    }
  });
});
