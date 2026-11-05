const fs = require('fs');
const os = require('os');
const path = require('path');
const { updateComicIdentity, planOriginalMove } = require('../server/services/organization');

function originalLinkUpdates(dbRun) {
  return dbRun.mock.calls.filter(c => /UPDATE comics SET originalPath/.test(c[0]));
}

describe('planOriginalMove', () => {
  test('returns none when the comic has no linked original', () => {
    expect(planOriginalMove(null, '/library/Publisher')).toEqual({ action: 'none' });
  });

  test('returns clear when the original no longer exists', () => {
    const plan = planOriginalMove('/inbox/Issue.pdf', '/library/Publisher', { existsSync: () => false });
    expect(plan).toEqual({
      action: 'clear',
      oldOriginalPath: '/inbox/Issue.pdf',
      newOriginalPath: null
    });
  });

  test('returns keep when the destination is the source directory', () => {
    const plan = planOriginalMove('/inbox/Issue.pdf', '/inbox', { existsSync: () => true });
    expect(plan.action).toBe('keep');
    expect(plan.newOriginalPath).toBe('/inbox/Issue.pdf');
  });

  test('returns collision when the destination already has that filename', () => {
    const exists = p => p === '/inbox/Issue.pdf' || p === '/library/Issue.pdf';
    const plan = planOriginalMove('/inbox/Issue.pdf', '/library', { existsSync: exists });
    expect(plan.action).toBe('collision');
    expect(plan.newOriginalPath).toBe('/library/Issue.pdf');
  });

  test('returns move with the basename preserved', () => {
    const exists = p => p === '/inbox/Issue.pdf';
    const plan = planOriginalMove('/inbox/Issue.pdf', '/library/Publisher', { existsSync: exists });
    expect(plan).toEqual({
      action: 'move',
      oldOriginalPath: '/inbox/Issue.pdf',
      newOriginalPath: '/library/Publisher/Issue.pdf'
    });
  });
});

describe('updateComicIdentity companion original handling', () => {
  let tmpDir;
  let comicsDir;
  let destinationDir;
  let oldComicPath;
  let oldOriginalPath;
  let newComicPath;
  let newOriginalPath;
  let thumbnailsDir;
  let guidedViewDir;
  let dbRun;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-original-relocator-'));
    comicsDir = path.join(tmpDir, 'comics');
    destinationDir = path.join(tmpDir, 'library', 'Publisher', 'Series');
    thumbnailsDir = path.join(tmpDir, 'thumbnails');
    guidedViewDir = path.join(tmpDir, 'metadata', 'guided_view');
    fs.mkdirSync(comicsDir, { recursive: true });
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.mkdirSync(thumbnailsDir, { recursive: true });
    fs.mkdirSync(guidedViewDir, { recursive: true });

    oldComicPath = path.join(comicsDir, 'Old Issue.cbz');
    oldOriginalPath = path.join(comicsDir, 'Old Issue.pdf');
    newComicPath = path.join(destinationDir, '01 Renamed Issue.cbz');
    newOriginalPath = path.join(destinationDir, 'Old Issue.pdf');
    fs.writeFileSync(oldComicPath, 'cbz');
    fs.writeFileSync(oldOriginalPath, 'pdf');

    dbRun = jest.fn().mockResolvedValue({ changes: 1 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function callRelocator(extra = {}) {
    return updateComicIdentity({
      dbRun,
      oldId: 'old-id',
      newId: 'new-id',
      oldPath: oldComicPath,
      newPath: newComicPath,
      newName: path.basename(newComicPath),
      thumbnailsDir,
      guidedViewDir,
      ...extra
    });
  }

  test('rename leaves the original untouched and does not touch originalPath', async () => {
    const renameComic = path.join(comicsDir, '02 Renamed In Place.cbz');
    await updateComicIdentity({
      dbRun,
      oldId: 'old-id',
      newId: 'new-id',
      oldPath: oldComicPath,
      newPath: renameComic,
      newName: path.basename(renameComic),
      thumbnailsDir,
      guidedViewDir
    });

    expect(fs.existsSync(renameComic)).toBe(true);
    expect(fs.existsSync(oldOriginalPath)).toBe(true);
    expect(originalLinkUpdates(dbRun)).toHaveLength(0);
  });

  test('move relocates the original with basename preserved and updates the link', async () => {
    const result = await callRelocator({ oldOriginalPath, newOriginalPath });

    expect(fs.existsSync(oldComicPath)).toBe(false);
    expect(fs.existsSync(newComicPath)).toBe(true);
    expect(fs.existsSync(oldOriginalPath)).toBe(false);
    expect(fs.existsSync(newOriginalPath)).toBe(true);

    const updates = originalLinkUpdates(dbRun);
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual([newOriginalPath, 'new-id']);

    const identityIndex = dbRun.mock.calls.findIndex(c => /UPDATE comics SET id = \?/.test(c[0]));
    const linkIndex = dbRun.mock.calls.indexOf(updates[0]);
    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(linkIndex).toBeGreaterThan(identityIndex);
    expect(result.originalMoved).toBe(true);
  });

  test('moves the original ComicInfo sidecar when present', async () => {
    const oldSidecar = path.join(comicsDir, 'Old Issue.ComicInfo.xml');
    fs.writeFileSync(oldSidecar, '<ComicInfo />');

    await callRelocator({ oldOriginalPath, newOriginalPath });

    expect(fs.existsSync(oldSidecar)).toBe(false);
    expect(fs.existsSync(path.join(destinationDir, 'Old Issue.ComicInfo.xml'))).toBe(true);
  });

  test('null clears the link without touching any file', async () => {
    const result = await callRelocator({ oldOriginalPath, newOriginalPath: null });

    expect(fs.existsSync(oldOriginalPath)).toBe(true);
    const updates = originalLinkUpdates(dbRun);
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual([null, 'new-id']);
    expect(result.originalMoved).toBe(false);
  });

  test('missing original clears the link and reports it', async () => {
    fs.unlinkSync(oldOriginalPath);

    const result = await callRelocator({ oldOriginalPath, newOriginalPath });

    expect(fs.existsSync(newOriginalPath)).toBe(false);
    const updates = originalLinkUpdates(dbRun);
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual([null, 'new-id']);
    expect(result.originalMissing).toBe(true);
  });

  test('destination collision rejects before moving anything', async () => {
    fs.writeFileSync(newOriginalPath, 'existing');

    await expect(callRelocator({ oldOriginalPath, newOriginalPath }))
      .rejects.toThrow(/already exists/);

    expect(fs.existsSync(oldComicPath)).toBe(true);
    expect(fs.existsSync(oldOriginalPath)).toBe(true);
    expect(fs.existsSync(newComicPath)).toBe(false);
    expect(fs.readFileSync(newOriginalPath, 'utf8')).toBe('existing');
  });

  test('restores the original when the comic move fails after it moved', async () => {
    fs.mkdirSync(newComicPath);

    await expect(callRelocator({ oldOriginalPath, newOriginalPath })).rejects.toThrow();

    expect(fs.existsSync(oldOriginalPath)).toBe(true);
    expect(fs.existsSync(newOriginalPath)).toBe(false);
    expect(fs.existsSync(oldComicPath)).toBe(true);
  });
});
