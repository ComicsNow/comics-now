const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { setLogo } = require('../../../server/services/logos/cache');
const { downloadImageBuffer, cvFetchJson } = require('../../../server/services/logos/comicvine');

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function mockFetchResponse(payload = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    arrayBuffer: async () =>
      PNG_HEADER.buffer.slice(
        PNG_HEADER.byteOffset,
        PNG_HEADER.byteOffset + PNG_HEADER.byteLength
      ),
  };
}

describe('logosCache', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  describe('setLogo', () => {
    it('writes the downloaded buffer and returns an integer version', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logos-cache-'));
      const logoPath = path.join(tmpDir, 'publisher.png');
      await fs.writeFile(logoPath, ONE_PIXEL_PNG);

      try {
        const entry = await setLogo(tmpDir, 'publisher.png', {
          publisher: 'Test Publisher',
          originalUrl: 'https://example.com/publisher.png',
        });

        expect(Number.isInteger(entry.version)).toBe(true);
        expect(entry.version).toBeGreaterThan(0);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('downloadImageBuffer', () => {
    it('uses global fetch and response.arrayBuffer', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue(mockFetchResponse());

      const url = 'https://example.com/logo.png';
      const buffer = await downloadImageBuffer(url);

      expect(globalThis.fetch).toHaveBeenCalled();
      expect(globalThis.fetch.mock.calls[0][0]).toBe(url);
      expect(buffer).toEqual(PNG_HEADER);
    });
  });

  describe('cvFetchJson', () => {
    it('returns the parsed JSON payload', async () => {
      const payload = {
        responses: [{ logoAnnotations: [{ description: 'test-logo' }] }],
      };
      globalThis.fetch = jest.fn().mockResolvedValue(mockFetchResponse(payload));

      const apiUrl =
        'https://vision.googleapis.com/v1/images:annotate?key=test-key';
      const result = await cvFetchJson(apiUrl, {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              image: {
                source: { imageUri: 'https://example.com/logo.png' },
              },
            },
          ],
        }),
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining(apiUrl),
        expect.any(Object)
      );
      expect(result).toEqual(payload);
    });
  });
});
