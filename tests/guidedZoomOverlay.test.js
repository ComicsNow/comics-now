/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Guided View Zoom & Overlay Scaling', () => {
  let sandbox;
  let state;
  let stage;
  let img;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="fullscreen-viewer">
        <img id="fullscreen-image" src="test.jpg" />
      </div>
    `;

    stage = document.getElementById('fullscreen-viewer');
    img = document.getElementById('fullscreen-image');

    Object.defineProperty(stage, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(stage, 'clientHeight', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 1500, configurable: true });

    state = {
      GuidedView: {
        ModeRegistry: {
          getManualOverrideBox: () => null
        }
      }
    };

    sandbox = {
      window: window,
      document: document,
      state: state,
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    function loadFile(relPath) {
      const fullPath = path.resolve(__dirname, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const cleanContent = content
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+let\s+/g, 'let ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/export\s+\{[\s\S]*?\};?/g, '')
        .replace(/export\s+default\s+[\s\S]*?;?/g, '');
      const script = new vm.Script(cleanContent);
      script.runInContext(sandbox);
    }

    loadFile('../public/js/viewer/guided/overlay.js');
  });

  afterEach(() => {
    const overlay = document.getElementById('bubble-magnifier-overlay');
    if (overlay) overlay.remove();
  });

  test('C) Normal speech bubble zooms in at ~3.2x magnification without overflowing', () => {
    // Bubble box: [x, y, w, h]
    // Natural page: 1000x1500. Bubble: 200x100
    // baseScale = min(400/1000, 800/1500) = 0.40
    const targetBox = [100, 100, 200, 100];
    state.GuidedView.applyBubbleOverlay(targetBox, false);

    const overlay = document.getElementById('bubble-magnifier-overlay');
    const innerImg = document.getElementById('bubble-magnifier-img');
    expect(overlay).toBeTruthy();
    expect(innerImg).toBeTruthy();

    const transform = innerImg.style.transform;
    const scaleMatch = transform.match(/scale\(([^)]+)\)/);
    const scale = parseFloat(scaleMatch[1]);

    // Should be at target 3.2x baseScale = 0.40 * 3.2 = 1.28
    expect(scale).toBeCloseTo(1.28, 2);

    const overlayW = parseFloat(overlay.style.width);
    const overlayH = parseFloat(overlay.style.height);

    // Overlay dimensions should comfortably fit the bubble with padding
    expect(overlayW).toBeGreaterThanOrEqual(200 * scale + 30);
    expect(overlayH).toBeGreaterThanOrEqual(100 * scale + 30);
  });

  test('D) Full-width speech bubble does not cut off text or overflow overlay edges', () => {
    // Wide bubble spanning 700px of a 1000px page
    // At 3.2x it would be 700 * 0.4 * 3.2 = 896px wide, which would exceed a 400px screen
    const targetBox = [150, 200, 700, 120];
    state.GuidedView.applyBubbleOverlay(targetBox, false);

    const overlay = document.getElementById('bubble-magnifier-overlay');
    const innerImg = document.getElementById('bubble-magnifier-img');

    const overlayW = parseFloat(overlay.style.width);
    const transform = innerImg.style.transform;
    const scaleMatch = transform.match(/scale\(([^)]+)\)/);
    const scale = parseFloat(scaleMatch[1]);

    // Rendered bubble width = 700 * scale
    const renderedBubbleWidth = 700 * scale;

    // The bubble width must strictly fit inside overlay width with padding (no cut off!)
    expect(renderedBubbleWidth).toBeLessThanOrEqual(overlayW - 36);

    // Still zoomed in compared to baseScale (0.40)
    expect(scale).toBeGreaterThan(0.40);

    // Overlay width should stay within screen bounds
    expect(overlayW).toBeLessThanOrEqual(400);

    // Verify left and right padding inside overlay:
    // cx = 150 + 350 = 500
    // innerTx = (overlayW / 2) - 500 * scale
    // Left edge of bubble in overlay = innerTx + 150 * scale = overlayW / 2 - 350 * scale
    const leftEdge = (overlayW / 2) - (350 * scale);
    expect(leftEdge).toBeGreaterThanOrEqual(18); // Safe padding on left
    const rightEdge = leftEdge + renderedBubbleWidth;
    expect(rightEdge).toBeLessThanOrEqual(overlayW - 18); // Safe padding on right
  });

  test('A) Panel zoom adapts overlay height to avoid giant empty black voids', () => {
    // Normal panel that is relatively short: 400 wide, 250 high
    const targetBox = [50, 100, 400, 250];
    state.GuidedView.applyBubbleOverlay(targetBox, true);

    const overlay = document.getElementById('bubble-magnifier-overlay');
    const overlayH = parseFloat(overlay.style.height);

    // Previous implementation hardcoded overlayH to stageH * 0.85 = 680px!
    // Our implementation adapts overlayH to the rendered panel height + padding:
    expect(overlayH).toBeLessThan(600);
    expect(overlayH).toBeGreaterThanOrEqual(160);
  });

  test('B) Full-width panel is zoomed in by at least 1.35x baseScale', () => {
    // Full-width panel: 950px wide of 1000px page
    // baseScale = 0.40
    const targetBox = [25, 300, 950, 300];
    state.GuidedView.applyBubbleOverlay(targetBox, true);

    const innerImg = document.getElementById('bubble-magnifier-img');
    const transform = innerImg.style.transform;
    const scaleMatch = transform.match(/scale\(([^)]+)\)/);
    const scale = parseFloat(scaleMatch[1]);

    // Full-width panel must be zoomed in at least 1.35x of baseScale (0.40 * 1.35 = 0.54)
    expect(scale).toBeGreaterThanOrEqual(0.40 * 1.35);

    // Overlay height should wrap the panel height without giant black void
    const overlay = document.getElementById('bubble-magnifier-overlay');
    const overlayH = parseFloat(overlay.style.height);
    expect(overlayH).toBeLessThan(500);
  });

  test('B) Sequential applyTransform zooms in on full-width panels', () => {
    // Full-width panel in sequential Manga mode
    const targetBox = [20, 200, 960, 320];
    state.GuidedView.applyTransform(targetBox, true);

    const transform = img.style.transform;
    const scaleMatch = transform.match(/scale\(([^)]+)\)/);
    const scale = parseFloat(scaleMatch[1]);

    // BaseScale = 0.40. Sequential transform must zoom in on full-width panels (>= 0.40 * 1.35)
    expect(scale).toBeGreaterThanOrEqual(0.40 * 1.35);
  });

  test('E) Custom zoom box (25% width x 22% height) zooms in at 3.5x - 4.0x magnification', () => {
    // Natural page: 1000x1500. baseScale = min(400/1000, 800/1500) = 0.40
    // 25% width = 250, 22% height = 330
    const customZoomBox = [375, 585, 250, 330];
    state.GuidedView.applyBubbleOverlay(customZoomBox, true);

    const overlay = document.getElementById('bubble-magnifier-overlay');
    const innerImg = document.getElementById('bubble-magnifier-img');
    expect(overlay).toBeTruthy();
    expect(innerImg).toBeTruthy();

    const transform = innerImg.style.transform;
    const scaleMatch = transform.match(/scale\(([^)]+)\)/);
    const scale = parseFloat(scaleMatch[1]);

    // Magnification relative to baseScale (0.40):
    // fitScaleW = (400 - 12 - 24) / 250 = 364 / 250 = 1.456
    // magnification = 1.456 / 0.40 = 3.64x
    const magnification = scale / 0.40;
    expect(magnification).toBeGreaterThanOrEqual(3.5);
    expect(magnification).toBeLessThanOrEqual(4.0);

    // Overlay expands to fit the screen width
    const overlayW = parseFloat(overlay.style.width);
    expect(overlayW).toBeGreaterThanOrEqual(350);
    expect(overlayW).toBeLessThanOrEqual(400);
  });
});

