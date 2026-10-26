const fs = require('fs');
const path = require('path');
const { resolveLogo } = require('../../../server/services/library-logos');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn(),
  },
}));

jest.mock('sharp');
const sharp = require('sharp');

// Mock logger to suppress errors
jest.mock('../../../server/logger', () => ({
  log: jest.fn(),
}));

describe('library-logos', () => {
  const baseDir = '/test/dir';
  let dirCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getUniqueDir = () => `${baseDir}_${dirCounter++}`;

  describe('findLogoFileIn and basic resolveLogo', () => {
    it('returns null if directory cannot be read', async () => {
      fs.promises.readdir.mockRejectedValue(new Error('ENOENT'));
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: null, needsBackground: false, needsDarkBackground: false });
    });

    it('returns null if no images are found', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'document.txt', isFile: () => true },
        { name: 'folder', isFile: () => false },
      ]);
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: null, needsBackground: false, needsDarkBackground: false });
    });

    it('prefers files starting with "logo." and ignores others even if they are valid images', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'cover.jpg', isFile: () => true },
        { name: 'logo.png', isFile: () => true },
        { name: 'banner.png', isFile: () => true },
      ]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data: Buffer.from([0,0,0,255]) }) })
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result.logoFile).toBe('logo.png');
    });

    it('falls back to any valid image if no preferred logo exists', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'document.txt', isFile: () => true },
        { name: 'banner.jpg', isFile: () => true },
      ]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'jpeg', hasAlpha: false }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data: Buffer.alloc(0) }) })
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result.logoFile).toBe('banner.jpg');
    });
  });

  describe('inspectLogoContrast', () => {
    it('returns default contrast if sharp throws an error', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      sharp.mockImplementation(() => {
        throw new Error('Sharp error');
      });
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: 'logo.png', needsBackground: false, needsDarkBackground: false });
    });

    it('returns default contrast if metadata is missing', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue(null),
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: 'logo.png', needsBackground: false, needsDarkBackground: false });
    });

    it('returns default contrast if format is unsupported', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.jpg', isFile: () => true }]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'jpeg', hasAlpha: false }),
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: 'logo.jpg', needsBackground: false, needsDarkBackground: false });
    });

    it('returns default contrast if format is supported but has no alpha (unless svg)', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'png', hasAlpha: false }),
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: 'logo.png', needsBackground: false, needsDarkBackground: false });
    });

    it('processes SVG without alpha channel', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.svg', isFile: () => true }]);
      // Light color, alpha=255
      const data = Buffer.from([200, 200, 200, 255]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'svg', hasAlpha: false }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data }) })
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result.logoFile).toBe('logo.svg');
      expect(result.needsDarkBackground).toBe(true);
    });

    it('detects dark logos (avg brightness < 120)', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      // Dark color (e.g. RGB(10,10,10), Alpha=255)
      const data = Buffer.from([10, 10, 10, 255]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data }) })
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: 'logo.png', needsBackground: true, needsDarkBackground: false });
    });

    it('detects light logos (avg brightness > 160)', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      // Light color (e.g. RGB(200,200,200), Alpha=255)
      const data = Buffer.from([200, 200, 200, 255]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data }) })
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: 'logo.png', needsBackground: false, needsDarkBackground: true });
    });

    it('ignores mostly transparent pixels', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      // First pixel is light but transparent (alpha 10 <= 15).
      // Second pixel is dark and opaque.
      const data = Buffer.from([255, 255, 255, 10, 20, 20, 20, 255]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data }) })
      }));
      const result = await resolveLogo(getUniqueDir());
      // The transparent pixel should be ignored, so only the dark one is counted.
      expect(result).toEqual({ logoFile: 'logo.png', needsBackground: true, needsDarkBackground: false });
    });

    it('returns default if no visible pixels exist', async () => {
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      // Pixel is transparent (alpha <= 15).
      const data = Buffer.from([255, 255, 255, 10]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data }) })
      }));
      const result = await resolveLogo(getUniqueDir());
      expect(result).toEqual({ logoFile: 'logo.png', needsBackground: false, needsDarkBackground: false });
    });
  });

  describe('caching', () => {
    it('returns cached result on subsequent calls', async () => {
      const dir = getUniqueDir();
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data: Buffer.from([10, 10, 10, 255]) }) })
      }));

      const result1 = await resolveLogo(dir);
      expect(result1).toEqual({ logoFile: 'logo.png', needsBackground: true, needsDarkBackground: false });
      expect(fs.promises.readdir).toHaveBeenCalledTimes(1);

      // Second call for the same dir should use cache
      const result2 = await resolveLogo(dir);
      expect(result2).toEqual({ logoFile: 'logo.png', needsBackground: true, needsDarkBackground: false });
      // readdir should not be called again
      expect(fs.promises.readdir).toHaveBeenCalledTimes(1);
    });

    it('recomputes if cache is expired', async () => {
      const dir = getUniqueDir();
      fs.promises.readdir.mockResolvedValue([{ name: 'logo.png', isFile: () => true }]);
      sharp.mockImplementation(() => ({
        metadata: jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true }),
        raw: () => ({ toBuffer: jest.fn().mockResolvedValue({ data: Buffer.from([10, 10, 10, 255]) }) })
      }));

      // Mock Date.now to control expiration
      const OriginalDateNow = Date.now;
      let currentTime = 10000;
      Date.now = jest.fn(() => currentTime);

      const result1 = await resolveLogo(dir);
      expect(result1).toEqual({ logoFile: 'logo.png', needsBackground: true, needsDarkBackground: false });
      expect(fs.promises.readdir).toHaveBeenCalledTimes(1);

      // Fast forward time past cache TTL (24h)
      currentTime += 24 * 60 * 60 * 1000 + 1;

      const result2 = await resolveLogo(dir);
      expect(result2).toEqual({ logoFile: 'logo.png', needsBackground: true, needsDarkBackground: false });
      // readdir should be called again since cache expired
      expect(fs.promises.readdir).toHaveBeenCalledTimes(2);

      // Restore Date.now
      Date.now = OriginalDateNow;
    });
  });
});
