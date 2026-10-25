const fs = require('fs');
const path = require('path');

jest.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: jest.fn().mockResolvedValue({
      run: jest.fn().mockResolvedValue({
        output0: {
          data: new Float32Array(8400 * 6).fill(0.1),
          dims: [1, 8400, 6]
        }
      })
    })
  },
  Tensor: jest.fn()
}), { virtual: true });

jest.mock('sharp', () => {
  const sharpMock = jest.fn(() => {
    const mockImage = {
      removeAlpha: jest.fn().mockReturnThis(),
      grayscale: jest.fn().mockReturnThis(),
      extract: jest.fn().mockReturnThis(),
      raw: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue({ data: Buffer.alloc(640 * 640 * 3), info: { width: 640, height: 640, channels: 3 } }),
      metadata: jest.fn().mockResolvedValue({ width: 800, height: 1200 }),
      resize: jest.fn().mockReturnThis()
    };
    return mockImage;
  });
  return sharpMock;
}, { virtual: true });

// Mock fs globally for existsSync
jest.mock('fs', () => {
  const original = jest.requireActual('fs');
  return {
    ...original,
    existsSync: jest.fn().mockReturnValue(true),
    promises: {
      ...original.promises,
      mkdir: jest.fn().mockResolvedValue(),
      writeFile: jest.fn().mockResolvedValue()
    }
  };
});

// Since the module is loaded and it has module-level objects,
const { processComic, GUIDED_VIEW_DIR } = require('../../../server/services/panel-detector');
const archiveUtils = require('../../../server/services/archive-utils');

jest.mock('../../../server/services/archive-utils', () => ({
  listPages: jest.fn(),
  getEntryBuffer: jest.fn().mockResolvedValue(Buffer.from('fake image data')),
  extractPageBuffer: jest.fn().mockResolvedValue(Buffer.from('fake image data'))
}));

// Mock logger
jest.mock('../../../server/logger', () => ({
  guidedLog: jest.fn(),
  guidedLogUpdate: jest.fn(),
  log: jest.fn()
}));

describe('panel-detector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processComic', () => {
    it('throws error if no pages are found', async () => {
      archiveUtils.listPages.mockResolvedValue([]);
      await expect(processComic('test1', '/path.cbz', 'western')).rejects.toThrow('No pages found');
    });

    it('processes comic correctly', async () => {
      archiveUtils.listPages.mockResolvedValue(['01.jpg', '02.jpg']);
      archiveUtils.getEntryBuffer.mockResolvedValue(Buffer.from('fake image data'));
      const result = await processComic('test1', '/path.cbz', 'western');

      expect(result.pagesProcessed).toBe(2);
      expect(result.pageCount).toBe(2);
      expect(fs.promises.writeFile).toHaveBeenCalled();
      const calls = fs.promises.writeFile.mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toContain('test1.json');
    });

    it('processes comic manga type correctly', async () => {
      archiveUtils.listPages.mockResolvedValue(['01.jpg', '02.jpg']);
      archiveUtils.getEntryBuffer.mockResolvedValue(Buffer.from('fake image data'));
      const result = await processComic('test1', '/path.cbz', 'manga');

      expect(result.pagesProcessed).toBe(2);
      expect(result.pageCount).toBe(2);
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('respects cancellation', async () => {
      archiveUtils.listPages.mockResolvedValue(['01.jpg', '02.jpg']);
      archiveUtils.getEntryBuffer.mockResolvedValue(Buffer.from('fake image data'));
      await expect(processComic('test1', '/path.cbz', 'western', {
        isCancelled: () => true
      })).rejects.toThrow('Cancelled');
    });

    it('handles maxPages correctly', async () => {
      archiveUtils.listPages.mockResolvedValue(['01.jpg', '02.jpg', '03.jpg']);
      archiveUtils.getEntryBuffer.mockResolvedValue(Buffer.from('fake image data'));
      const result = await processComic('test1', '/path.cbz', 'western', {
        maxPages: 1
      });
      expect(result.pageCount).toBe(1);
      expect(result.pagesProcessed).toBe(1);
    });

    it('handles errors on page processing', async () => {
      archiveUtils.listPages.mockResolvedValue(['01.jpg']);
      archiveUtils.getEntryBuffer.mockRejectedValueOnce(new Error('Extraction failed'));

      const result = await processComic('test1', '/path.cbz', 'western');

      expect(result.pagesProcessed).toBe(0); // If it fails, it does not increment pagesProcessed
      expect(result.pageCount).toBe(1);
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });
  });
});
