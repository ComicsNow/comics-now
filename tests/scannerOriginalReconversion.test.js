const fs = require('fs');
const os = require('os');
const path = require('path');

const mockConfig = { comicsLocation: '/tmp/inbox', metadata_storage: 'archive' };

jest.mock('../server/config', () => ({
  getConfig: () => mockConfig
}));

jest.mock('../server/services/library-conversion', () => ({
  convertCbrToCbz: jest.fn(),
  convertPdfToCbz: jest.fn()
}));

jest.mock('../server/services/library-pages', () => ({
  getComicPages: jest.fn().mockResolvedValue([]),
  generateThumbnail: jest.fn().mockResolvedValue('thumb.jpg')
}));

jest.mock('../server/services/metadata', () => ({
  getComicInfoFromArchive: jest.fn().mockResolvedValue({}),
  normalizePublisher: jest.fn(p => p || 'Unknown Publisher'),
  cleanDescription: jest.fn(d => d),
  splitVolumeSeriesAndTitle: jest.fn(() => ({})),
  isTitleSameAsSeries: jest.fn(() => false)
}));

const dbModule = require('../server/db');
const { convertCbrToCbz, convertPdfToCbz } = require('../server/services/library-conversion');
const { buildOriginalLinkMap } = require('../server/services/scan/original-links');

let walkLibraryDirectory;
let inboxDir;
let libraryDir;
let mockExisting;
let dbGetSpy;
let dbRunSpy;

function makeCtx(overrides = {}) {
  return {
    config: mockConfig,
    allowedFormats: 'cbz',
    conversionRoot: inboxDir,
    fileSystemComics: new Set(),
    newComicIds: [],
    dbComicsMap: new Map(),
    stats: {
      totalSeen: 0,
      totalInsertedOrUpdated: 0,
      totalConverted: 0,
      thumbOk: 0,
      thumbFail: 0,
      errors: 0,
      subDirScanErrors: 0
    },
    force: false,
    originalLinks: new Map(),
    ...overrides
  };
}

function comicInsertCalls() {
  return dbRunSpy.mock.calls.filter(c => /INSERT OR REPLACE INTO comics/.test(c[0]));
}

