const fs = require('fs');
const path = require('path');
const { dbRun, dbGet } = require('../server/db');
const { scanLibrary } = require('../server/services/library-scan');
const { setComicsLocation } = require('../server/config');
const { THUMBNAILS_DIRECTORY, GUIDED_VIEW_DIR } = require('../server/constants');
const { createId } = require('../server/utils');

describe('Library Scan - Missing Comic & Guided View Cleanup (TDD)', () => {
  const testLibDir = path.join(__dirname, 'fixtures', 'test-scan-cleanup-lib');
  const comicPath = path.join(testLibDir, 'missing-comic.cbz');
  const comicId = createId(comicPath);
  const thumbFile = `${comicId}.jpg`;
  const thumbPath = path.join(THUMBNAILS_DIRECTORY, thumbFile);
  const gvPath = path.join(GUIDED_VIEW_DIR, `${comicId}.json`);

  beforeAll(async () => {
    // Ensure directories exist
    fs.mkdirSync(testLibDir, { recursive: true });
    fs.mkdirSync(THUMBNAILS_DIRECTORY, { recursive: true });
    fs.mkdirSync(GUIDED_VIEW_DIR, { recursive: true });
  });

  afterAll(() => {
    // Cleanup test directories if needed
    try {
      if (fs.existsSync(testLibDir)) fs.rmSync(testLibDir, { recursive: true, force: true });
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      if (fs.existsSync(gvPath)) fs.unlinkSync(gvPath);
    } catch (_) {}
  });

  beforeEach(async () => {
    // Make sure comic file does NOT exist on disk
    if (fs.existsSync(comicPath)) fs.unlinkSync(comicPath);

    // Create thumbnail file
    fs.writeFileSync(thumbPath, 'dummy-thumbnail-content');
    // Create guided view sidecar file
    fs.writeFileSync(gvPath, JSON.stringify({ pages: { 'page_0.jpg': { panels: [] } } }));

    // Insert comic into database with guidedViewPath and thumbnailPath
    await dbRun(
      `INSERT OR REPLACE INTO comics (id, path, name, thumbnailPath, guidedViewPath, guidedViewStatus)
       VALUES (?, ?, ?, ?, ?, 'completed')`,
      [comicId, comicPath, 'Missing Comic', thumbFile, gvPath]
    );

    // Configure library
    setComicsLocation(testLibDir);
  });

  afterEach(async () => {
    await dbRun('DELETE FROM comics WHERE id = ?', [comicId]);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    if (fs.existsSync(gvPath)) fs.unlinkSync(gvPath);
  });

  test('cleans up guided view sidecar file when a missing comic is deleted during library scan', async () => {
    expect(fs.existsSync(thumbPath)).toBe(true);
    expect(fs.existsSync(gvPath)).toBe(true);

    // Run library scan
    await scanLibrary(true);

    // 1. Comic record must be removed from DB
    const comicInDb = await dbGet('SELECT * FROM comics WHERE id = ?', [comicId]);
    expect(comicInDb).toBeUndefined();

    // 2. Thumbnail file must be unlinked
    expect(fs.existsSync(thumbPath)).toBe(false);

    // 3. Guided view sidecar file must be unlinked
    expect(fs.existsSync(gvPath)).toBe(false);
  });

  test('preserves guided view sidecar when comic file exists on disk', async () => {
    // Copy a real fixture CBZ so the scanner recognizes it as valid
    const sampleCbz = path.join(__dirname, 'fixtures', 'sample.cbz');
    fs.copyFileSync(sampleCbz, comicPath);

    await scanLibrary(true);

    // Comic record, thumbnail, and guided view sidecar must all be preserved
    const comicInDb = await dbGet('SELECT * FROM comics WHERE id = ?', [comicId]);
    expect(comicInDb).toBeDefined();
    expect(fs.existsSync(thumbPath)).toBe(true);
    expect(fs.existsSync(gvPath)).toBe(true);

    // Cleanup
    if (fs.existsSync(comicPath)) fs.unlinkSync(comicPath);
  });
});
