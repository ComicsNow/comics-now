const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  extractPageBuffer,
  getComicPages,
  generateThumbnail
} = require('../../../server/services/library-pages');
const archiveUtils = require('../../../server/services/archive-utils');
const logger = require('../../../server/logger');
const utils = require('../../../server/utils');

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}));

jest.mock('sharp', () => {
  const mSharp = {
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue({})
  };
  return jest.fn(() => mSharp);
});

jest.mock('../../../server/services/archive-utils', () => ({
  listPages: jest.fn(),
  getEntryBuffer: jest.fn()
}));

jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));

jest.mock('../../../server/utils', () => ({
  createId: jest.fn((str) => str),
  t0: jest.fn(() => 0),
  ms: jest.fn(() => 100)
}));

jest.mock('../../../server/constants', () => ({
  THUMBNAILS_DIRECTORY: '/mock/thumbnails'
}));

describe('library-pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractPageBuffer', () => {
    it('should return a buffer when getEntryBuffer succeeds', async () => {
      const mockBuffer = Buffer.from('mock-buffer');
      archiveUtils.getEntryBuffer.mockResolvedValueOnce(mockBuffer);

      const result = await extractPageBuffer('/path/to/comic.cbz', 'page1.jpg');

      expect(archiveUtils.getEntryBuffer).toHaveBeenCalledWith('/path/to/comic.cbz', 'page1.jpg');
      expect(result).toBe(mockBuffer);
    });

    it('should log an error and return null when getEntryBuffer fails', async () => {
      const error = new Error('Extract failed');
      archiveUtils.getEntryBuffer.mockRejectedValueOnce(error);

      const result = await extractPageBuffer('/path/to/comic.cbz', 'page1.jpg');

      expect(archiveUtils.getEntryBuffer).toHaveBeenCalledWith('/path/to/comic.cbz', 'page1.jpg');
      expect(logger.log).toHaveBeenCalledWith('ERROR', 'LIBRARY', `Failed to extract page page1.jpg: ${error.message}`);
      expect(result).toBeNull();
    });
  });

  describe('getComicPages', () => {
    it('should return a list of pages when listPages succeeds', async () => {
      const mockPages = ['page1.jpg', 'page2.jpg'];
      archiveUtils.listPages.mockResolvedValueOnce(mockPages);

      const result = await getComicPages('/path/to/comic.cbz');

      expect(archiveUtils.listPages).toHaveBeenCalledWith('/path/to/comic.cbz');
      expect(result).toEqual(mockPages);
    });

    it('should log an error and return an empty array when listPages fails', async () => {
      const error = new Error('List pages failed');
      archiveUtils.listPages.mockRejectedValueOnce(error);

      const result = await getComicPages('/path/to/comic.cbz');

      expect(archiveUtils.listPages).toHaveBeenCalledWith('/path/to/comic.cbz');
      expect(logger.log).toHaveBeenCalledWith('ERROR', 'LIBRARY', `Failed to list pages for comic.cbz: ${error.message}`);
      expect(result).toEqual([]);
    });
  });

  describe('generateThumbnail', () => {
    it('should return the filename if the thumbnail already exists', async () => {
      fs.existsSync.mockReturnValueOnce(true);

      const result = await generateThumbnail('/path/to/comic.cbz');

      expect(fs.existsSync).toHaveBeenCalledWith(path.join('/mock/thumbnails', '/path/to/comic.cbz.jpg'));
      expect(logger.log).toHaveBeenCalledWith('INFO', 'THUMBNAIL', 'Skip (exists): /path/to/comic.cbz.jpg');
      expect(result).toBe('/path/to/comic.cbz.jpg');
    });

    it('should log an error and return null if no pages are found', async () => {
      fs.existsSync.mockReturnValueOnce(false);
      archiveUtils.listPages.mockResolvedValueOnce([]);

      const result = await generateThumbnail('/path/to/comic.cbz');

      expect(logger.log).toHaveBeenCalledWith('ERROR', 'THUMBNAIL', 'No images found in comic.cbz');
      expect(result).toBeNull();
    });

    it('should log an error and return null if extracting the first page fails', async () => {
      fs.existsSync.mockReturnValueOnce(false);
      archiveUtils.listPages.mockResolvedValueOnce(['page1.jpg']);
      archiveUtils.getEntryBuffer.mockResolvedValueOnce(null);

      const result = await generateThumbnail('/path/to/comic.cbz');

      expect(logger.log).toHaveBeenCalledWith('ERROR', 'THUMBNAIL', 'Failed to extract first page page1.jpg from comic.cbz');
      expect(result).toBeNull();
    });

    it('should generate a thumbnail and return the filename on success', async () => {
      fs.existsSync.mockReturnValueOnce(false);
      archiveUtils.listPages.mockResolvedValueOnce(['page1.jpg', 'page2.jpg']);
      archiveUtils.getEntryBuffer.mockResolvedValueOnce(Buffer.from('mock-buffer'));

      const result = await generateThumbnail('/path/to/comic.cbz');

      expect(sharp).toHaveBeenCalledWith(Buffer.from('mock-buffer'));
      const mSharp = sharp();
      expect(mSharp.resize).toHaveBeenCalledWith({ height: 300, withoutEnlargement: true });
      expect(mSharp.jpeg).toHaveBeenCalledWith({ quality: 80, progressive: true });
      expect(mSharp.toFile).toHaveBeenCalledWith(path.join('/mock/thumbnails', '/path/to/comic.cbz.jpg'));
      expect(logger.log).toHaveBeenCalledWith('INFO', 'THUMBNAIL', '✅ Generated: /path/to/comic.cbz.jpg in 100 ms');
      expect(result).toBe('/path/to/comic.cbz.jpg');
    });

    it('should log an error and return null if sharp fails', async () => {
      fs.existsSync.mockReturnValueOnce(false);
      archiveUtils.listPages.mockResolvedValueOnce(['page1.jpg']);
      archiveUtils.getEntryBuffer.mockResolvedValueOnce(Buffer.from('mock-buffer'));

      sharp.mockImplementationOnce(() => {
        return {
          resize: jest.fn().mockReturnThis(),
          jpeg: jest.fn().mockReturnThis(),
          toFile: jest.fn().mockRejectedValue(new Error('Sharp error'))
        };
      });

      const result = await generateThumbnail('/path/to/comic.cbz');

      expect(logger.log).toHaveBeenCalledWith('ERROR', 'THUMBNAIL', '❌ Sharp fail (comic.cbz): Sharp error after 100 ms');
      expect(result).toBeNull();
    });
  });
});
