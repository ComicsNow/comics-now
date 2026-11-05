const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  buildOriginalLinkMap,
  resolveLiveLinkedCbz,
  resolveOriginalLink,
  findAdjacentOriginal,
  backfillOriginalLinks
} = require('../server/services/scan/original-links');

describe('original-link helpers', () => {
  describe('buildOriginalLinkMap', () => {
    test('maps resolved original paths to converted CBZ paths', () => {
      const map = buildOriginalLinkMap([
        { path: '/library/Renamed Issue.cbz', originalPath: '/inbox/Issue One.pdf' }
      ]);

      expect(map.get('/inbox/Issue One.pdf')).toBe('/library/Renamed Issue.cbz');
    });

    test('normalizes the original path key', () => {
      const unnormalized = path.join('/inbox', '.', 'Issue One.pdf');
      const map = buildOriginalLinkMap([
        { path: '/library/Renamed Issue.cbz', originalPath: unnormalized }
      ]);

      expect(map.get(path.resolve('/inbox/Issue One.pdf'))).toBe('/library/Renamed Issue.cbz');
    });

    test('ignores empty or incomplete rows', () => {
      const map = buildOriginalLinkMap([
        { path: '/library/A.cbz', originalPath: null },
        { path: '/library/B.cbz', originalPath: '' },
        { path: '', originalPath: '/inbox/C.pdf' },
        null
      ]);

      expect(map.size).toBe(0);
    });

    test('returns an empty map for missing input', () => {
      expect(buildOriginalLinkMap(null).size).toBe(0);
      expect(buildOriginalLinkMap(undefined).size).toBe(0);
    });

    test('keeps the first link when duplicates exist', () => {
      const map = buildOriginalLinkMap([
        { path: '/library/First.cbz', originalPath: '/inbox/Issue.pdf' },
        { path: '/library/Second.cbz', originalPath: '/inbox/Issue.pdf' }
      ]);

      expect(map.get('/inbox/Issue.pdf')).toBe('/library/First.cbz');
    });
  });

  describe('resolveLiveLinkedCbz', () => {
    const links = new Map([['/inbox/Issue One.pdf', '/library/Renamed.cbz']]);

    test('returns the CBZ path when the linked file exists', () => {
      expect(resolveLiveLinkedCbz(links, '/inbox/Issue One.pdf', () => true))
        .toBe('/library/Renamed.cbz');
    });

    test('returns null when the linked CBZ was deleted', () => {
      expect(resolveLiveLinkedCbz(links, '/inbox/Issue One.pdf', () => false)).toBeNull();
    });

    test('returns null for unknown or missing originals', () => {
      expect(resolveLiveLinkedCbz(links, '/inbox/Other.pdf', () => true)).toBeNull();
      expect(resolveLiveLinkedCbz(links, null, () => true)).toBeNull();
      expect(resolveLiveLinkedCbz(null, '/inbox/Issue One.pdf', () => true)).toBeNull();
    });

    test('returns null when the existence check throws', () => {
      const exists = () => { throw new Error('EACCES'); };
      expect(resolveLiveLinkedCbz(links, '/inbox/Issue One.pdf', exists)).toBeNull();
    });

    test('normalizes a non-resolved original path', () => {
      const unnormalized = path.join('/inbox', '.', 'Issue One.pdf');
      expect(resolveLiveLinkedCbz(links, unnormalized, () => true)).toBe('/library/Renamed.cbz');
    });
  });

  describe('resolveOriginalLink', () => {
    test('records the source path for a conversion when the original still exists', () => {
      const result = resolveOriginalLink({
        wasConverted: true,
        sourcePath: '/inbox/Issue One.pdf',
        existingOriginalPath: null,
        exists: () => true
      });

      expect(result).toBe('/inbox/Issue One.pdf');
    });

    test('returns null when delete-after-conversion removed the original', () => {
      const result = resolveOriginalLink({
        wasConverted: true,
        sourcePath: '/inbox/Issue One.pdf',
        existingOriginalPath: null,
        exists: () => false
      });

      expect(result).toBeNull();
    });

    test('preserves an existing link on a normal rescan when the original exists', () => {
      const result = resolveOriginalLink({
        wasConverted: false,
        sourcePath: null,
        existingOriginalPath: '/inbox/Issue One.pdf',
        exists: () => true
      });

      expect(result).toBe('/inbox/Issue One.pdf');
    });

    test('clears a stale existing link when the original is gone', () => {
      const result = resolveOriginalLink({
        wasConverted: false,
        sourcePath: null,
        existingOriginalPath: '/inbox/Issue One.pdf',
        exists: () => false
      });

      expect(result).toBeNull();
    });

    test('returns null when there is no source or existing link', () => {
      expect(resolveOriginalLink({ wasConverted: false, existingOriginalPath: null })).toBeNull();
    });
  });

  describe('findAdjacentOriginal', () => {
    test('finds a same-stem CBR next to the CBZ', () => {
      const exists = p => p === '/inbox/Issue One.cbr';
      expect(findAdjacentOriginal('/inbox/Issue One.cbz', exists)).toBe('/inbox/Issue One.cbr');
    });

    test('finds a same-stem PDF next to the CBZ', () => {
      const exists = p => p === '/inbox/Issue One.pdf';
      expect(findAdjacentOriginal('/inbox/Issue One.cbz', exists)).toBe('/inbox/Issue One.pdf');
    });

    test('prefers CBR when both exist', () => {
      const exists = () => true;
      expect(findAdjacentOriginal('/inbox/Issue One.cbz', exists)).toBe('/inbox/Issue One.cbr');
    });

    test('returns null when neither original exists', () => {
      expect(findAdjacentOriginal('/inbox/Issue One.cbz', () => false)).toBeNull();
    });

    test('returns null when the existence check throws', () => {
      const exists = () => { throw new Error('EACCES'); };
      expect(findAdjacentOriginal('/inbox/Issue One.cbz', exists)).toBeNull();
    });
  });

  describe('backfillOriginalLinks', () => {
    test('links converted rows that still have a same-stem original beside them', async () => {
      const all = jest.fn().mockResolvedValue([
        { id: 'id-1', path: '/inbox/Issue One.cbz' },
        { id: 'id-2', path: '/inbox/Issue Two.cbz' }
      ]);
      const run = jest.fn().mockResolvedValue({ changes: 1 });
      const exists = p => p === '/inbox/Issue One.pdf';

      const linked = await backfillOriginalLinks({ all, run, existsSync: exists });

      expect(linked).toBe(1);
      expect(run).toHaveBeenCalledWith(
        'UPDATE comics SET originalPath = ? WHERE id = ?',
        ['/inbox/Issue One.pdf', 'id-1']
      );
    });

    test('is a no-op when there are no candidate rows', async () => {
      const all = jest.fn().mockResolvedValue([]);
      const run = jest.fn();

      const linked = await backfillOriginalLinks({ all, run, existsSync: () => true });

      expect(linked).toBe(0);
      expect(run).not.toHaveBeenCalled();
    });

    test('queries only converted comics without a link', async () => {
      const all = jest.fn().mockResolvedValue([]);
      await backfillOriginalLinks({ all, run: jest.fn(), existsSync: () => false });

      const sql = all.mock.calls[0][0];
      expect(sql).toContain('convertedAt IS NOT NULL');
      expect(sql).toContain('originalPath IS NULL');
    });

    test('updates real rows while leaving non-converted comics alone', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-backfill-'));
      const db = new Database(':memory:');
      try {
        db.exec(`CREATE TABLE comics (
          id TEXT PRIMARY KEY,
          path TEXT,
          convertedAt INTEGER,
          originalPath TEXT
        )`);

        const convertedCbz = path.join(tmpDir, 'Converted.cbz');
        fs.writeFileSync(convertedCbz, 'cbz');
        fs.writeFileSync(path.join(tmpDir, 'Converted.pdf'), 'pdf');

        const nativeCbz = path.join(tmpDir, 'Native.cbz');
        fs.writeFileSync(nativeCbz, 'cbz');
        fs.writeFileSync(path.join(tmpDir, 'Native.pdf'), 'pdf');

        db.prepare('INSERT INTO comics (id, path, convertedAt) VALUES (?, ?, ?)')
          .run('converted', convertedCbz, 123);
        db.prepare('INSERT INTO comics (id, path) VALUES (?, ?)')
          .run('native', nativeCbz);

        const all = sql => db.prepare(sql).all();
        const run = (sql, params = []) => db.prepare(sql).run(...params);

        const linked = await backfillOriginalLinks({ all, run });

        expect(linked).toBe(1);
        expect(db.prepare('SELECT originalPath FROM comics WHERE id = ?').get('converted').originalPath)
          .toBe(path.join(tmpDir, 'Converted.pdf'));
        expect(db.prepare('SELECT originalPath FROM comics WHERE id = ?').get('native').originalPath)
          .toBeNull();
      } finally {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
