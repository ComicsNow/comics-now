const fs = require('fs');
const path = require('path');
const { updateComicIdentity } = require('../server/services/organization');
const { GUIDED_VIEW_DIR } = require('../server/constants');

describe('Guided View Sidecar Rename & Lifecycle (updateComicIdentity)', () => {
  const oldId = 'old-identity-hash-111';
  const newId = 'new-identity-hash-222';
  const oldGv = path.join(GUIDED_VIEW_DIR, `${oldId}.json`);
  const newGv = path.join(GUIDED_VIEW_DIR, `${newId}.json`);

  beforeAll(() => {
    fs.mkdirSync(GUIDED_VIEW_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(oldGv)) fs.unlinkSync(oldGv);
      if (fs.existsSync(newGv)) fs.unlinkSync(newGv);
    } catch (_) {}
  });

  test('migrates existing valid sidecar and updates internal comicId on rename/move', async () => {
    const originalData = {
      comicId: oldId,
      type: 'western',
      pages: { '001.jpg': { panels: [[0, 0, 100, 100]], bubbles: [] } }
    };
    fs.writeFileSync(oldGv, JSON.stringify(originalData), 'utf8');

    const dbRun = jest.fn().mockResolvedValue({ changes: 1 });

    await updateComicIdentity({
      dbRun,
      oldId,
      newId,
      oldPath: '/comics/Old Name.cbz',
      newPath: '/comics/New Name.cbz',
      newName: 'New Name.cbz',
      guidedViewDir: GUIDED_VIEW_DIR
    });

    // 1. Old sidecar removed, new sidecar created
    expect(fs.existsSync(oldGv)).toBe(false);
    expect(fs.existsSync(newGv)).toBe(true);

    // 2. ComicId updated inside JSON
    const updatedData = JSON.parse(fs.readFileSync(newGv, 'utf8'));
    expect(updatedData.comicId).toBe(newId);
    expect(updatedData.pages).toBeDefined();

    // 3. DB updated with new path and completed status
    expect(dbRun).toHaveBeenCalled();
    const updateCall = dbRun.mock.calls.find(c => c[0].includes('UPDATE comics SET id = ?'));
    expect(updateCall).toBeDefined();
    const params = updateCall[1];
    expect(params[0]).toBe(newId);
    expect(params[4]).toBe(newGv); // guidedViewPath
    expect(params[5]).toBe('completed'); // guidedViewStatus
  });

  test('cleans up corrupt sidecar and marks pending when sidecar is invalid', async () => {
    fs.writeFileSync(oldGv, 'invalid-corrupt-json', 'utf8');

    const dbRun = jest.fn().mockResolvedValue({ changes: 1 });

    await updateComicIdentity({
      dbRun,
      oldId,
      newId,
      oldPath: '/comics/Old Name.cbz',
      newPath: '/comics/New Name.cbz',
      newName: 'New Name.cbz',
      guidedViewDir: GUIDED_VIEW_DIR
    });

    // Both should be cleaned up
    expect(fs.existsSync(oldGv)).toBe(false);
    expect(fs.existsSync(newGv)).toBe(false);

    const updateCall = dbRun.mock.calls.find(c => c[0].includes('UPDATE comics SET id = ?'));
    expect(updateCall).toBeDefined();
    const params = updateCall[1];
    expect(params[4]).toBeNull(); // guidedViewPath reset to null
    expect(params[5]).toBe('pending'); // guidedViewStatus reset to pending
  });

  test('handles missing sidecar by setting status to pending', async () => {
    if (fs.existsSync(oldGv)) fs.unlinkSync(oldGv);
    if (fs.existsSync(newGv)) fs.unlinkSync(newGv);

    const dbRun = jest.fn().mockResolvedValue({ changes: 1 });

    await updateComicIdentity({
      dbRun,
      oldId,
      newId,
      oldPath: '/comics/Old Name.cbz',
      newPath: '/comics/New Name.cbz',
      newName: 'New Name.cbz',
      guidedViewDir: GUIDED_VIEW_DIR
    });

    expect(fs.existsSync(newGv)).toBe(false);

    const updateCall = dbRun.mock.calls.find(c => c[0].includes('UPDATE comics SET id = ?'));
    expect(updateCall).toBeDefined();
    const params = updateCall[1];
    expect(params[4]).toBeNull();
    expect(params[5]).toBe('pending');
  });

  test('preserves guided view untouched when oldId === newId', async () => {
    const dbRun = jest.fn().mockResolvedValue({ changes: 1 });

    await updateComicIdentity({
      dbRun,
      oldId: 'same-id',
      newId: 'same-id',
      oldPath: '/comics/Same.cbz',
      newPath: '/comics/Same.cbz',
      newName: 'Same.cbz',
      guidedViewDir: GUIDED_VIEW_DIR
    });

    const updateCall = dbRun.mock.calls.find(c => c[0].includes('UPDATE comics SET path = ?'));
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).not.toContain('guidedViewPath');
  });
});
