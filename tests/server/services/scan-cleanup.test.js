const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../server/logger', () => ({ log: jest.fn() }));
jest.mock('../../../server/services/library-pages', () => ({ generateThumbnail: jest.fn() }));

const { dbRun, dbGet } = require('../../../server/db');
const { log } = require('../../../server/logger');
const { cleanupStaleComics } = require('../../../server/services/scan/cleanup');
const { THUMBNAILS_DIRECTORY, GUIDED_VIEW_DIR } = require('../../../server/constants');
const { createId } = require('../../../server/utils');

describe('cleanupStaleComics', () => {
    let testDir;
    let comicPath;
    let comicId;
    let thumbFile;
    let thumbPath;
    let gvPath;

    beforeAll(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-now-cleanup-'));
        fs.mkdirSync(THUMBNAILS_DIRECTORY, { recursive: true });
        fs.mkdirSync(GUIDED_VIEW_DIR, { recursive: true });
    });

    beforeEach(async () => {
        comicPath = path.join(testDir, 'mock-missing-001.cbz');
        comicId = createId(comicPath);
        thumbFile = `${comicId}.jpg`;
        thumbPath = path.join(THUMBNAILS_DIRECTORY, thumbFile);
        gvPath = path.join(GUIDED_VIEW_DIR, `${comicId}.json`);

        if (fs.existsSync(comicPath)) fs.unlinkSync(comicPath);
        fs.writeFileSync(thumbPath, 'synthetic thumbnail');
        fs.writeFileSync(gvPath, JSON.stringify({ pages: {} }));

        await dbRun(
            `INSERT OR REPLACE INTO comics (id, path, name, thumbnailPath, guidedViewPath, guidedViewStatus)
             VALUES (?, ?, ?, ?, ?, 'completed')`,
            [comicId, comicPath, 'Mock Missing 001.cbz', thumbFile, gvPath]
        );

        log.mockClear();
    });

    afterEach(async () => {
        await dbRun('DELETE FROM comics WHERE id = ?', [comicId]);
        for (const file of [comicPath, thumbPath, gvPath]) {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
    });

    afterAll(() => {
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    function makeInput(overrides = {}) {
        return {
            dbComicsMap: new Map([
                [comicPath, { id: comicId, thumbnailPath: thumbFile, guidedViewPath: gvPath }]
            ]),
            fileSystemComics: new Set(),
            unreachableTopDirs: [],
            subDirScanErrors: 0,
            ...overrides
        };
    }

    it('deletes the DB row and sidecars when the file is gone from disk', async () => {
        await cleanupStaleComics(makeInput());

        expect(await dbGet('SELECT id FROM comics WHERE id = ?', [comicId])).toBeUndefined();
        expect(fs.existsSync(thumbPath)).toBe(false);
        expect(fs.existsSync(gvPath)).toBe(false);
    });

    it('preserves the row when the file still exists but was skipped by the scan', async () => {
        fs.writeFileSync(comicPath, 'synthetic comic');

        await cleanupStaleComics(makeInput());

        expect(await dbGet('SELECT id FROM comics WHERE id = ?', [comicId])).toBeDefined();
        expect(fs.existsSync(thumbPath)).toBe(true);
        expect(fs.existsSync(gvPath)).toBe(true);
        expect(log).toHaveBeenCalledWith(
            'WARN',
            'SCAN',
            expect.stringContaining('Safeguard')
        );
    });

    it('aborts cleanup when a scan error makes the file list unreliable', async () => {
        await cleanupStaleComics(makeInput({ unreachableTopDirs: ['/synthetic/offline'] }));

        expect(await dbGet('SELECT id FROM comics WHERE id = ?', [comicId])).toBeDefined();
        expect(fs.existsSync(thumbPath)).toBe(true);
        expect(log).toHaveBeenCalledWith(
            'ERROR',
            'SCAN',
            expect.stringContaining('Aborting stale-comic cleanup')
        );
    });
});
