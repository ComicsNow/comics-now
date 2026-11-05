/**
 * @jest-environment node
 */

jest.mock('../server/services/library-scan', () => ({
  scanLibrary: jest.fn(),
  scheduleNextScan: jest.fn(),
  isScanning: jest.fn(() => false),
  setTaggerRunningCheck: jest.fn()
}));

jest.mock('../server/services/library-pages', () => ({
  getComicPages: jest.fn().mockResolvedValue([]),
  extractPageBuffer: jest.fn().mockResolvedValue(null),
  generateThumbnail: jest.fn().mockResolvedValue(null)
}));

const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const config = require('../server/config');
const { getCtLogs } = require('../server/logger');
const libraryScan = require('../server/services/library-scan');
const metadata = require('../server/services/metadata');
const engineClient = require('../server/services/tagger/engine-client');
const taggerProcess = require('../server/services/tagger-process');
const review = require('../server/services/tagger/review');
const companionSync = require('../server/services/tagger/companion-sync');
const fileRunState = require('../server/services/tagger/file-run-state');
const { buildTaggerRequest } = require('../server/services/tagger/single-file');
const { runComicTagger } = require('../server/services/tagger/runner');
const taggerFacade = require('../server/services/tagger');
const attachExecutionRoutes = require('../server/routes/admin/comictagger/execution');

const CBR_PATH = path.join('fixtures', 'mock-comic.cbr');
const COMPLETE_INFO = { Series: 'Mock Series', Publisher: 'Mock Publisher', Number: '1', Year: '2020' };

function mockTagsConfig() {
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
  jest.spyOn(config, 'getConfig').mockReturnValue({
    comicsLocation: 'fixtures',
    allowed_formats: 'both',
    ctScheduleMinutes: 0
  });
}

