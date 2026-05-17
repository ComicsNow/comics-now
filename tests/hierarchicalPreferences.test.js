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