beforeAll(() => {
  dbGetSpy = jest.spyOn(dbModule, 'dbGet');
  dbRunSpy = jest.spyOn(dbModule, 'dbRun').mockResolvedValue({ changes: 1 });
  ({ walkLibraryDirectory } = require('../server/services/scan/crawler'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting = null;
  dbRunSpy.mockResolvedValue({ changes: 1 });
  dbGetSpy.mockImplementation(async sql => {
    if (sql.includes('scan_dirs')) return undefined;
    if (sql.includes('FROM comics WHERE id')) return mockExisting;
    return undefined;
  });

  inboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-originals-inbox-'));
  libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-originals-library-'));
  mockConfig.comicsLocation = inboxDir;
});

afterEach(() => {
  fs.rmSync(inboxDir, { recursive: true, force: true });
  fs.rmSync(libraryDir, { recursive: true, force: true });
});

afterAll(() => {
  dbGetSpy.mockRestore();
  dbRunSpy.mockRestore();
});

describe('scanner conversion with linked originals', () => {
  test.each([
    ['pdf', convertPdfToCbz, 'Issue One.pdf'],
    ['cbr', convertCbrToCbz, 'Issue One.cbr']
  ])('skips %s conversion when a live linked CBZ exists', async (_kind, convertMock, fileName) => {
    const originalPath = path.join(inboxDir, fileName);
    fs.writeFileSync(originalPath, 'original');
    const linkedCbz = path.join(libraryDir, 'Renamed Issue.cbz');
    fs.writeFileSync(linkedCbz, 'cbz');

    const ctx = makeCtx({
      originalLinks: buildOriginalLinkMap([{ path: linkedCbz, originalPath }])
    });

    await walkLibraryDirectory({
      dir: inboxDir,
      libraryMode: 'metadata',
      libraryRootPath: inboxDir,
      ctx
    });

    expect(convertMock).not.toHaveBeenCalled();
  });

  test.each([
    ['pdf', convertPdfToCbz, 'Issue Two.pdf'],
    ['cbr', convertCbrToCbz, 'Issue Two.cbr']
  ])('converts %s and records the linked original when the linked CBZ is gone', async (_kind, convertMock, fileName) => {
    const originalPath = path.join(inboxDir, fileName);
    fs.writeFileSync(originalPath, 'original');
    const missingCbz = path.join(libraryDir, 'Missing.cbz');

    convertMock.mockImplementation(async src => {
      const dest = src.replace(/\.(pdf|cbr)$/i, '.cbz');
      fs.writeFileSync(dest, 'converted');
      return dest;
    });

    const ctx = makeCtx({
      originalLinks: buildOriginalLinkMap([{ path: missingCbz, originalPath }])
    });

    await walkLibraryDirectory({
      dir: inboxDir,
      libraryMode: 'metadata',
      libraryRootPath: inboxDir,
      ctx
    });

    expect(convertMock).toHaveBeenCalledWith(originalPath);
    const inserts = comicInsertCalls();
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toContain('originalPath');
    expect(inserts[0][1][11]).toBe(originalPath);
  });

  test('records null when the conversion deleted the original', async () => {
    const originalPath = path.join(inboxDir, 'Deleted Source.pdf');
    fs.writeFileSync(originalPath, 'original');

    convertPdfToCbz.mockImplementation(async src => {
      const dest = src.replace(/\.pdf$/i, '.cbz');
      fs.writeFileSync(dest, 'converted');
      fs.unlinkSync(src);
      return dest;
    });

    const ctx = makeCtx();
    await walkLibraryDirectory({ dir: inboxDir, libraryMode: 'metadata', libraryRootPath: inboxDir, ctx });

    const inserts = comicInsertCalls();
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][11]).toBeNull();
  });

  test('preserves an existing link on rescan when the original still exists', async () => {
    const cbzPath = path.join(inboxDir, 'Issue Three.cbz');
    const originalPath = path.join(inboxDir, 'Issue Three.pdf');
    fs.writeFileSync(cbzPath, 'cbz');
    fs.writeFileSync(originalPath, 'original');
    mockExisting = {
      updatedAt: 0,
      thumbnailPath: 'thumb.jpg',
      metadata: null,
      lastReadPage: 0,
      totalPages: 0,
      convertedAt: 123,
      originalPath,
      guidedViewStatus: 'completed',
      guidedViewPath: '/metadata/guided_view/x.json',
      guidedViewError: null,
      tagStatus: 'successful'
    };

    const ctx = makeCtx({ force: true });
    await walkLibraryDirectory({ dir: inboxDir, libraryMode: 'metadata', libraryRootPath: inboxDir, ctx });

    const inserts = comicInsertCalls();
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][11]).toBe(originalPath);
  });

  test('clears a stale link when the original is gone', async () => {
    const cbzPath = path.join(inboxDir, 'Issue Four.cbz');
    fs.writeFileSync(cbzPath, 'cbz');
    mockExisting = {
      updatedAt: 0,
      thumbnailPath: 'thumb.jpg',
      metadata: null,
      lastReadPage: 0,
      totalPages: 0,
      convertedAt: 123,
      originalPath: path.join(inboxDir, 'No Longer Here.pdf'),
      guidedViewStatus: 'completed',
      guidedViewPath: '/metadata/guided_view/x.json',
      guidedViewError: null,
      tagStatus: 'successful'
    };

    const ctx = makeCtx({ force: true });
    await walkLibraryDirectory({ dir: inboxDir, libraryMode: 'metadata', libraryRootPath: inboxDir, ctx });

    const inserts = comicInsertCalls();
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][11]).toBeNull();
  });

  test('does not consult original links for natively indexed CBRs', async () => {
    const cbrPath = path.join(inboxDir, 'Native Issue.cbr');
    fs.writeFileSync(cbrPath, 'cbr');
    const linkedCbz = path.join(libraryDir, 'Native Issue.cbz');
    fs.writeFileSync(linkedCbz, 'cbz');

    const ctx = makeCtx({
      allowedFormats: 'cbr',
      originalLinks: buildOriginalLinkMap([{ path: linkedCbz, originalPath: cbrPath }])
    });

    await walkLibraryDirectory({ dir: inboxDir, libraryMode: 'metadata', libraryRootPath: inboxDir, ctx });

    expect(convertCbrToCbz).not.toHaveBeenCalled();
    const inserts = comicInsertCalls();
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][1]).toBe(cbrPath);
    expect(inserts[0][1][11]).toBeNull();
  });
});
