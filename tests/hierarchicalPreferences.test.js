const { resolveReadingModes } = require('../server/db');

describe('Hierarchical Preference Resolution', () => {

  const comicsRoots = ['/library1', '/library2'];
  
  const prefMaps = {
    comic: new Map(),
    series: new Map(),
    publisher: new Map(),
    library: new Map()
  };

  beforeEach(() => {
    prefMaps.comic.clear();
    prefMaps.series.clear();
    prefMaps.publisher.clear();
    prefMaps.library.clear();
  });

  describe('resolveReadingModes', () => {
    it('should return false/false by default', () => {
      const res = resolveReadingModes('id1', 'Series', 'Pub', '/library1/file.cbz', prefMaps, comicsRoots);
      expect(res.mangaMode).toBe(false);
      expect(res.continuousMode).toBe(false);
    });

    it('should resolve mangaMode by comicId (highest priority)', () => {
      prefMaps.comic.set('id1', { mangaMode: true });
      prefMaps.series.set('Series', { mangaMode: false });
      const res = resolveReadingModes('id1', 'Series', 'Pub', '/library1/file.cbz', prefMaps, comicsRoots);
      expect(res.mangaMode).toBe(true);
    });

    it('should resolve continuousMode by comicId', () => {
      prefMaps.comic.set('id1', { continuousMode: true });
      prefMaps.library.set('/library1', { continuousMode: false });
      const res = resolveReadingModes('id1', 'Series', 'Pub', '/library1/file.cbz', prefMaps, comicsRoots);
      expect(res.continuousMode).toBe(true);
    });

    it('should resolve by series', () => {
      prefMaps.series.set('Series', { mangaMode: true });
      prefMaps.publisher.set('Pub', { mangaMode: false });
      const res = resolveReadingModes('id1', 'Series', 'Pub', '/library1/file.cbz', prefMaps, comicsRoots);
      expect(res.mangaMode).toBe(true);
    });

    it('should resolve by publisher', () => {
      prefMaps.publisher.set('Pub', { continuousMode: true });
      prefMaps.library.set('/library1', { continuousMode: false });
      const res = resolveReadingModes('id1', 'Series', 'Pub', '/library1/file.cbz', prefMaps, comicsRoots);
      expect(res.continuousMode).toBe(true);
    });

    it('should resolve by library', () => {
      prefMaps.library.set('/library1', { mangaMode: true, continuousMode: true });
      const res = resolveReadingModes('id1', 'Series', 'Pub', '/library1/file.cbz', prefMaps, comicsRoots);
      expect(res.mangaMode).toBe(true);
      expect(res.continuousMode).toBe(true);
    });

    it('should prefer more specific (series) over less specific (library)', () => {
      prefMaps.library.set('/library1', { mangaMode: true });
      prefMaps.series.set('Series', { mangaMode: false });
      const res = resolveReadingModes('id1', 'Series', 'Pub', '/library1/file.cbz', prefMaps, comicsRoots);
      expect(res.mangaMode).toBe(false);
    });
  });

  describe('getReadingPrefMaps and getAllReadingPreferences fallback to default-user', () => {
    const { getReadingPrefMaps, getAllReadingPreferences, setReadingPreference, dbRun } = require('../server/db');
    const testUserId = 'test-fallback-user-' + Date.now();
    const testComic1 = 'test-comic-fallback-1-' + Date.now();
    const testComic2 = 'test-comic-fallback-2-' + Date.now();

    beforeAll(async () => {
      // Create user in users table to satisfy foreign key constraint
      await dbRun(`INSERT INTO users (userId, email, role) VALUES (?, ?, 'user')`, [testUserId, `${testUserId}@example.com`]);

      // Set default-user preferences
      await setReadingPreference('default-user', 'comic', testComic1, true, false);
      await setReadingPreference('default-user', 'comic', testComic2, true, false);
      // User overrides comic 2 with mangaMode = false, continuousMode = true
      await setReadingPreference(testUserId, 'comic', testComic2, false, true);
    });

    afterAll(async () => {
      await dbRun(`DELETE FROM users WHERE userId = ?`, [testUserId]);
      await dbRun(`DELETE FROM user_reading_preferences WHERE targetId IN (?, ?)`, [testComic1, testComic2]);
    });

    it('should fall back to default-user when user has no explicit preference', async () => {
      const maps = await getReadingPrefMaps(testUserId);
      expect(maps.comic.get(testComic1)).toEqual({
        mangaMode: true,
        continuousMode: false
      });
    });

    it('should allow user explicit preferences to override default-user', async () => {
      const maps = await getReadingPrefMaps(testUserId);
      expect(maps.comic.get(testComic2)).toEqual({
        mangaMode: false,
        continuousMode: true
      });
    });

    it('should merge preferences in getAllReadingPreferences', async () => {
      const prefs = await getAllReadingPreferences(testUserId);
      const pref1 = prefs.find(p => p.targetId === testComic1);
      const pref2 = prefs.find(p => p.targetId === testComic2);
      expect(pref1).toBeDefined();
      expect(pref1.mangaMode).toBe(1);
      expect(pref1.continuousMode).toBe(0);
      expect(pref2).toBeDefined();
      expect(pref2.mangaMode).toBe(0);
      expect(pref2.continuousMode).toBe(1);
    });
  });

  afterAll(async () => {
    try {
      const db = require('../server/db');
      if (db && typeof db.closeDb === 'function') {
        await db.closeDb();
      }
    } catch (e) {
      // ignore
    }
  });
});
