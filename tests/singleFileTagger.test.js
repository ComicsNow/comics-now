/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const config = require('../server/config');
const engineClient = require('../server/services/tagger/engine-client');
const taggerProcess = require('../server/services/tagger-process');
const libraryPages = require('../server/services/library-pages');
const libraryScan = require('../server/services/library-scan');
const persist = require('../server/services/tagger/persist');
const review = require('../server/services/tagger/review');
const companionSync = require('../server/services/tagger/companion-sync');
const fileRunState = require('../server/services/tagger/file-run-state');
const { runSingleFileTagger } = require('../server/services/tagger/single-file');

const CBR_ROW = {
  id: 'mock-cbr-id',
  path: path.join('fixtures', 'mock-comic.cbr'),
  name: 'mock-comic.cbr',
  thumbnailPath: 'mock-thumb.jpg',
  originalPath: null,
  tagStatus: 'pending',
  publisher: 'Mock Publisher',
  series: 'Mock Series'
};

const CBZ_ROW = {
  ...CBR_ROW,
  id: 'mock-cbz-id',
  path: path.join('fixtures', 'mock-comic.cbz'),
  name: 'mock-comic.cbz',
  thumbnailPath: null
};

function mockConfig() {
  jest.spyOn(config, 'getTaggerServiceUrl').mockReturnValue('http://127.0.0.1:5000');
  jest.spyOn(config, 'getMetadataStorage').mockReturnValue('archive');
  jest.spyOn(config, 'getComicVineApiKey').mockReturnValue('');
  jest.spyOn(config, 'getGoogleBooksApiKey').mockReturnValue('');
  jest.spyOn(config, 'getMetronUser').mockReturnValue('');
  jest.spyOn(config, 'getMetronPassword').mockReturnValue('');
  jest.spyOn(config, 'getGcdUser').mockReturnValue('');
  jest.spyOn(config, 'getGcdPassword').mockReturnValue('');
  jest.spyOn(config, 'getTaggerLowerThreshold').mockReturnValue(0.8);
  jest.spyOn(config, 'getTaggerUpperThreshold').mockReturnValue(0.9);
  jest.spyOn(config, 'getTaggerEnabledSources').mockReturnValue(['src-comicvine']);
}

