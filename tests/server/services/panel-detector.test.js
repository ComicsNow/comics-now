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
const {
  processComic,
  detectPanels,
  detectBubbles,
  sortReadingOrder,
  buildHybridWesternSequence,
  GUIDED_VIEW_DIR
} = require('../../../server/services/panel-detector');
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

  describe('detectBubbles using manga model', () => {
    it('returns empty array when no bubbles match threshold', async () => {
      const result = await detectBubbles(Buffer.from('fake image'), 'western');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array for filterCls 1 when no boxes pass threshold', async () => {
      const result = await detectPanels(Buffer.from('fake image'), 'western', 0.99, 1);
      expect(result).toEqual([]);
    });
  });

  describe('sortReadingOrder (Recursive XY-Cut)', () => {
    it('returns empty or single-element arrays unchanged', () => {
      expect(sortReadingOrder([], 'western')).toEqual([]);
      expect(sortReadingOrder([[10, 20, 100, 100]], 'western')).toEqual([[10, 20, 100, 100]]);
    });

    it('sorts standard Western 3-tier multi-column layout where two stacked left panels sit beside one tall right panel', () => {
      const L1 = [20, 20, 360, 260];
      const L2 = [20, 300, 360, 280];
      const R  = [400, 20, 380, 560];

      expect(sortReadingOrder([R, L2, L1], 'western')).toEqual([L1, L2, R]);
    });

    it('sorts standard Manga 2-column layout where two stacked right panels sit beside one tall left panel (RTL)', () => {
      const R1 = [420, 20, 360, 260];
      const R2 = [420, 300, 360, 280];
      const L  = [20, 20, 380, 560];

      expect(sortReadingOrder([L, R2, R1], 'manga')).toEqual([R1, R2, L]);
    });

    it('sorts complex 3-tier sandwich layout (Top Banner -> Multi-Column Middle -> Bottom Banner)', () => {
      const topBanner    = [20, 20, 760, 180];
      const midLeftTop   = [20, 220, 360, 200];
      const midLeftBot   = [20, 440, 360, 200];
      const midRightTall = [400, 220, 380, 420];
      const botBanner    = [20, 660, 760, 180];

      const input = [botBanner, midRightTall, midLeftBot, topBanner, midLeftTop];
      expect(sortReadingOrder(input, 'western')).toEqual([
        topBanner,
        midLeftTop,
        midLeftBot,
        midRightTall,
        botBanner
      ]);
      expect(sortReadingOrder(input, 'manga')).toEqual([
        topBanner,
        midRightTall,
        midLeftTop,
        midLeftBot,
        botBanner
      ]);
    });

    it('handles slight bounding-box overlap across gutters via overlap tolerance', () => {
      const L1 = [20, 20, 378, 260];
      const L2 = [20, 300, 370, 280];
      const R  = [390, 20, 390, 560];

      expect(sortReadingOrder([R, L2, L1], 'western')).toEqual([L1, L2, R]);
    });
  });

  describe('buildHybridWesternSequence (gutter caption tolerance)', () => {
    it('correctly associates a top gutter caption box to the incoming panel and sorts it before interior bubbles', () => {
      const panel1 = [50, 100, 800, 400];
      const panel2 = [50, 550, 800, 400];

      const b1 = [100, 150, 200, 80];
      const gutterCaption = [500, 520, 250, 60];
      const b2 = [200, 700, 200, 80];

      const seq = buildHybridWesternSequence([panel1, panel2], [b1, b2, gutterCaption]);
      expect(seq).toEqual([b1, gutterCaption, b2]);
    });
  });
});
