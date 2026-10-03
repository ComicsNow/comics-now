const fs = require('fs');
const path = require('path');

jest.mock('../server/config', () => ({
  getConfig: jest.fn(() => ({ comicsLocation: '/comics/inbox', allowed_formats: 'cbz' })),
  getTaggerServiceUrl: jest.fn(() => 'http://127.0.0.1:5000'),
  getMetadataStorage: jest.fn(() => 'archive'),
  getTaggerLowerThreshold: jest.fn(() => 0.8),
  getTaggerUpperThreshold: jest.fn(() => 0.9),
  getTaggerEnabledSources: jest.fn(() => []),
  getMetronUser: jest.fn(() => ''),
  getMetronPassword: jest.fn(() => ''),
  getComicVineApiKey: jest.fn(() => ''),
  getGoogleBooksApiKey: jest.fn(() => ''),
  getTaggerForceReprocess: jest.fn(() => false)
}));

const config = require('../server/config');
const db = require('../server/db');
const { getCtLogs } = require('../server/logger');
const metadataService = require('../server/services/metadata');
const {
  runComicTagger,
  resolveScanMode,
  getScanScopeCounts
} = require('../server/services/tagger');

const completeMeta = { Series: 'Batman', Publisher: 'DC Comics', Number: '1', Year: '2016' };

describe('resolveScanMode', () => {
  beforeEach(() => {
    config.getTaggerForceReprocess.mockReturnValue(false);
  });

  test('no options and setting off resolves to default', () => {
    expect(resolveScanMode({})).toBe('default');
    expect(resolveScanMode()).toBe('default');
  });

  test('no options and setting on resolves scheduled scans to existing-xml', () => {
    config.getTaggerForceReprocess.mockReturnValue(true);
    expect(resolveScanMode({})).toBe('existing-xml');
  });

  test('explicit mode wins over force and the setting', () => {
    config.getTaggerForceReprocess.mockReturnValue(true);
    expect(resolveScanMode({ mode: 'unmatched' })).toBe('unmatched');
    expect(resolveScanMode({ force: true, mode: 'default' })).toBe('default');
  });

  test('legacy force flag still resolves to the bypass-all force mode', () => {
    expect(resolveScanMode({ force: true })).toBe('force');
    expect(resolveScanMode({ force: false })).toBe('default');
  });

  test('unknown modes fall through to the normal precedence', () => {
    config.getTaggerForceReprocess.mockReturnValue(false);
    expect(resolveScanMode({ mode: 'bogus' })).toBe('default');
    expect(resolveScanMode({ mode: 'bogus', force: true })).toBe('force');
  });
});

