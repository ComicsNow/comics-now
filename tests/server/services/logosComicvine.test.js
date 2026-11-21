'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

const mockCvFetchJson = jest.fn();
const mockSettingsGet = jest.fn();
const mockSettingsGetSetting = jest.fn();

jest.mock('../../../server/services/comicvine', () => ({
  cvFetchJson: mockCvFetchJson,
}));

jest.mock('../../../server/settings', () => ({
  get: mockSettingsGet,
  getSetting: mockSettingsGetSetting,
}));

const { fetchPublisherLogo, clearInflightFetches } = require('../../../server/services/logos/comicvine');

describe('comicvine logo service', () => {
  let tempDir;
  let mockFetch;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-now-logo-'));
    clearInflightFetches();
    mockCvFetchJson.mockReset();
    mockSettingsGet.mockReset();
    mockSettingsGetSetting.mockReset();

    mockSettingsGet.mockImplementation((key) => {
      if (key === 'comicVineApiKey') return 'mock-cv-key';
      return null;
    });

    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null),
      },
      arrayBuffer: async () => TEST_PNG.buffer.slice(TEST_PNG.byteOffset, TEST_PNG.byteOffset + TEST_PNG.byteLength),
    });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    clearInflightFetches();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('returns skipped missing_api_key when API key is missing', async () => {
    mockSettingsGet.mockReturnValue(null);
    mockSettingsGetSetting.mockReturnValue(null);

    const result = await fetchPublisherLogo('Dark Horse Comics', tempDir);

    expect(result).toEqual({ skipped: true, reason: 'missing_api_key' });
    expect(mockCvFetchJson).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns skipped publisher_not_found when cvFetchJson returns no results', async () => {
    mockCvFetchJson.mockResolvedValue({ results: [] });

    const result = await fetchPublisherLogo('Boom! Studios', tempDir);

    expect(result).toEqual({ skipped: true, reason: 'publisher_not_found' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns skipped no_image_url when publisher has no image url', async () => {
    mockCvFetchJson.mockResolvedValue({
      results: [{ id: 1, name: 'IDW Publishing', image: {} }],
    });

    const result = await fetchPublisherLogo('IDW Publishing', tempDir);

    expect(result).toEqual({ skipped: true, reason: 'no_image_url' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('downloads buffer, sanitizes filename, writes cache and returns stored', async () => {
    const publisher = 'DC Comics';
    const imageUrl = 'https://comicvine.gamespot.com/a/uploads/original/1111/1111.png';
    mockCvFetchJson.mockResolvedValue({
      results: [{ id: 1, name: publisher, image: { original_url: imageUrl } }],
    });

    const result = await fetchPublisherLogo(publisher, tempDir);

    expect(result).toMatchObject({ stored: true });
    expect(result.filename).toBe(path.basename(result.filename));
    expect(result.filename.endsWith('.png')).toBe(true);
    expect(typeof result.baseUrl).toBe('string');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(imageUrl);

    const saved = fs.readFileSync(path.join(tempDir, result.filename));
    expect(saved.equals(TEST_PNG)).toBe(true);
  });

  it('single-flight: duplicate concurrent calls return the same in-flight Promise without duplicate network requests', async () => {
    const publisher = 'Valiant Entertainment';
    let resolveCv;
    const pendingCv = new Promise((resolve) => {
      resolveCv = resolve;
    });
    mockCvFetchJson.mockReturnValue(pendingCv);

    const first = fetchPublisherLogo(publisher, tempDir);
    const second = fetchPublisherLogo(publisher, tempDir);

    expect(second).toBe(first);

    // Yield multiple ticks for async getApiKey and endpoint resolution
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(mockCvFetchJson).toHaveBeenCalledTimes(1);

    resolveCv({
      results: [{ id: 1, name: publisher, image: { original_url: 'https://example.com/logo.png' } }],
    });

    await expect(first).resolves.toMatchObject({ stored: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
