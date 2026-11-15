const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const attachUserSettingsRoutes = require('../server/routes/user/settings');
const attachAdminSettingsRoutes = require('../server/routes/admin/settings');

describe('Separate CBR and PDF Delete Originals After Conversion Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('DEFAULT_CONFIG defaults auto-convert OFF, delete flags false (Keep), and metadata_storage to sidecar', () => {
    expect(config.DEFAULT_CONFIG.auto_convert_enabled).toBe(false);
    expect(config.DEFAULT_CONFIG.auto_convert_formats).toEqual([]);
    expect(config.DEFAULT_CONFIG.delete_cbr_after_conversion).toBe(false);
    expect(config.DEFAULT_CONFIG.delete_pdf_after_conversion).toBe(false);
    expect(config.DEFAULT_CONFIG.delete_epub_after_conversion).toBe(false);
    expect(config.DEFAULT_CONFIG.metadata_storage).toBe('sidecar');
    expect(config.DEFAULT_CONFIG.delete_originals_after_conversion).toBeUndefined();
  });

  test('config.example.json includes first-install defaults for auto-convert, epub delete flag, and sidecar metadata', () => {
    const examplePath = path.join(__dirname, '..', 'config.example.json');
    const parsed = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
    expect(parsed.auto_convert_enabled).toBe(false);
    expect(parsed.auto_convert_formats).toEqual([]);
    expect(parsed.delete_cbr_after_conversion).toBe(false);
    expect(parsed.delete_pdf_after_conversion).toBe(false);
    expect(parsed.delete_epub_after_conversion).toBe(false);
    expect(parsed.metadata_storage).toBe('sidecar');
    expect(parsed.delete_originals_after_conversion).toBeUndefined();
  });

  test('CBR, PDF, EPUB, and auto-convert config accessors toggle independently', () => {
    expect(typeof config.getDeleteCbrAfterConversion).toBe('function');
    expect(typeof config.setDeleteCbrAfterConversion).toBe('function');
    expect(typeof config.getDeletePdfAfterConversion).toBe('function');
    expect(typeof config.setDeletePdfAfterConversion).toBe('function');
    expect(typeof config.getDeleteEpubAfterConversion).toBe('function');
    expect(typeof config.setDeleteEpubAfterConversion).toBe('function');
    expect(typeof config.getAutoConvertEnabled).toBe('function');
    expect(typeof config.setAutoConvertEnabled).toBe('function');
    expect(typeof config.getAutoConvertFormats).toBe('function');
    expect(typeof config.setAutoConvertFormats).toBe('function');

    config.setDeleteCbrAfterConversion(true, true);
    config.setDeletePdfAfterConversion(false, true);
    config.setDeleteEpubAfterConversion(true, true);
    expect(config.getDeleteCbrAfterConversion()).toBe(true);
    expect(config.getDeletePdfAfterConversion()).toBe(false);
    expect(config.getDeleteEpubAfterConversion()).toBe(true);

    config.setDeleteCbrAfterConversion('keep', true);
    config.setDeletePdfAfterConversion('delete', true);
    config.setDeleteEpubAfterConversion('keep', true);
    expect(config.getDeleteCbrAfterConversion()).toBe(false);
    expect(config.getDeletePdfAfterConversion()).toBe(true);
    expect(config.getDeleteEpubAfterConversion()).toBe(false);

    config.setAutoConvertEnabled(true, true);
    config.setAutoConvertFormats(['pdf', 'epub', 'cbz'], true);
    expect(config.getAutoConvertEnabled()).toBe(true);
    expect(config.getAutoConvertFormats()).toEqual(['pdf', 'epub']);
  });

  test('GET /api/v1/settings returns deleteCbrAfterConversion and deletePdfAfterConversion', async () => {
    let getHandler;
    const router = {
      get: jest.fn((p, h) => {
        if (p === '/api/v1/settings') getHandler = h;
      })
    };
    const deps = {
      getComicVineApiKey: () => '',
      getScanIntervalMinutes: () => 5,
      getAllowedFormats: () => 'cbz',
      getMetadataStorage: () => 'archive',
      getDeleteCbrAfterConversion: () => true,
      getDeletePdfAfterConversion: () => false
    };
    attachUserSettingsRoutes(router, deps);

    const res = { json: jest.fn() };
    await getHandler({ user: { role: 'admin' } }, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        deleteCbrAfterConversion: true,
        deletePdfAfterConversion: false
      })
    );
  });

  test('POST /api/v1/settings persists deleteCbrAfterConversion and deletePdfAfterConversion independently', async () => {
    let postHandler;
    const router = {
      get: jest.fn(),
      post: jest.fn((p, ...args) => {
        if (p === '/api/v1/settings') postHandler = args[args.length - 1];
      }),
      delete: jest.fn()
    };
    const deps = {
      getLibraries: jest.fn(() => []),
      addLibrary: jest.fn(),
      removeLibrary: jest.fn(),
      saveSetting: jest.fn().mockResolvedValue(),
      scheduleNextScan: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      validateScanInterval: jest.fn((v) => ({ valid: true, sanitized: v })),
      validateApiKey: jest.fn((v) => ({ valid: true, sanitized: v })),
      setScanIntervalMinutes: jest.fn(),
      setComicVineApiKey: jest.fn(),
      setAllowedFormats: jest.fn(),
      setMetadataStorage: jest.fn(),
      setDeleteCbrAfterConversion: jest.fn(),
      setDeletePdfAfterConversion: jest.fn(),
      requireAdmin: jest.fn((req, res, next) => next())
    };
    attachAdminSettingsRoutes(router, deps);

    const req = {
      body: {
        interval: 5,
        apiKey: '',
        allowedFormats: 'cbz',
        metadataStorage: 'archive',
        deleteCbrAfterConversion: true,
        deletePdfAfterConversion: false
      }
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await postHandler(req, res);

    expect(deps.setDeleteCbrAfterConversion).toHaveBeenCalledWith(true);
    expect(deps.setDeletePdfAfterConversion).toHaveBeenCalledWith(false);
    expect(deps.saveSetting).toHaveBeenCalledWith('delete_cbr_after_conversion', true);
    expect(deps.saveSetting).toHaveBeenCalledWith('delete_pdf_after_conversion', false);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  test('public/index.html includes separate cbr-conversion-originals-select and pdf-conversion-originals-select', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    expect(html).toMatch(/id="cbr-conversion-originals-select"/);
    expect(html).toMatch(/id="pdf-conversion-originals-select"/);
  });
});
