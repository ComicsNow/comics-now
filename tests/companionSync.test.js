/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const config = require('../server/config');
const metadata = require('../server/services/metadata');
const { syncCompanionTag } = require('../server/services/tagger/companion-sync');

const PRIMARY_CBR = {
  id: 'mock-cbr-id',
  path: path.join('fixtures', 'mock-comic.cbr'),
  originalPath: null
};

const COMPANION_CBZ = {
  id: 'mock-cbz-id',
  path: path.join('fixtures', 'mock-comic.cbz')
};

const COMPLETE_INFO = {
  Series: 'Mock Series',
  Number: '1',
  Publisher: 'Mock Publisher',
  Year: '2020'
};

function mockStorage(mode) {
  jest.spyOn(config, 'getMetadataStorage').mockReturnValue(mode);
}

describe('companion metadata sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(db, 'dbGet').mockResolvedValue(PRIMARY_CBR);
    jest.spyOn(db, 'dbAll').mockResolvedValue([COMPANION_CBZ]);
    jest.spyOn(db, 'dbRun').mockResolvedValue({ changes: 1 });
    jest.spyOn(metadata, 'getComicInfoFromArchive').mockResolvedValue({ ...COMPLETE_INFO });
    jest.spyOn(metadata, 'buildComicInfoXml').mockReturnValue('<ComicInfo><Series>Mock Series</Series></ComicInfo>');
    jest.spyOn(metadata, 'writeComicInfoToCbz').mockResolvedValue();
    jest.spyOn(metadata, 'normalizePublisher').mockImplementation((name) => name);
    jest.spyOn(fs.promises, 'writeFile').mockResolvedValue();
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 9876 });
    mockStorage('archive');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('CBR primary mirrors its metadata into the converted CBZ companion', async () => {
    const result = await syncCompanionTag(PRIMARY_CBR.id);

    expect(result).toMatchObject({ synced: true, companionId: COMPANION_CBZ.id });
    expect(metadata.writeComicInfoToCbz).toHaveBeenCalledWith(
      COMPANION_CBZ.path,
      expect.stringContaining('Mock Series')
    );

    expect(db.dbRun).toHaveBeenCalledTimes(1);
    const [sql, params] = db.dbRun.mock.calls[0];
    expect(sql.trim().startsWith('UPDATE comics')).toBe(true);
    expect(sql).not.toMatch(/INSERT|REPLACE|originalPath/i);
    expect(params).toEqual([
      'successful',
      'Mock Publisher',
      'Mock Series',
      expect.any(String),
      9876,
      COMPANION_CBZ.id
    ]);
    const dbMeta = JSON.parse(params[3]);
    expect(dbMeta).toMatchObject({ Series: 'Mock Series', Number: '1', Publisher: 'Mock Publisher' });
  });

  test('sidecar storage writes an adjacent ComicInfo.xml without repacking', async () => {
    mockStorage('sidecar');

    await syncCompanionTag(PRIMARY_CBR.id);

    expect(metadata.writeComicInfoToCbz).not.toHaveBeenCalled();
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      path.join('fixtures', 'mock-comic.ComicInfo.xml'),
      expect.stringContaining('Mock Series'),
      'utf-8'
    );
  });

  test('reverse sync from a converted CBZ back to its CBR original always uses a sidecar', async () => {
    db.dbGet.mockResolvedValue({
      id: 'mock-cbz-id',
      path: COMPANION_CBZ.path,
      originalPath: PRIMARY_CBR.path
    });
    db.dbAll.mockResolvedValue([{ id: 'mock-cbr-id', path: PRIMARY_CBR.path }]);

    const result = await syncCompanionTag('mock-cbz-id');

    expect(result.synced).toBe(true);
    expect(metadata.writeComicInfoToCbz).not.toHaveBeenCalled();
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      path.join('fixtures', 'mock-comic.ComicInfo.xml'),
      expect.any(String),
      'utf-8'
    );
  });

  test('does nothing when the primary has no linked companion', async () => {
    db.dbAll.mockResolvedValue([]);

    const result = await syncCompanionTag(PRIMARY_CBR.id);

    expect(result).toMatchObject({ synced: false, reason: 'no_companion' });
    expect(metadata.writeComicInfoToCbz).not.toHaveBeenCalled();
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
    expect(db.dbRun).not.toHaveBeenCalled();
  });

  test('does nothing when the primary has no readable ComicInfo metadata', async () => {
    metadata.getComicInfoFromArchive.mockResolvedValue({});

    const result = await syncCompanionTag(PRIMARY_CBR.id);

    expect(result).toMatchObject({ synced: false, reason: 'no_metadata' });
    expect(metadata.writeComicInfoToCbz).not.toHaveBeenCalled();
    expect(db.dbRun).not.toHaveBeenCalled();
  });

  test('logs and swallows write failures so the primary tag cannot fail', async () => {
    metadata.writeComicInfoToCbz.mockRejectedValue(new Error('disk full'));

    const result = await syncCompanionTag(PRIMARY_CBR.id);

    expect(result).toMatchObject({ synced: false, reason: 'error' });
    expect(result.error).toContain('disk full');
    expect(db.dbRun).not.toHaveBeenCalled();
  });

  test('syncs only the lowest-id companion when several rows point at one CBR', async () => {
    db.dbAll.mockResolvedValue([
      { id: 'mock-cbz-a', path: path.join('fixtures', 'mock-comic-a.cbz') },
      { id: 'mock-cbz-b', path: path.join('fixtures', 'mock-comic-b.cbz') }
    ]);

    const result = await syncCompanionTag(PRIMARY_CBR.id);

    expect(result.companionId).toBe('mock-cbz-a');
    expect(metadata.writeComicInfoToCbz).toHaveBeenCalledTimes(1);
    expect(metadata.writeComicInfoToCbz).toHaveBeenCalledWith(
      path.join('fixtures', 'mock-comic-a.cbz'),
      expect.any(String)
    );
  });
});
