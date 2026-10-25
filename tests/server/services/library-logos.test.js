const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { resolveLogo } = require('../../../server/services/library-logos');
const { log } = require('../../../server/logger');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn()
  }
}));

jest.mock('sharp', () => jest.fn(), { virtual: true });

jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));

jest.mock('../../../server/utils', () => ({
  isImage: jest.fn((filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    return ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
  })
}));

describe('library-logos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveLogo', () => {
    it('should prefer a file starting with logo. over others', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'other.png', isFile: () => true },
        { name: 'logo.png', isFile: () => true },
        { name: 'not_a_file', isFile: () => false }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true });
      const mockToBuffer = jest.fn().mockResolvedValue({ data: Buffer.from([128, 128, 128, 255]) }); // ~128 brightness
      sharp.mockReturnValue({ metadata: mockMetadata, raw: () => ({ toBuffer: mockToBuffer }) });

      const result = await resolveLogo('/dir-prefer');
      expect(result.logoFile).toBe('logo.png');
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(false);
    });

    it('should fallback to any image if logo.* is not found', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'some-image.svg', isFile: () => true },
        { name: 'text.txt', isFile: () => true }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'svg', hasAlpha: false });
      const mockToBuffer = jest.fn().mockResolvedValue({ data: Buffer.from([200, 200, 200, 255]) });
      sharp.mockReturnValue({ metadata: mockMetadata, raw: () => ({ toBuffer: mockToBuffer }) });

      const result = await resolveLogo('/dir-fallback');
      expect(result.logoFile).toBe('some-image.svg');
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(true);
    });

    it('should return null if no image found', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'text.txt', isFile: () => true }
      ]);

      const result = await resolveLogo('/dir-none');
      expect(result.logoFile).toBe(null);
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(false);
    });

    it('should return null if readdir fails', async () => {
      fs.promises.readdir.mockRejectedValue(new Error('no access'));

      const result = await resolveLogo('/dir-error');
      expect(result.logoFile).toBe(null);
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(false);
    });

    it('should calculate light background needed for dark images (<120 brightness)', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.png', isFile: () => true }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true });
      // Brightness = 0.299*50 + 0.587*50 + 0.114*50 = 50 (< 120)
      const mockToBuffer = jest.fn().mockResolvedValue({ data: Buffer.from([50, 50, 50, 255]) });
      sharp.mockReturnValue({ metadata: mockMetadata, raw: () => ({ toBuffer: mockToBuffer }) });

      const result = await resolveLogo('/dir-dark');
      expect(result.needsBackground).toBe(true);
      expect(result.needsDarkBackground).toBe(false);
    });

    it('should calculate dark background needed for light images (>160 brightness)', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.webp', isFile: () => true }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'webp', hasAlpha: true });
      // Brightness = 200 (> 160)
      const mockToBuffer = jest.fn().mockResolvedValue({ data: Buffer.from([200, 200, 200, 255]) });
      sharp.mockReturnValue({ metadata: mockMetadata, raw: () => ({ toBuffer: mockToBuffer }) });

      const result = await resolveLogo('/dir-light');
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(true);
    });

    it('should ignore completely transparent pixels', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.png', isFile: () => true }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true });
      // 1 transparent pixel (ignored), 1 white pixel (counted)
      const mockToBuffer = jest.fn().mockResolvedValue({ data: Buffer.from([0, 0, 0, 0, 255, 255, 255, 255]) });
      sharp.mockReturnValue({ metadata: mockMetadata, raw: () => ({ toBuffer: mockToBuffer }) });

      const result = await resolveLogo('/dir-transparent');
      expect(result.needsBackground).toBe(false); // Since only the white pixel counts, avg is 255
      expect(result.needsDarkBackground).toBe(true);
    });

    it('should handle images with no visible pixels', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.png', isFile: () => true }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true });
      const mockToBuffer = jest.fn().mockResolvedValue({ data: Buffer.from([0, 0, 0, 0]) });
      sharp.mockReturnValue({ metadata: mockMetadata, raw: () => ({ toBuffer: mockToBuffer }) });

      const result = await resolveLogo('/dir-empty-visible');
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(false);
    });

    it('should handle sharp throwing an error', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.png', isFile: () => true }
      ]);

      sharp.mockImplementation(() => {
        throw new Error('sharp fail');
      });

      const result = await resolveLogo('/dir-sharp-fail');
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(false);
      expect(log).toHaveBeenCalledWith('ERROR', 'LOGOS', expect.stringContaining('sharp fail'));
    });

    it('should handle sharp returning no metadata', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.png', isFile: () => true }
      ]);

      sharp.mockReturnValue({ metadata: jest.fn().mockResolvedValue(null) });

      const result = await resolveLogo('/dir-no-metadata');
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(false);
    });

    it('should handle unsupported format', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.jpg', isFile: () => true }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'jpeg', hasAlpha: false });
      sharp.mockReturnValue({ metadata: mockMetadata });

      const result = await resolveLogo('/dir-unsupported');
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(false);
    });

    it('should handle supported format with no alpha (not svg)', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.png', isFile: () => true }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'png', hasAlpha: false });
      sharp.mockReturnValue({ metadata: mockMetadata });

      const result = await resolveLogo('/dir-no-alpha');
      expect(result.needsBackground).toBe(false);
      expect(result.needsDarkBackground).toBe(false);
    });

    it('should return cached result on subsequent calls', async () => {
      fs.promises.readdir.mockResolvedValue([
        { name: 'logo.png', isFile: () => true }
      ]);

      const mockMetadata = jest.fn().mockResolvedValue({ format: 'png', hasAlpha: true });
      const mockToBuffer = jest.fn().mockResolvedValue({ data: Buffer.from([128, 128, 128, 255]) });
      sharp.mockReturnValue({ metadata: mockMetadata, raw: () => ({ toBuffer: mockToBuffer }) });

      const dir = '/dir-cache';

      const result1 = await resolveLogo(dir);
      expect(fs.promises.readdir).toHaveBeenCalledTimes(1);

      // Call again with same dir
      const result2 = await resolveLogo(dir);
      expect(fs.promises.readdir).toHaveBeenCalledTimes(1); // Should not be called again

      expect(result1).toEqual(result2);
    });
  });
});
