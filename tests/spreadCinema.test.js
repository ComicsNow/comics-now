/**
 * @jest-environment jsdom
 *
 * Ultra-Wide Spread Cinema & Two-Page Splash Recognition Tests
 */

describe('Ultra-Wide Spread Recognition & Cinema Pan Mechanics', () => {
  // Spread recognition helper (matches the engine in viewer and server)
  function isDoublePageSpread(width, height) {
    if (!width || !height || height <= 0) return false;
    const ratio = width / height;
    return ratio >= 1.25;
  }

  // Physical page parity candidate validator (Komga / Chunky binding model)
  function isValidSpreadPair(leftPageNum, rightPageNum, isManga = false) {
    if (leftPageNum < 1 || rightPageNum < 1) return false;
    if (Math.abs(leftPageNum - rightPageNum) !== 1) return false;

    // In saddle-stitched printing:
    // Page 1 is Front Cover (Right page / Recto).
    // Page 2 is Inside Front Cover (Left page / Verso).
    // Page 3 is Right page (Recto).
    // Consecutive pages across a single physical folded sheet are (Even, Odd)
    const minPage = Math.min(leftPageNum, rightPageNum);
    return minPage % 2 === 0;
  }

  // Cinematic pan trajectory calculator
  function computeCinemaPanTrajectory({ naturalWidth, naturalHeight, viewportWidth, viewportHeight, isManga = false }) {
    if (!naturalWidth || !naturalHeight || viewportHeight <= 0) {
      return { canPan: false, startX: 0, targetX: 0, overflowX: 0 };
    }
    const scaledWidth = (naturalWidth / naturalHeight) * viewportHeight;
    const overflowX = Math.max(0, scaledWidth - viewportWidth);

    if (overflowX < 15) {
      return { canPan: false, startX: 0, targetX: 0, overflowX: 0 };
    }

    const startX = isManga ? -overflowX : 0;
    const targetX = isManga ? 0 : -overflowX;
    return { canPan: true, startX, targetX, overflowX };
  }

  describe('Aspect Ratio Spread Detection', () => {
    test('identifies regular portrait comic pages as single pages', () => {
      // Standard comic scan: 1988 x 3056 (~0.65 ratio)
      expect(isDoublePageSpread(1988, 3056)).toBe(false);
      // Modern digital page: 1200 x 1845 (~0.65 ratio)
      expect(isDoublePageSpread(1200, 1845)).toBe(false);
      // Square image
      expect(isDoublePageSpread(1000, 1000)).toBe(false);
    });

    test('identifies landscape scans as double-page spreads', () => {
      // Standard two-page scan: 3976 x 3056 (~1.30 ratio)
      expect(isDoublePageSpread(3976, 3056)).toBe(true);
      // Ultra-wide double splash: 4200 x 2800 (1.50 ratio)
      expect(isDoublePageSpread(4200, 2800)).toBe(true);
      // Minimum threshold boundary (1.25)
      expect(isDoublePageSpread(1250, 1000)).toBe(true);
      expect(isDoublePageSpread(1240, 1000)).toBe(false);
    });
  });

  describe('Physical Page Parity Logic (Saddle-Stitch Spreads)', () => {
    test('validates physical spreads on (Even, Odd) pairs', () => {
      // Pages 2 and 3 share the same physical paper sheet facing each other
      expect(isValidSpreadPair(2, 3)).toBe(true);
      expect(isValidSpreadPair(4, 5)).toBe(true);
      expect(isValidSpreadPair(6, 7)).toBe(true);
    });

    test('rejects (Odd, Even) pairs that span across the turn of a page', () => {
      // Page 1 is cover, page 2 is behind it
      expect(isValidSpreadPair(1, 2)).toBe(false);
      // Page 3 is right-hand, page 4 is on the next sheet
      expect(isValidSpreadPair(3, 4)).toBe(false);
      expect(isValidSpreadPair(5, 6)).toBe(false);
    });

    test('rejects non-consecutive pages', () => {
      expect(isValidSpreadPair(2, 4)).toBe(false);
      expect(isValidSpreadPair(2, 5)).toBe(false);
    });
  });

  describe('Cinema Pan Trajectory & Direction Calculation', () => {
    test('computes Western pan from Left (0) to Right (-overflowX)', () => {
      // Double page: 3200 x 2000 (ratio 1.6)
      // Mobile screen: 400 x 800 (portrait)
      // Scaled width at 800vh = 1.6 * 800 = 1280px.
      // OverflowX = 1280 - 400 = 880px.
      const trajectory = computeCinemaPanTrajectory({
        naturalWidth: 3200,
        naturalHeight: 2000,
        viewportWidth: 400,
        viewportHeight: 800,
        isManga: false
      });

      expect(trajectory.canPan).toBe(true);
      expect(trajectory.overflowX).toBe(880);
      expect(trajectory.startX).toBe(0);
      expect(trajectory.targetX).toBe(-880);
    });

    test('computes Manga pan from Right (-overflowX) to Left (0)', () => {
      const trajectory = computeCinemaPanTrajectory({
        naturalWidth: 3200,
        naturalHeight: 2000,
        viewportWidth: 400,
        viewportHeight: 800,
        isManga: true
      });

      expect(trajectory.canPan).toBe(true);
      expect(trajectory.overflowX).toBe(880);
      expect(trajectory.startX).toBe(-880);
      expect(trajectory.targetX).toBe(0);
    });

    test('does not pan if spread already fits on a wide landscape screen', () => {
      // Desktop monitor: 2560 x 1440
      // Double page: 2000 x 1400 (scaled width at 1440vh = 2057px <= 2560px)
      const trajectory = computeCinemaPanTrajectory({
        naturalWidth: 2000,
        naturalHeight: 1400,
        viewportWidth: 2560,
        viewportHeight: 1440,
        isManga: false
      });

      expect(trajectory.canPan).toBe(false);
      expect(trajectory.overflowX).toBe(0);
    });
  });
});
