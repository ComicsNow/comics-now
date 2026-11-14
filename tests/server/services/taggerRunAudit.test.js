const fs = require('fs');
const path = require('path');
const os = require('os');

describe('runComicTagger per-run consolidated scan audit logging', () => {
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-audit-'));
    fs.writeFileSync(path.join(tmpDir, 'Batman 001.cbz'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'Skipped 002.cbz'), 'b');
    fs.writeFileSync(path.join(tmpDir, 'Broken 003.cbz'), 'c');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('passes skip_scan_log: true per file and calls saveRunScanLog once for the entire run', async () => {
    const saveRunScanLog = jest.fn().mockResolvedValue({ success: true });
    const callTaggerEngineWithProgress = jest.fn(async (_url, reqBody) => {
      expect(reqBody.skip_scan_log).toBe(true);
      if (reqBody.path.endsWith('Batman 001.cbz')) {
        return { status: 'tagged', matched_title: 'Batman #1', confidence: 0.96, source: 'ComicVine', metadata: {} };
      }
      return { status: 'failed', error: 'No match' };
    });

    jest.doMock('../../../server/db', () => ({
      dbAll: jest.fn().mockResolvedValue([]),
      dbGet: jest.fn().mockResolvedValue(null),
      dbRun: jest.fn().mockResolvedValue({ changes: 1 })
    }));
    jest.doMock('../../../server/config', () => ({
      getTaggerServiceUrl: () => 'http://127.0.0.1:5000',
      getConfig: () => ({ comicsLocation: tmpDir, allowed_formats: 'cbz', ctScheduleMinutes: 0 })
    }));
    jest.doMock('../../../server/logger', () => ({ ctLog: jest.fn() }));
    jest.doMock('../../../server/services/tagger-process', () => ({
      isWorkerOnline: jest.fn().mockResolvedValue(true),
      startTaggerWorker: jest.fn()
    }));
    jest.doMock('../../../server/services/library-scan', () => ({ scanLibrary: jest.fn() }));
    jest.doMock('../../../server/services/tagger/persist', () => ({
      recordTaggedComic: jest.fn().mockResolvedValue({ isSuccessful: true }),
      recordUnmatchedComic: jest.fn().mockResolvedValue(),
      batchUpdateFailedComics: jest.fn()
    }));
    jest.doMock('../../../server/services/tagger/companion-sync', () => ({
      syncCompanionTag: jest.fn().mockResolvedValue()
    }));
    jest.doMock('../../../server/services/tagger/gates', () => ({
      resolveScanMode: () => 'default',
      evaluateFileGates: jest.fn(async (fp) => ({
        skip: fp.endsWith('Skipped 002.cbz'),
        reason: fp.endsWith('Skipped 002.cbz') ? 'Already enhanced' : null
      }))
    }));
    jest.doMock('../../../server/services/tagger/single-file', () => ({
      resolveCoverPath: jest.fn().mockResolvedValue(null),
      buildTaggerRequest: ({ filePath }) => ({ path: filePath })
    }));
    jest.doMock('../../../server/services/tagger/engine-client', () => ({
      formatDuration: () => '1s',
      callTaggerEngineWithProgress,
      saveRunScanLog
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0' })
    });

    const { runComicTagger } = require('../../../server/services/tagger/runner');
    await runComicTagger({});

    expect(callTaggerEngineWithProgress).toHaveBeenCalledTimes(2);
    expect(saveRunScanLog).toHaveBeenCalledTimes(1);
    const runPayload = saveRunScanLog.mock.calls[0][0];
    expect(runPayload.total_files).toBe(3);
    expect(runPayload.tagged_count).toBe(1);
    expect(runPayload.skipped_count).toBe(1);
    expect(runPayload.failed_count).toBe(1);
    expect(runPayload.results).toHaveLength(3);
    expect(runPayload.results.map(r => r.status).sort()).toEqual(['failed', 'skipped', 'tagged']);
  });
});
