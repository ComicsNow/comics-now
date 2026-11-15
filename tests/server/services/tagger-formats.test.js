const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../server/db', () => ({
  dbGet: jest.fn(),
  dbAll: jest.fn().mockResolvedValue([]),
  dbRun: jest.fn().mockResolvedValue({})
}));

jest.mock('../../../server/config', () => ({
  getMetadataStorage: jest.fn(() => 'sidecar'),
  getTaggerServiceUrl: jest.fn(() => 'http://127.0.0.1:5000'),
  getComicVineApiKey: jest.fn(() => ''),
  getGoogleBooksApiKey: jest.fn(() => ''),
  getMetronUser: jest.fn(() => ''),
  getMetronPassword: jest.fn(() => ''),
  getGcdUser: jest.fn(() => ''),
  getGcdPassword: jest.fn(() => ''),
  getTaggerLowerThreshold: jest.fn(() => 0.8),
  getTaggerUpperThreshold: jest.fn(() => 0.9),
  getTaggerEnabledSources: jest.fn(() => ['src-comicvine']),
  getConfig: jest.fn(() => ({ allowed_formats: ['cbz', 'pdf', 'epub'] }))
}));

jest.mock('../../../server/logger', () => ({
  ctLog: jest.fn(),
  log: jest.fn()
}));

jest.mock('../../../server/services/tagger/engine-client', () => ({
  callTaggerEngineWithProgress: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'test' })
}));

jest.mock('../../../server/services/tagger-process', () => ({
  isWorkerOnline: jest.fn().mockResolvedValue(true),
  startTaggerService: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../server/services/library-scan', () => ({
  isScanning: jest.fn(() => false)
}));

jest.mock('../../../server/services/library-pages', () => ({
  generateThumbnail: jest.fn().mockResolvedValue('thumb.jpg')
}));

jest.mock('../../../server/services/tagger/persist', () => ({
  applyTaggerResultToDb: jest.fn().mockResolvedValue({})
}));

jest.mock('../../../server/services/tagger/companion-sync', () => ({
  syncCompanionMetadata: jest.fn().mockResolvedValue({})
}));

const db = require('../../../server/db');
const engineClient = require('../../../server/services/tagger/engine-client');
const { runSingleFileTagger } = require('../../../server/services/tagger/single-file');
const { filterTaggerComicEntries } = require('../../../server/services/tagger/runner');

describe('tagger format support for PDF and comic EPUB', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagger-formats-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['comic.pdf', '%PDF-1.4\n'],
    ['comic.epub', 'PK\x03\x04']
  ])('runSingleFileTagger accepts %s and forces sidecar storage', async (filename, content) => {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, content);
    db.dbGet.mockResolvedValue({
      id: 'id-' + filename,
      path: filePath,
      name: filename,
      thumbnailPath: null,
      originalPath: null
    });

    await runSingleFileTagger({ comicId: 'id-' + filename });

    expect(engineClient.callTaggerEngineWithProgress).toHaveBeenCalledWith(
      'http://127.0.0.1:5000',
      expect.objectContaining({
        path: filePath,
        metadata_storage: 'sidecar'
      }),
      undefined,
      expect.any(Function)
    );
  });

  test('filterTaggerComicEntries skips .xml, .aria2, non-comic files, and disallowed comic formats', () => {
    const mockEntry = (name, isFile = true) => ({ name, isFile: () => isFile });
    const entries = [
      mockEntry('issue.cbz'),
      mockEntry('issue.pdf'),
      mockEntry('issue.epub'),
      mockEntry('disallowed.cbr'),
      mockEntry('issue.ComicInfo.xml'),
      mockEntry('download.pdf.aria2'),
      mockEntry('notes.txt'),
      mockEntry('.hidden.cbz'),
      mockEntry('subfolder', false)
    ];

    const filtered = filterTaggerComicEntries(entries, ['cbz', 'pdf', 'epub']);
    expect(filtered.map(e => e.name)).toEqual(['issue.cbz', 'issue.pdf', 'issue.epub']);
  });
});
