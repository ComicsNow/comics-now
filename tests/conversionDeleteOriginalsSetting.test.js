const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const attachUserSettingsRoutes = require('../server/routes/user/settings');
const attachAdminSettingsRoutes = require('../server/routes/admin/settings');

describe('Separate CBR and PDF Delete Originals After Conversion Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('DEFAULT_CONFIG defaults both delete_cbr_after_conversion and delete_pdf_after_conversion to false (Keep)', () => {
    expect(config.DEFAULT_CONFIG.delete_cbr_after_conversion).toBe(false);
    expect(config.DEFAULT_CONFIG.delete_pdf_after_conversion).toBe(false);
    expect(config.DEFAULT_CONFIG.delete_originals_after_conversion).toBeUndefined();
  });

  test('config.example.json includes delete_cbr_after_conversion and delete_pdf_after_conversion set to false by default', () => {
    const examplePath = path.join(__dirname, '..', 'config.example.json');
    const parsed = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
    expect(parsed.delete_cbr_after_conversion).toBe(false);
    expect(parsed.delete_pdf_after_conversion).toBe(false);
    expect(parsed.delete_originals_after_conversion).toBeUndefined();
  });

  test('CBR and PDF config accessors toggle independently', () => {
    expect(typeof config.getDeleteCbrAfterConversion).toBe('function');
    expect(typeof config.setDeleteCbrAfterConversion).toBe('function');
    expect(typeof config.getDeletePdfAfterConversion).toBe('function');
    expect(typeof config.setDeletePdfAfterConversion).toBe('function');

    config.setDeleteCbrAfterConversion(true, true);
    config.setDeletePdfAfterConversion(false, true);
    expect(config.getDeleteCbrAfterConversion()).toBe(true);
    expect(config.getDeletePdfAfterConversion()).toBe(false);

    config.setDeleteCbrAfterConversion('keep', true);
    config.setDeletePdfAfterConversion('delete', true);
    expect(config.getDeleteCbrAfterConversion()).toBe(false);
    expect(config.getDeletePdfAfterConversion()).toBe(true);
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