describe('per-comic tag search service', () => {
  let engineSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    fileRunState.resetFileRunState();
    review.clearReviewState(false);

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1234 });
    jest.spyOn(db, 'dbGet').mockResolvedValue(CBR_ROW);
    jest.spyOn(db, 'dbAll').mockResolvedValue([]);
    jest.spyOn(db, 'dbRun').mockResolvedValue({ changes: 1 });
    jest.spyOn(libraryScan, 'isScanning').mockReturnValue(false);
    jest.spyOn(taggerProcess, 'isWorkerOnline').mockResolvedValue(true);
    jest.spyOn(taggerProcess, 'startTaggerWorker').mockResolvedValue();
    jest.spyOn(libraryPages, 'generateThumbnail').mockResolvedValue('generated-thumb.jpg');
    jest.spyOn(persist, 'recordTaggedComic').mockResolvedValue({ isSuccessful: true, pub: 'Mock Publisher', ser: 'Mock Series' });
    jest.spyOn(persist, 'recordUnmatchedComic').mockResolvedValue('failed');
    jest.spyOn(companionSync, 'syncCompanionTag').mockResolvedValue({ synced: true, companionId: 'mock-companion-id' });
    engineSpy = jest.spyOn(engineClient, 'callTaggerEngineWithProgress').mockResolvedValue({
      status: 'tagged',
      matched_title: 'Mock Series #1',
      confidence: 95,
      metadata: { series: 'Mock Series', publisher: 'Mock Publisher', number: '1', year: '2020' }
    });
    mockConfig();
  });

  afterEach(() => {
    fileRunState.resetFileRunState();
    review.clearReviewState(false);
    jest.restoreAllMocks();
  });

  function engineRequest() {
    expect(engineSpy).toHaveBeenCalledTimes(1);
    return engineSpy.mock.calls[0][1];
  }

  test('CBR requests sidecar storage and the Node-resolved cover path', async () => {
    const result = await runSingleFileTagger({ comicId: CBR_ROW.id });

    expect(result.status).toBe('tagged');
    const req = engineRequest();
    expect(req.path).toBe(CBR_ROW.path);
    expect(req.metadata_storage).toBe('sidecar');
    expect(req.cover_path).toBe(path.join(require('../server/constants').THUMBNAILS_DIRECTORY, 'mock-thumb.jpg'));
    expect(req.force_reprocess).toBe(false);
  });

  test('CBZ keeps the configured storage and does not send a cover path', async () => {
    db.dbGet.mockResolvedValue(CBZ_ROW);

    await runSingleFileTagger({ comicId: CBZ_ROW.id });

    const req = engineRequest();
    expect(req.metadata_storage).toBe('archive');
    expect(req.cover_path).toBeUndefined();
  });

  test('a tagged result records the primary row and syncs the companion', async () => {
    const result = await runSingleFileTagger({ comicId: CBR_ROW.id, force: true });

    expect(engineRequest().force_reprocess).toBe(true);
    expect(persist.recordTaggedComic).toHaveBeenCalledWith(
      CBR_ROW.path,
      CBR_ROW.name,
      expect.objectContaining({ status: 'tagged' }),
      CBR_ROW,
      [],
      expect.any(Object)
    );
    expect(companionSync.syncCompanionTag).toHaveBeenCalledWith(CBR_ROW.id);
    expect(result.companion).toEqual({ synced: true, companionId: 'mock-companion-id' });
  });

  test('does not mirror to the companion when the primary tag is incomplete', async () => {
    persist.recordTaggedComic.mockResolvedValue({
      isSuccessful: false,
      pub: 'Mock Publisher',
      ser: 'Mock Series'
    });

    const result = await runSingleFileTagger({ comicId: CBR_ROW.id });

    expect(result.status).toBe('tagged');
    expect(result.isSuccessful).toBe(false);
    expect(companionSync.syncCompanionTag).not.toHaveBeenCalled();
    expect(result.companion).toBeNull();
  });

  test('a review result exposes matches immediately and releases the run slot', async () => {
    engineSpy.mockResolvedValue({
      status: 'review',
      confidence: 61,
      metadata: { series: 'Mock Series', number: '1' },
      candidates: [{ score: 61, source: 'mock', metadata: { title: 'Mock Series #1' } }]
    });
    const reviewSpy = jest.spyOn(review, 'buildReviewState').mockReturnValue({
      matches: [{ choice: '1', title: 'Mock Series #1' }],
      waitingForResponse: true
    });

    const result = await runSingleFileTagger({ comicId: CBR_ROW.id });

    expect(result.status).toBe('review');
    expect(result.matches).toHaveLength(1);
    expect(reviewSpy).toHaveBeenCalledWith(
      CBR_ROW.name,
      CBR_ROW.path,
      expect.any(Array),
      expect.objectContaining({
        source: 'file',
        comicId: CBR_ROW.id,
        primaryMetadata: expect.objectContaining({ series: 'Mock Series' })
      })
    );
    expect(fileRunState.isFileTaggerRunning()).toBe(false);
    expect(companionSync.syncCompanionTag).not.toHaveBeenCalled();
  });

  test('a failed result records an unmatched row', async () => {
    engineSpy.mockResolvedValue({ status: 'failed', reason: 'Engine failure' });

    const result = await runSingleFileTagger({ comicId: CBR_ROW.id });

    expect(result.status).toBe('failed');
    expect(persist.recordUnmatchedComic).toHaveBeenCalledWith(
      CBR_ROW.path,
      CBR_ROW.name,
      CBR_ROW,
      expect.any(Object),
      true
    );
  });

  test('a skipped result does not write to the database', async () => {
    engineSpy.mockResolvedValue({ status: 'skipped', reason: 'Already complete' });

    const result = await runSingleFileTagger({ comicId: CBR_ROW.id });

    expect(result.status).toBe('skipped');
    expect(persist.recordTaggedComic).not.toHaveBeenCalled();
    expect(persist.recordUnmatchedComic).not.toHaveBeenCalled();
    expect(companionSync.syncCompanionTag).not.toHaveBeenCalled();
  });

  test('rejects a second concurrent file run', async () => {
    fileRunState.beginFileRun({ comicId: 'other-comic', path: 'other.cbz' });

    await expect(runSingleFileTagger({ comicId: CBR_ROW.id })).rejects.toMatchObject({
      code: 'file_tagger_running',
      statusCode: 409
    });
    expect(engineSpy).not.toHaveBeenCalled();
  });

  test('rejects a file run during a library scan', async () => {
    libraryScan.isScanning.mockReturnValue(true);

    await expect(runSingleFileTagger({ comicId: CBR_ROW.id })).rejects.toMatchObject({
      code: 'library_scan_running',
      statusCode: 409
    });
    expect(engineSpy).not.toHaveBeenCalled();
  });

  test('rejects a file run while a match is awaiting review', async () => {
    review.setPendingMatch({ waitingForResponse: true, origin: 'scan' });

    await expect(runSingleFileTagger({ comicId: CBR_ROW.id })).rejects.toMatchObject({
      code: 'review_pending',
      statusCode: 409
    });
    expect(engineSpy).not.toHaveBeenCalled();
  });

  test('rejects unsupported formats and missing comics with typed errors', async () => {
    db.dbGet.mockResolvedValueOnce({ ...CBZ_ROW, path: 'fixtures/mock-comic.pdf' });
    await expect(runSingleFileTagger({ comicId: 'mock-pdf-id' })).rejects.toMatchObject({
      code: 'unsupported_format',
      statusCode: 400
    });

    db.dbGet.mockResolvedValueOnce(null);
    await expect(runSingleFileTagger({ comicId: 'missing' })).rejects.toMatchObject({
      code: 'comic_not_found',
      statusCode: 404
    });
  });

  test('releases the run slot after an engine failure', async () => {
    db.dbGet.mockResolvedValue(CBR_ROW);
    engineSpy.mockRejectedValueOnce(new Error('worker exploded'));

    await expect(runSingleFileTagger({ comicId: CBR_ROW.id })).rejects.toMatchObject({
      code: 'tagger_engine_error',
      statusCode: 502
    });
    expect(fileRunState.isFileTaggerRunning()).toBe(false);

    engineSpy.mockResolvedValue({ status: 'skipped', reason: 'no match' });
    await expect(runSingleFileTagger({ comicId: CBR_ROW.id })).resolves.toMatchObject({ status: 'skipped' });
  });
});
