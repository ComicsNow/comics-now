const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { listPages, getEntryBuffer } = require('../../../server/services/archive-utils');
const { log } = require('../../../server/logger');
const { createId, t0, ms } = require('../../../server/utils');
const { THUMBNAILS_DIRECTORY } = require('../../../server/constants');
const { extractPageBuffer, getComicPages, generateThumbnail } = require('../../../server/services/library-pages');

jest.mock('fs', () => ({
  existsSync: jest.fn()
}));

jest.mock('sharp', () => {
  const sharpInstance = {
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toFile: jest.fn()
  };
  const mockSharp = jest.fn(() => sharpInstance);
  mockSharp.sharpInstance = sharpInstance;
  return mockSharp;
}, { virtual: true });

jest.mock('../../../server/services/archive-utils', () => ({
  listPages: jest.fn(),
  getEntryBuffer: jest.fn()
}));

jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));

jest.mock('../../../server/utils', () => ({
  createId: jest.fn(),
  t0: jest.fn(),
  ms: jest.fn()
}));

jest.mock('../../../server/constants', () => ({
  THUMBNAILS_DIRECTORY: '/mock/thumbnails'
}));

describe('library-pages service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractPageBuffer', () => {
    it('returns buffer on success', async () => {
      const mockBuffer = Buffer.from('test');
      getEntryBuffer.mockResolvedValue(mockBuffer);
      const result = await extractPageBuffer('/path/comic.cbz', 'page1.jpg');
      expect(result).toBe(mockBuffer);
      expect(getEntryBuffer).toHaveBeenCalledWith('/path/comic.cbz', 'page1.jpg');
    });

    it('returns null and logs error on failure', async () => {
      const mockError = new Error('Extraction failed');
      getEntryBuffer.mockRejectedValue(mockError);
      const result = await extractPageBuffer('/path/comic.cbz', 'page1.jpg');
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'LIBRARY', 'Failed to extract page page1.jpg: Extraction failed');
    });
  });

  describe('getComicPages', () => {
    it('returns array of pages on success', async () => {
      const mockPages = ['page1.jpg', 'page2.jpg'];
      listPages.mockResolvedValue(mockPages);
      const result = await getComicPages('/path/comic.cbz');
      expect(result).toBe(mockPages);
      expect(listPages).toHaveBeenCalledWith('/path/comic.cbz');
    });

    it('returns empty array and logs error on failure', async () => {
      const mockError = new Error('Listing failed');
      listPages.mockRejectedValue(mockError);
      const result = await getComicPages('/path/comic.cbz');
      expect(result).toEqual([]);
      expect(log).toHaveBeenCalledWith('ERROR', 'LIBRARY', 'Failed to list pages for comic.cbz: Listing failed');
    });
  });

  describe('generateThumbnail', () => {
    const mockComicPath = '/path/comic.cbz';
    const mockId = 'comic123';

    beforeEach(() => {
      createId.mockReturnValue(mockId);
      t0.mockReturnValue(1000);
      ms.mockReturnValue(500);
    });

    it('returns filename without generating if thumbnail already exists', async () => {
      fs.existsSync.mockReturnValue(true);
      const result = await generateThumbnail(mockComicPath);
      expect(result).toBe(`${mockId}.jpg`);
      expect(fs.existsSync).toHaveBeenCalledWith(path.join('/mock/thumbnails', `${mockId}.jpg`));
      expect(log).toHaveBeenCalledWith('INFO', 'THUMBNAIL', `Skip (exists): ${mockId}.jpg`);
      expect(listPages).not.toHaveBeenCalled();
    });

    it('returns null and logs error if it fails to read pages (catch in getComicPages returning empty array)', async () => {
      fs.existsSync.mockReturnValue(false);
      const mockError = new Error('Read failed');
      listPages.mockRejectedValue(mockError);

      const result = await generateThumbnail(mockComicPath);
      expect(result).toBeNull();
      // getComicPages catches listPages error, logs it as LIBRARY, and returns []
      expect(log).toHaveBeenCalledWith('ERROR', 'LIBRARY', 'Failed to list pages for comic.cbz: Read failed');
      // then generateThumbnail sees pages.length === 0 and logs THUMBNAIL error
      expect(log).toHaveBeenCalledWith('ERROR', 'THUMBNAIL', 'No images found in comic.cbz');
    });

    it('returns null and logs error if no pages are found', async () => {
      fs.existsSync.mockReturnValue(false);
      listPages.mockResolvedValue([]);

      const result = await generateThumbnail(mockComicPath);
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'THUMBNAIL', 'No images found in comic.cbz');
    });

    it('returns null and logs error if first page extraction fails', async () => {
      fs.existsSync.mockReturnValue(false);
      listPages.mockResolvedValue(['page1.jpg']);
      getEntryBuffer.mockRejectedValue(new Error('Extraction failed'));

      const result = await generateThumbnail(mockComicPath);
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'THUMBNAIL', 'Failed to extract first page page1.jpg from comic.cbz');
    });

    it('returns null and logs error if first page extraction returns null', async () => {
      fs.existsSync.mockReturnValue(false);
      listPages.mockResolvedValue(['page1.jpg']);
      getEntryBuffer.mockResolvedValue(null); // extractPageBuffer returns null on error

      const result = await generateThumbnail(mockComicPath);
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'THUMBNAIL', 'Failed to extract first page page1.jpg from comic.cbz');
    });

    it('generates thumbnail successfully', async () => {
      fs.existsSync.mockReturnValue(false);
      listPages.mockResolvedValue(['page1.jpg']);
      const mockBuffer = Buffer.from('image');
      getEntryBuffer.mockResolvedValue(mockBuffer);
      sharp.sharpInstance.toFile.mockResolvedValue();

      const result = await generateThumbnail(mockComicPath);

      expect(result).toBe(`${mockId}.jpg`);
      expect(sharp).toHaveBeenCalledWith(mockBuffer);
      expect(sharp.sharpInstance.resize).toHaveBeenCalledWith({ height: 300, withoutEnlargement: true });
      expect(sharp.sharpInstance.jpeg).toHaveBeenCalledWith({ quality: 80, progressive: true });
      expect(sharp.sharpInstance.toFile).toHaveBeenCalledWith(path.join('/mock/thumbnails', `${mockId}.jpg`));
      expect(log).toHaveBeenCalledWith('INFO', 'THUMBNAIL', `✅ Generated: ${mockId}.jpg in 500 ms`);
    });

    it('returns null and logs error if sharp processing fails', async () => {
      fs.existsSync.mockReturnValue(false);
      listPages.mockResolvedValue(['page1.jpg']);
      const mockBuffer = Buffer.from('image');
      getEntryBuffer.mockResolvedValue(mockBuffer);

      sharp.sharpInstance.toFile.mockRejectedValue(new Error('Sharp processing failed'));

      const result = await generateThumbnail(mockComicPath);

      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'THUMBNAIL', '❌ Sharp fail (comic.cbz): Sharp processing failed after 500 ms');
    });
  });
});