describe('CBR parity in Tag Comics Now', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    fileRunState.resetFileRunState();
    review.clearReviewState(false);

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([{ name: 'mock-comic.cbr', isFile: () => true }]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 15000 });
    jest.spyOn(db, 'dbGet').mockResolvedValue({
      id: 'mock-cbr-id',
      updatedAt: 0,
      tagStatus: 'pending',
      metadata: null,
      series: 'Mock Series',
      publisher: 'Mock Publisher',
      thumbnailPath: 'mock-thumb.jpg',
      originalPath: null
    });
    jest.spyOn(db, 'dbAll').mockResolvedValue([]);
    jest.spyOn(db, 'dbRun').mockResolvedValue({ changes: 1 });
    jest.spyOn(metadata, 'getComicInfoFromArchive').mockImplementation(async () => {
      const calls = metadata.getComicInfoFromArchive.mock.calls.length;
      return calls === 1 ? {} : { ...COMPLETE_INFO };
    });
    jest.spyOn(metadata, 'normalizePublisher').mockImplementation((name) => name);
    jest.spyOn(companionSync, 'syncCompanionTag').mockResolvedValue({ synced: true });
    jest.spyOn(taggerProcess, 'isWorkerOnline').mockResolvedValue(true);
    jest.spyOn(taggerProcess, 'startTaggerWorker').mockResolvedValue();
    jest.spyOn(engineClient, 'callTaggerEngineWithProgress').mockResolvedValue({
      status: 'tagged',
      matched_title: 'Mock Series #1',
      confidence: 95,
      metadata: { series: 'Mock Series', publisher: 'Mock Publisher', number: '1', year: '2020' }
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: '1.0' })
    });
    mockTagsConfig();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    review.clearReviewState(false);
    fileRunState.resetFileRunState();
    jest.restoreAllMocks();
  });

  test('buildTaggerRequest forces sidecar storage and cover_path for CBR', () => {
    const cbrReq = buildTaggerRequest({
      filePath: CBR_PATH,
      isCbr: true,
      forceReprocess: false,
      publisherCodex: [],
      coverPath: 'fixtures/mock-thumb.jpg'
    });
    expect(cbrReq.metadata_storage).toBe('sidecar');
    expect(cbrReq.cover_path).toBe('fixtures/mock-thumb.jpg');

    const cbzReq = buildTaggerRequest({
      filePath: path.join('fixtures', 'mock-comic.cbz'),
      isCbr: false,
      forceReprocess: false,
      publisherCodex: [],
      coverPath: 'fixtures/mock-thumb.jpg'
    });
    expect(cbzReq.metadata_storage).toBe('archive');
    expect(cbzReq.cover_path).toBeUndefined();
  });

  test('a scanned CBR injects its thumbnail cover and syncs its companion after tagging', async () => {
    await runComicTagger();

    expect(engineClient.callTaggerEngineWithProgress).toHaveBeenCalledTimes(1);
    const req = engineClient.callTaggerEngineWithProgress.mock.calls[0][1];
    expect(req.metadata_storage).toBe('sidecar');
    expect(req.cover_path).toContain('mock-thumb.jpg');
    expect(companionSync.syncCompanionTag).toHaveBeenCalledWith('mock-cbr-id');
    expect(libraryScan.scanLibrary).toHaveBeenCalled();
  });

  test('a library scan does not start while a per-comic run is active', async () => {
    fileRunState.beginFileRun({ comicId: 'mock-cbr-id', path: CBR_PATH });

    await runComicTagger();

    expect(fs.promises.readdir).not.toHaveBeenCalled();
    expect(engineClient.callTaggerEngineWithProgress).not.toHaveBeenCalled();
    expect(getCtLogs().map(l => l.message).some(m => m.includes('Tagger already running'))).toBe(true);
  });

  test('POST /run returns 409 while a per-comic run is active', async () => {
    let runHandler;
    const router = {
      get: jest.fn(),
      post: jest.fn((routePath, ...args) => {
        if (routePath === '/api/v1/tag-comics-now/run') runHandler = args[args.length - 1];
      })
    };
    const runComicTaggerMock = jest.fn();
    attachExecutionRoutes(router, {
      log: jest.fn(),
      runComicTagger: runComicTaggerMock,
      resolveScanMode: () => 'default',
      isTaggerRunning: () => false,
      isFileTaggerRunning: () => true,
      formatErrorMessage: (err) => err.message
    });

    const res = { json: jest.fn(), status: jest.fn(() => res) };
    await runHandler({ body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'file_tagger_running' }));
    expect(runComicTaggerMock).not.toHaveBeenCalled();
  });

  describe('review apply scanning', () => {
    beforeEach(() => {
      global.fetch = jest.fn().mockImplementation(async (url) => {
        if (typeof url === 'string' && url.includes('/api/apply-tag')) {
          return { ok: true, json: async () => ({ success: true }) };
        }
        return { ok: true, json: async () => ({}) };
      });
      jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 20000 });
      jest.spyOn(db, 'dbRun').mockResolvedValue({ changes: 1 });
      metadata.getComicInfoFromArchive.mockResolvedValue({ ...COMPLETE_INFO });
    });

    function queueReview(origin) {
      review.buildReviewState(
        'mock-comic.cbr',
        CBR_PATH,
        [{
          score: 61,
          source: 'mock',
          metadata: {
            title: 'Mock Series #1',
            series: 'Mock Series',
            publisher: 'Mock Publisher',
            number: '1',
            year: '2020'
          }
        }],
        { source: origin, comicId: origin === 'file' ? 'mock-cbr-id' : undefined }
      );
    }

    test('applying a file-origin review does not trigger a full library scan', async () => {
      queueReview('file');

      await taggerFacade.applyUserSelection(['1']);

      expect(libraryScan.scanLibrary).not.toHaveBeenCalled();
      expect(companionSync.syncCompanionTag).toHaveBeenCalledWith('mock-cbr-id');
    });

    test('applying a scan-origin review still triggers a full library scan', async () => {
      queueReview('scan');

      await taggerFacade.applyUserSelection(['1']);

      expect(libraryScan.scanLibrary).toHaveBeenCalled();
    });
  });
});
