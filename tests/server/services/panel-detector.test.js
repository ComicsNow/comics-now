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
  GUIDED_VIEW_DIR,
  sortReadingOrder,
  buildMangaSequence,
  buildHybridWesternSequence,
  extractPolygonFromProtoMask
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

  describe('sortReadingOrder (Recursive XY-Cut)', () => {
    it('returns empty or single-element arrays unchanged', () => {
      expect(sortReadingOrder([], 'western')).toEqual([]);
      expect(sortReadingOrder(null, 'western')).toBeNull();
      const single = [[10, 20, 100, 200]];
      expect(sortReadingOrder(single, 'western')).toEqual(single);
    });

    it('sorts a standard 2x2 grid row-by-row (LTR for western, RTL for manga)', () => {
      const tl = [20, 20, 360, 260];
      const tr = [420, 25, 360, 260];
      const bl = [20, 320, 360, 260];
      const br = [420, 315, 360, 260];

      const scrambled = [br, tl, bl, tr];
      expect(sortReadingOrder(scrambled, 'western')).toEqual([tl, tr, bl, br]);
      expect(sortReadingOrder(scrambled, 'manga')).toEqual([tr, tl, br, bl]);
    });

    it('sorts Western multi-column layout where two stacked left panels sit beside one tall right panel', () => {
      // Classic 1D failure case: y*5 + x scores R (500) before L2 (1520), jumping L1 -> R -> L2
      const L1 = [20, 20, 360, 260];   // y: 20..280
      const L2 = [20, 300, 360, 280];  // y: 300..580
      const R  = [400, 20, 380, 560];  // y: 20..580 (spans both L1 and L2)

      expect(sortReadingOrder([R, L2, L1], 'western')).toEqual([L1, L2, R]);
    });

    it('sorts Western multi-column layout where one tall left panel sits beside two stacked right panels despite vertical jitter', () => {
      // L starts lower (y=120) than R1 (y=10) due to inset header/box variance,
      // which caused 1D y*5+x to sort R1 before L (10*5+400=450 < 120*5+20=620).
      const L  = [20, 120, 360, 460];  // x: 20..380, y: 120..580
      const R1 = [400, 10, 380, 260];  // x: 400..780, y: 10..270
      const R2 = [400, 300, 380, 280]; // x: 400..780, y: 300..580

      expect(sortReadingOrder([R2, R1, L], 'western')).toEqual([L, R1, R2]);
    });

    it('sorts Manga multi-column layout where two stacked right panels sit beside one tall left panel (RTL)', () => {
      // Classic 1D Manga failure case: y*1.5 - (x+w) scored L (-370) before R2 (-330), jumping R1 -> L -> R2
      const R1 = [420, 20, 360, 260];  // x: 420..780, y: 20..280
      const R2 = [420, 300, 360, 280]; // x: 420..780, y: 300..580
      const L  = [20, 20, 380, 560];   // x: 20..400,  y: 20..580

      expect(sortReadingOrder([L, R2, R1], 'manga')).toEqual([R1, R2, L]);
    });

    it('sorts complex 3-tier sandwich layout (Top Banner -> Multi-Column Middle -> Bottom Banner)', () => {
      const topBanner    = [20, 20, 760, 180];  // y: 20..200
      const midLeftTop   = [20, 220, 360, 200]; // x: 20..380, y: 220..420
      const midLeftBot   = [20, 440, 360, 200]; // x: 20..380, y: 440..640
      const midRightTall = [400, 220, 380, 420];// x: 400..780, y: 220..640
      const botBanner    = [20, 660, 760, 180]; // y: 660..840

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
      // L1 overlaps R horizontally by 8px (x2=398 vs x1=390) due to YOLO box padding
      const L1 = [20, 20, 378, 260];   // x: 20..398, y: 20..280
      const L2 = [20, 300, 370, 280];  // x: 20..390, y: 300..580
      const R  = [390, 20, 390, 560];  // x: 390..780, y: 20..580

      expect(sortReadingOrder([R, L2, L1], 'western')).toEqual([L1, L2, R]);
    });

    it('correctly sequences bubbles and orphan bubbles in buildHybridWesternSequence and buildMangaSequence', () => {
      const L1 = [20, 20, 360, 260];
      const L2 = [20, 300, 360, 280];
      const R  = [400, 20, 380, 560];

      const bL1 = [50, 50, 100, 60];
      const bL2 = [50, 340, 100, 60];
      const bR  = [450, 60, 100, 60];

      const westernSeq = buildHybridWesternSequence([R, L2, L1], [bR, bL2, bL1]);
      expect(westernSeq).toEqual([bL1, bR, bL2]);

      const R1_m = [420, 20, 360, 260];
      const R2_m = [420, 300, 360, 280];
      const L_m  = [20, 20, 380, 560];
      const bR1_m = [500, 50, 100, 60];
      const bR2_m = [500, 340, 100, 60];
      const bL_m  = [80, 60, 100, 60];

      const mangaSeq = buildMangaSequence([L_m, R2_m, R1_m], [bL_m, bR2_m, bR1_m]);
      expect(mangaSeq).toEqual([bR1_m, R1_m, bR2_m, R2_m, bL_m, L_m]);
    });

    it('sorts overlapping diagonal/triangular panels using their polygon centroids', () => {
      // Two right-triangle panels sharing the exact same [0, 0, 800, 600] bounding box:
      // Bottom-Right triangle (centroid ~ 533, 400) vs Top-Left triangle (centroid ~ 266, 200)
      const topLeftTriangle = [0, 0, 800, 600];
      topLeftTriangle.polygon = [[0, 0], [800, 0], [0, 600]];

      const bottomRightTriangle = [0, 0, 800, 600];
      bottomRightTriangle.polygon = [[800, 0], [800, 600], [0, 600]];

      const sortedWestern = sortReadingOrder([bottomRightTriangle, topLeftTriangle], 'western');
      expect(sortedWestern[0]).toBe(topLeftTriangle);
      expect(sortedWestern[1]).toBe(bottomRightTriangle);
    });

    it('extracts a simplified polygon contour from a YOLO11-seg prototype mask', () => {
      // 32 proto channels x 160 x 160
      const protoW = 160, protoH = 160, numProtos = 32;
      const protoData = new Float32Array(numProtos * protoH * protoW).fill(-5.0);
      // Activate channel 0 as a triangle inside x: 20..100, y: 20..100 (in 160x160 proto space)
      for (let y = 20; y <= 100; y++) {
        const maxX = 20 + Math.floor((y - 20)); // right-triangle y >= x
        for (let x = 20; x <= maxX; x++) {
          protoData[y * protoW + x] = 5.0;
        }
      }
      const coeffs = new Float32Array(numProtos).fill(0);
      coeffs[0] = 1.0;

      // Page is 640x640 (scaleX=1, scaleY=1, padX=0, padY=0), box is [80, 80, 320, 320]
      const poly = extractPolygonFromProtoMask(
        coeffs,
        protoData,
        [1, numProtos, protoH, protoW],
        { x: 80, y: 80, w: 320, h: 320 },
        { scaleX: 1, scaleY: 1, padX: 0, padY: 0, width: 640, height: 640 }
      );

      expect(Array.isArray(poly)).toBe(true);
      expect(poly.length).toBeGreaterThanOrEqual(3);
      for (const pt of poly) {
        expect(pt.length).toBe(2);
        expect(pt[0]).toBeGreaterThanOrEqual(75);
        expect(pt[0]).toBeLessThanOrEqual(410);
        expect(pt[1]).toBeGreaterThanOrEqual(75);
        expect(pt[1]).toBeLessThanOrEqual(410);
      }
    });
  });
});