describe('runComicTagger scoped scan modes', () => {
  const originalFetch = global.fetch;
  let dbGetSpy;
  let dbRunSpy;
  let metaSpy;

  function mockSingleComic(name = 'Batman 01.cbz') {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([{ name, isFile: () => true }]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 10000 });
  }

  function tagFileCalls() {
    return global.fetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/api/tag-file')
    );
  }

  function logsText() {
    return getCtLogs().map(l => l.message);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    config.getTaggerForceReprocess.mockReturnValue(false);
    config.getConfig.mockReturnValue({ comicsLocation: '/comics/inbox', allowed_formats: 'cbz' });
    getCtLogs().length = 0;
    global.fetch = jest.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'ok', version: '1.0' }) };
      }
      if (typeof url === 'string' && url.includes('/api/tag-file')) {
        return {
          ok: true,
          json: async () => ({ status: 'failed', confidence: 0, metadata: null })
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    dbGetSpy = jest.spyOn(db, 'dbGet').mockResolvedValue(null);
    dbRunSpy = jest.spyOn(db, 'dbRun').mockResolvedValue();
    metaSpy = jest.spyOn(metadataService, 'getComicInfoFromArchive').mockResolvedValue({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // --- Case A: previously failed, no ComicInfo.xml on disk ---
  test('unmatched mode retries a previously failed comic with force_reprocess', async () => {
    mockSingleComic();
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'failed' });
    metaSpy.mockResolvedValue({});

    await runComicTagger({ mode: 'unmatched' });

    expect(logsText().some(m => m.includes('Rescan Unmatched'))).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/tag-file',
      expect.objectContaining({ body: expect.stringContaining('"force_reprocess":true') })
    );
  });

  test('existing-xml mode skips a failed comic without ComicInfo.xml', async () => {
    mockSingleComic();
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'failed' });
    metaSpy.mockResolvedValue({});

    await runComicTagger({ mode: 'existing-xml' });

    expect(tagFileCalls().length).toBe(0);
    expect(logsText().some(m => m.includes('No existing ComicInfo.xml'))).toBe(true);
  });

  // --- Case B: previously failed, complete XML now on disk ---
  test('unmatched mode recognizes a failed comic that has gained complete XML (gate 2)', async () => {
    mockSingleComic();
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'failed' });
    metaSpy.mockResolvedValue(completeMeta);

    await runComicTagger({ mode: 'unmatched' });

    expect(tagFileCalls().length).toBe(0);
    expect(logsText().some(m => m.includes('Already contains complete metadata'))).toBe(true);
    expect(dbRunSpy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO comics'),
      expect.arrayContaining(['successful'])
    );
  });

  test('existing-xml mode re-scans a failed comic that has complete XML', async () => {
    mockSingleComic();
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'failed' });
    metaSpy.mockResolvedValue(completeMeta);

    await runComicTagger({ mode: 'existing-xml' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/tag-file',
      expect.objectContaining({ body: expect.stringContaining('"force_reprocess":true') })
    );
  });

  // --- Case C: successful comic with complete XML ---
  test('unmatched mode leaves a successful comic alone', async () => {
    mockSingleComic();
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'successful' });
    metaSpy.mockResolvedValue(completeMeta);

    await runComicTagger({ mode: 'unmatched' });

    expect(tagFileCalls().length).toBe(0);
    expect(logsText().some(m => m.includes('Not previously marked no-match'))).toBe(true);
  });

  test('existing-xml mode re-scans a successful comic with complete XML', async () => {
    mockSingleComic();
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'successful' });
    metaSpy.mockResolvedValue(completeMeta);

    await runComicTagger({ mode: 'existing-xml' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/tag-file',
      expect.objectContaining({ body: expect.stringContaining('"force_reprocess":true') })
    );
  });

  // --- Case D: brand-new file, no XML ---
  test('unmatched mode skips brand-new files (scope is DB failed rows)', async () => {
    mockSingleComic('New 01.cbz');
    dbGetSpy.mockResolvedValue(null);
    metaSpy.mockResolvedValue({});

    await runComicTagger({ mode: 'unmatched' });

    expect(tagFileCalls().length).toBe(0);
    expect(logsText().some(m => m.includes('Not previously marked no-match'))).toBe(true);
  });

  test('existing-xml mode skips brand-new files without XML', async () => {
    mockSingleComic('New 01.cbz');
    dbGetSpy.mockResolvedValue(null);
    metaSpy.mockResolvedValue({});

    await runComicTagger({ mode: 'existing-xml' });

    expect(tagFileCalls().length).toBe(0);
    expect(logsText().some(m => m.includes('No existing ComicInfo.xml'))).toBe(true);
  });

  // --- Case E: brand-new file with complete XML ---
  test('existing-xml mode re-scans a new file that already has complete XML', async () => {
    mockSingleComic('New 01.cbz');
    dbGetSpy.mockResolvedValue(null);
    metaSpy.mockResolvedValue(completeMeta);

    await runComicTagger({ mode: 'existing-xml' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/tag-file',
      expect.objectContaining({ body: expect.stringContaining('"force_reprocess":true') })
    );
  });

  // --- Case F: successful row whose XML is missing on disk ---
  test('existing-xml mode re-scans a successful row even when the on-disk probe fails', async () => {
    mockSingleComic('Stale 01.cbz');
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'successful' });
    metaSpy.mockResolvedValue({});

    await runComicTagger({ mode: 'existing-xml' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/tag-file',
      expect.objectContaining({ body: expect.stringContaining('"force_reprocess":true') })
    );
  });

  test('legacy force mode is unchanged: bypasses every gate', async () => {
    mockSingleComic();
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'successful' });
    metaSpy.mockResolvedValue(completeMeta);

    await runComicTagger({ force: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/tag-file',
      expect.objectContaining({ body: expect.stringContaining('"force_reprocess":true') })
    );
  });

  test('default mode still skips unmodified successful comics', async () => {
    mockSingleComic();
    dbGetSpy.mockResolvedValue({ id: 'mock-id', updatedAt: 10000, tagStatus: 'successful' });
    metaSpy.mockResolvedValue(completeMeta);

    await runComicTagger({ mode: 'default' });

    expect(tagFileCalls().length).toBe(0);
    expect(logsText().some(m => m.includes('Already scanned and tagged'))).toBe(true);
  });
});

describe('getScanScopeCounts', () => {
  let dbGetSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    config.getConfig.mockReturnValue({ comicsLocation: '/comics/inbox', allowed_formats: 'cbz' });
    dbGetSpy = jest.spyOn(db, 'dbGet').mockResolvedValue({ unmatched: 3 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('counts failed comics in the inbox with an escaped LIKE prefix', async () => {
    const counts = await getScanScopeCounts();

    expect(counts).toEqual({ unmatched: 3 });
    const [sql, params] = dbGetSpy.mock.calls[0];
    expect(sql).toContain("tagStatus = 'failed'");
    expect(sql).toContain("ESCAPE '^'");
    expect(sql).toContain('instr(substr(path, ?), ?) = 0');
    expect(params[0]).toBe(`/comics/inbox${path.sep}%`);
    expect(params[1]).toBe(`/comics/inbox${path.sep}`.length + 1);
    expect(params[2]).toBe(path.sep);
  });

  test('escapes LIKE wildcards in the inbox path', async () => {
    config.getConfig.mockReturnValue({ comicsLocation: '/comics/100%_in/bx', allowed_formats: 'cbz' });

    await getScanScopeCounts();

    const [, params] = dbGetSpy.mock.calls[0];
    expect(params[0]).toBe('/comics/100^%^_in/bx/%');
  });

  test('coerces a null count to zero', async () => {
    dbGetSpy.mockResolvedValue({ unmatched: null });
    expect(await getScanScopeCounts()).toEqual({ unmatched: 0 });
  });

  test('returns zero when the inbox is not configured', async () => {
    config.getConfig.mockReturnValue({ comicsLocation: '', allowed_formats: 'cbz' });
    expect(await getScanScopeCounts()).toEqual({ unmatched: 0 });
    expect(dbGetSpy).not.toHaveBeenCalled();
  });
});
