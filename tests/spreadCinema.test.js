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

describe('Fullscreen auto-pan — real module behavior in jsdom', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  const MODULE_PATH = path.resolve(__dirname, '../public/js/viewer/fullscreen.js');
  const WIDE = { w: 6000, h: 2000 }; // ratio 3.0 on a 1200x900 viewer
  const OVERFLOW_X = 1500; // (6000/2000)*900 - 1200

  // Loads the real fullscreen.js in a vm sandbox wired to the jsdom document,
  // the way the browser loads it (globals.js singletons become window props).
  function boot(state = {}) {
    document.body.innerHTML = `
      <div id="fullscreen-viewer"></div>
      <img id="fullscreen-image">
      <div id="fullscreen-progress-indicator"></div>
      <div id="fullscreen-page-counter"></div>
      <button id="fullscreen-spread-badge" class="hidden">
        <span id="fullscreen-spread-badge-text">Cinema Pan Spread</span>
      </button>
    `;
    const viewer = document.getElementById('fullscreen-viewer');
    const image = document.getElementById('fullscreen-image');
    Object.defineProperty(viewer, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(viewer, 'clientHeight', { value: 900, configurable: true });

    const sandbox = { window, document, state, console, setTimeout, clearTimeout };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const source = fs
      .readFileSync(MODULE_PATH, 'utf8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    new vm.Script(source).runInContext(sandbox);

    window.fullscreenViewer = viewer;
    window.fullscreenImage = image;
    window.fullscreenProgressIndicator = document.getElementById('fullscreen-progress-indicator');
    window.fullscreenPageCounter = document.getElementById('fullscreen-page-counter');

    return {
      viewer,
      image,
      badge: document.getElementById('fullscreen-spread-badge'),
      badgeText: document.getElementById('fullscreen-spread-badge-text')
    };
  }

  function setDims(image, w, h) {
    Object.defineProperty(image, 'naturalWidth', { value: w, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: h, configurable: true });
    Object.defineProperty(image, 'complete', { value: true, configurable: true });
  }

  // Mimics the real display flow: the image element gets a page src; the pan
  // decision is per displayed image, so distinct pages need distinct srcs.
  function showPage(env, name, w, h) {
    env.image.src = `https://test.invalid/${name}.jpg`;
    if (w) setDims(env.image, w, h);
  }

  const panning = (image) => image.classList.contains('cinema-img');

  // The real viewer swaps images in two phases: the page status is announced
  // first (image still the previous page), then the src swaps and the load
  // event drives the display. The auto-pan must fire on the loaded image.
  function displayViaRealFlow(env, pageNumber, name, w, h) {
    window.updateFullscreenPageStatus(pageNumber, 10); // phase 1: status first
    Object.defineProperty(env.image, 'naturalWidth', { value: 0, configurable: true });
    Object.defineProperty(env.image, 'naturalHeight', { value: 0, configurable: true });
    Object.defineProperty(env.image, 'complete', { value: false, configurable: true });
    showPage(env, name); // phase 2: src swaps, image now loading
    window.updateFullscreenPageStatus(pageNumber, 10); // burst: counter re-report
    window.updateFullscreenPageStatus(pageNumber, 10);
    setDims(env.image, w, h);
    env.image.onload(); // phase 3: load event
  }

  test('auto-pans a wide spread page the moment fullscreen displays it', () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);

    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(true);
    expect(env.viewer.classList.contains('cinema-stage')).toBe(true);
    expect(env.image.style.transform).toBe('translate3d(0px, 0, 0)');
    expect(env.badge.classList.contains('hidden')).toBe(true);
  });

  test('auto-pans manga spreads right-to-left', () => {
    const env = boot({ currentComic: { mangaMode: true } });
    showPage(env, 'page-3', WIDE.w, WIDE.h);

    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(true);
    expect(env.image.style.transform).toBe(`translate3d(-${OVERFLOW_X}px, 0, 0)`);
  });

  test('does not pan portrait pages', () => {
    const env = boot();
    showPage(env, 'page-2', 1988, 3056);

    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(false);
    expect(env.image.style.transform).toBe('');
  });

  test('does not auto-pan a spread that already fits the screen', () => {
    const env = boot();
    showPage(env, 'page-3', 1300, 1000); // scaled width ~1170px < 1200px viewer

    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(false);
    expect(env.image.style.transform).toBe('');
  });

  test('waits for the image to load, then auto-pans', () => {
    const env = boot();
    Object.defineProperty(env.image, 'naturalWidth', { value: 0, configurable: true });
    Object.defineProperty(env.image, 'naturalHeight', { value: 0, configurable: true });
    Object.defineProperty(env.image, 'complete', { value: false, configurable: true });
    showPage(env, 'page-3');

    window.updateFullscreenPageStatus(3, 10);
    expect(panning(env.image)).toBe(false);

    setDims(env.image, WIDE.w, WIDE.h);
    env.image.onload(); // the display path wires onload for the badge/auto-pan check

    expect(panning(env.image)).toBe(true);
    expect(env.image.style.transform).toBe('translate3d(0px, 0, 0)');
  });

  test('a page change stops the running pan and auto-pans the next spread', () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);
    window.updateFullscreenPageStatus(3, 10);
    expect(panning(env.image)).toBe(true);

    showPage(env, 'page-4', WIDE.w, WIDE.h); // next page, same spread dims
    window.updateFullscreenPageStatus(4, 10);

    expect(panning(env.image)).toBe(true);
    expect(env.image.style.transform).toBe('translate3d(0px, 0, 0)');
  });

  test('auto-pans when the real viewer swaps the image after announcing the page', () => {
    const env = boot();
    showPage(env, 'page-1', 1988, 3056); // current display: portrait
    window.updateFullscreenPageStatus(1, 10);
    expect(panning(env.image)).toBe(false);

    displayViaRealFlow(env, 3, 'page-3', WIDE.w, WIDE.h);

    expect(panning(env.image)).toBe(true);
    expect(env.image.style.transform).toBe('translate3d(0px, 0, 0)');
  });

  test('stopping the pan does not immediately restart it (no loop)', async () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);
    window.updateFullscreenPageStatus(3, 10);
    expect(panning(env.image)).toBe(true);

    window.stopCinemaPan();
    expect(panning(env.image)).toBe(false);
    expect(env.image.style.transform).toBe('');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(panning(env.image)).toBe(false);
    expect(env.image.style.transform).toBe('');
    expect(env.badgeText.textContent).toBe('Cinema Pan Spread');
  });

  test('does not auto-pan while the fullscreen viewer is closed', () => {
    const env = boot();
    env.viewer.classList.add('hidden');
    showPage(env, 'page-3', WIDE.w, WIDE.h);

    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(false);
  });

  test('the manual badge toggle still starts and stops the pan', () => {
    const env = boot();
    setDims(env.image, WIDE.w, WIDE.h);
    window.checkSpreadCinemaStatus();
    expect(env.badge.classList.contains('hidden')).toBe(false);

    window.toggleCinemaPan();
    expect(panning(env.image)).toBe(true);

    window.toggleCinemaPan();
    expect(panning(env.image)).toBe(false);
  });

  test('a re-render of the same page does not reset the running pan', () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);
    window.updateFullscreenPageStatus(3, 10);
    expect(panning(env.image)).toBe(true);

    env.image.style.transform = 'translate3d(-100px, 0, 0)'; // mid-pan position
    window.updateFullscreenPageStatus(3, 10); // same page, re-render burst

    expect(panning(env.image)).toBe(true);
    expect(env.image.style.transform).toBe('translate3d(-100px, 0, 0)');
    expect(env.badge.classList.contains('hidden')).toBe(true);
  });

  test('a same-page status update does not restart a manually stopped pan', () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);
    window.updateFullscreenPageStatus(3, 10);
    window.stopCinemaPan();
    expect(panning(env.image)).toBe(false);

    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(false);
    expect(env.image.style.transform).toBe('');
  });

  test('the badge stays hidden while a pan is running', () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);
    window.updateFullscreenPageStatus(3, 10);
    expect(panning(env.image)).toBe(true);

    window.checkSpreadCinemaStatus();

    expect(env.badge.classList.contains('hidden')).toBe(true);
  });

  test('closing and reopening fullscreen on the same page auto-pans again', async () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);
    window.updateFullscreenPageStatus(3, 10);
    expect(panning(env.image)).toBe(true);

    await window.closeFullscreen();
    expect(panning(env.image)).toBe(false);

    env.viewer.classList.remove('hidden');
    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(true);
  });

  test('navigating away and back re-arms the auto-pan for the spread', () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);
    window.updateFullscreenPageStatus(3, 10);
    expect(panning(env.image)).toBe(true);

    window.stopCinemaPan();
    showPage(env, 'page-2', 1988, 3056); // portrait page in between
    window.updateFullscreenPageStatus(2, 10);
    expect(panning(env.image)).toBe(false);

    showPage(env, 'page-3', WIDE.w, WIDE.h); // back to the spread
    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(true);
  });

  test('a page change while the viewer is closed does not consume the auto-pan', () => {
    const env = boot();
    showPage(env, 'page-3', WIDE.w, WIDE.h);
    env.viewer.classList.add('hidden');

    window.updateFullscreenPageStatus(3, 10); // status update while closed
    expect(panning(env.image)).toBe(false);

    env.viewer.classList.remove('hidden');
    window.updateFullscreenPageStatus(3, 10);

    expect(panning(env.image)).toBe(true);
  });
});
