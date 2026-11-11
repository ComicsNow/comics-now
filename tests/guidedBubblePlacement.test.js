/**
 * @jest-environment jsdom
 *
 * TDD Suite for Smart Panel-Aware Speech Bubble Zoom Placement
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createPlacementSandbox() {
  const state = {
    currentView: 'root',
    currentRootFolder: null,
    activeSmartFilter: null,
    comicIdMap: new Map(),
    mangaModePreference: false,
    fullscreenPage: 0,
    GuidedView: {}
  };

  const sandbox = {
    window: window,
    document: document,
    state: state,
    console: console,
    fetch: jest.fn(),
    performance: performance,
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Date: Date,
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

  loadFile('../public/js/viewer/guided/geometry.js');
  loadFile('../public/js/viewer/guided/data.js');
  loadFile('../public/js/viewer/guided/bubble-placement.js');
  loadFile('../public/js/viewer/guided/mode-registry.js');
  loadFile('../public/js/viewer/guided/overlay.js');

  return { sandbox, loadFile, state };
}

describe('Smart Panel-Aware Speech Bubble Zoom Placement', () => {
  describe('findParentPanel', () => {
    test('identifies containing panel when bubble is fully inside', () => {
      const { sandbox } = createPlacementSandbox();
      const findParentPanel = sandbox.state.GuidedView.findParentPanel;
      const panels = [
        [50, 50, 400, 300],
        [50, 400, 400, 300]
      ];
      const bubble = [100, 100, 150, 60];

      const parent = findParentPanel(panels, bubble);
      expect(parent).toEqual([50, 50, 400, 300]);
    });

    test('returns null for orphan bubble in gutter/outside panels', () => {
      const { sandbox } = createPlacementSandbox();
      const findParentPanel = sandbox.state.GuidedView.findParentPanel;
      const panels = [
        [50, 50, 400, 300],
        [50, 400, 400, 300]
      ];
      const orphanBubble = [500, 800, 100, 50];

      const parent = findParentPanel(panels, orphanBubble);
      expect(parent).toBeNull();
    });

    test('picks panel with largest overlap when bubble crosses boundary', () => {
      const { sandbox } = createPlacementSandbox();
      const findParentPanel = sandbox.state.GuidedView.findParentPanel;
      const panels = [
        [50, 50, 400, 300],
        [50, 350, 400, 300]
      ];
      // Bubble mostly in panel 0 (y=280 to 360: 70px in panel 0, 10px in gutter/panel 1)
      const bubble = [100, 280, 150, 80];

      const parent = findParentPanel(panels, bubble);
      expect(parent).toEqual([50, 50, 400, 300]);
    });
  });

  describe('getPagePanels', () => {
    test('Western: extracts true panels even when sequence is set to bubbles', () => {
      const { sandbox } = createPlacementSandbox();
      const getPagePanels = sandbox.state.GuidedView.getPagePanels;
      const truePanels = [[50, 50, 400, 300], [50, 400, 400, 300]];
      const bubbles = [[100, 100, 120, 50]];
      const pageData = {
        panels: truePanels,
        bubbles: bubbles,
        sequence: bubbles // sequence matches bubbles in ~65% of Western sidecars
      };

      const result = getPagePanels(pageData, false);
      expect(result).toEqual(truePanels);
    });

    test('Manga: uses classified panels from mixed raw boxes', () => {
      const { sandbox } = createPlacementSandbox();
      const getPagePanels = sandbox.state.GuidedView.getPagePanels;
      const rawBoxes = [
        [50, 50, 400, 300],
        [100, 100, 120, 50] // child bubble inside panel
      ];
      const pageData = {
        panels: rawBoxes,
        bubbles: []
      };

      const result = getPagePanels(pageData, true);
      expect(result.length).toBe(1);
      expect(result[0]).toEqual([50, 50, 400, 300]);
    });
  });

  describe('computeSmartBubblePlacement: collision avoidance', () => {
    const stageW = 1000;
    const stageH = 1500;
    const overlayW = 400;
    const overlayH = 200;
    const imgLayout = {
      naturalWidth: 1000,
      naturalHeight: 1500,
      scale: 1,
      imgLeft: 0,
      imgTop: 0
    };

    test('places overlay cleanly BELOW when parent panel is at top of screen', () => {
      const { sandbox } = createPlacementSandbox();
      const compute = sandbox.state.GuidedView.computeSmartBubblePlacement;

      const panel = [50, 50, 900, 350]; // top panel ending at y=400
      const bubble = [100, 100, 200, 80];

      const placement = compute({
        bubble,
        parentPanel: panel,
        stageW,
        stageH,
        overlayW,
        overlayH,
        imgLayout
      });

      // Overlay should be placed below the panel (targetY >= 400)
      expect(placement.targetY).toBeGreaterThanOrEqual(400);
      // Does not overlap parent panel vertically
      expect(placement.targetY).toBeGreaterThanOrEqual(panel[1] + panel[3]);
    });

    test('places overlay cleanly ABOVE when parent panel is at bottom of screen', () => {
      const { sandbox } = createPlacementSandbox();
      const compute = sandbox.state.GuidedView.computeSmartBubblePlacement;

      const panel = [50, 900, 900, 450]; // bottom panel starting at y=900
      const bubble = [100, 950, 200, 80];

      const placement = compute({
        bubble,
        parentPanel: panel,
        stageW,
        stageH,
        overlayW,
        overlayH,
        imgLayout
      });

      // Overlay should be placed above the panel (targetY + overlayH <= 900)
      expect(placement.targetY + overlayH).toBeLessThanOrEqual(panel[1]);
      expect(placement.targetY).toBeGreaterThanOrEqual(50); // respects top margin
    });

    test('places overlay to the SIDE when panel is tall vertical column (side escape)', () => {
      const { sandbox } = createPlacementSandbox();
      const compute = sandbox.state.GuidedView.computeSmartBubblePlacement;

      // Tall vertical panel occupying left half: x=50..450, y=100..1300
      const panel = [50, 100, 400, 1200];
      const bubble = [100, 600, 200, 80];

      const placement = compute({
        bubble,
        parentPanel: panel,
        stageW,
        stageH,
        overlayW,
        overlayH,
        imgLayout
      });

      // Vertical space above/below is constrained, so overlay escapes to the RIGHT
      expect(placement.targetX).toBeGreaterThanOrEqual(panel[0] + panel[2]);
    });

    test('never covers the clicked speech bubble', () => {
      const { sandbox } = createPlacementSandbox();
      const compute = sandbox.state.GuidedView.computeSmartBubblePlacement;

      const panel = [50, 50, 900, 800]; // large panel
      const bubble = [100, 150, 250, 100]; // bubble near top-left

      const placement = compute({
        bubble,
        parentPanel: panel,
        stageW,
        stageH,
        overlayW,
        overlayH,
        imgLayout
      });

      const overlayBox = [placement.targetX, placement.targetY, overlayW, overlayH];
      const bubbleBox = [bubble[0], bubble[1], bubble[2], bubble[3]];

      // Check intersection
      const ix = Math.max(0, Math.min(overlayBox[0] + overlayBox[2], bubbleBox[0] + bubbleBox[2]) - Math.max(overlayBox[0], bubbleBox[0]));
      const iy = Math.max(0, Math.min(overlayBox[1] + overlayBox[3], bubbleBox[1] + bubbleBox[3]) - Math.max(overlayBox[1], bubbleBox[1]));
      expect(ix * iy).toBe(0); // 0 overlap with the clicked bubble!
    });

    test('opposite corner fallback for giant full-page splash panel', () => {
      const { sandbox } = createPlacementSandbox();
      const compute = sandbox.state.GuidedView.computeSmartBubblePlacement;

      const panel = [0, 0, 1000, 1500]; // splash page
      const bubble = [80, 80, 200, 80]; // top-left bubble

      const placement = compute({
        bubble,
        parentPanel: panel,
        stageW,
        stageH,
        overlayW,
        overlayH,
        imgLayout
      });

      // For top-left bubble, placement should be in lower half and right side
      expect(placement.targetY).toBeGreaterThanOrEqual(stageH / 2);
      expect(placement.targetX).toBeGreaterThanOrEqual(stageW / 2 - 100);
    });

    test('orphan bubble falls back to bubble-relative position within safe margins', () => {
      const { sandbox } = createPlacementSandbox();
      const compute = sandbox.state.GuidedView.computeSmartBubblePlacement;

      const bubbleInTopHalf = [100, 200, 200, 80];
      const placement = compute({
        bubble: bubbleInTopHalf,
        parentPanel: null,
        stageW,
        stageH,
        overlayW,
        overlayH,
        imgLayout
      });

      // Top-half bubble -> placed in bottom half
      expect(placement.targetY).toBeGreaterThanOrEqual(stageH / 2);
      expect(placement.targetX).toBeGreaterThanOrEqual(12);
    });

    test('preserves placement stability across consecutive bubbles in the same panel', () => {
      const { sandbox } = createPlacementSandbox();
      const compute = sandbox.state.GuidedView.computeSmartBubblePlacement;

      const panel = [50, 50, 900, 350];
      const bubble1 = [100, 100, 200, 80];
      const bubble2 = [400, 120, 200, 80];

      const firstPlacement = compute({
        bubble: bubble1,
        parentPanel: panel,
        stageW,
        stageH,
        overlayW,
        overlayH,
        imgLayout
      });

      const secondPlacement = compute({
        bubble: bubble2,
        parentPanel: panel,
        stageW,
        stageH,
        overlayW,
        overlayH,
        imgLayout,
        lastPlacement: firstPlacement
      });

      // Consecutive bubbles in the same panel keep the same targetY
      expect(secondPlacement.targetY).toBe(firstPlacement.targetY);
      expect(secondPlacement.targetX).toBe(firstPlacement.targetX);
    });
  });

  describe('Integration with applyBubbleOverlay', () => {
    test('Speech bubble zoom uses smart placement avoiding parent panel', () => {
      const env = createPlacementSandbox();

      env.sandbox.document.body.innerHTML = `
        <div id="fullscreen-viewer" style="width: 1000px; height: 1500px;">
          <img id="fullscreen-image" src="test.jpg" />
        </div>
      `;
      const stage = env.sandbox.document.getElementById('fullscreen-viewer');
      Object.defineProperty(stage, 'clientWidth', { value: 1000, configurable: true });
      Object.defineProperty(stage, 'clientHeight', { value: 1500, configurable: true });

      const img = env.sandbox.document.getElementById('fullscreen-image');
      Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 1500, configurable: true });
      Object.defineProperty(img, 'clientWidth', { value: 1000, configurable: true });
      Object.defineProperty(img, 'clientHeight', { value: 1500, configurable: true });

      env.state.currentComic = { id: 'comic-1', mangaMode: false, guidedViewStatus: 'completed' };
      env.state.getViewerPages = () => ['page_1.jpg'];
      env.state.currentPageIndex = 0;
      env.state.GuidedView.cache.set('comic-1', {
        pages: {
          'page_1.jpg': {
            panels: [[50, 50, 900, 350]],
            bubbles: [[100, 100, 200, 80]]
          }
        }
      });

      const applyBubbleOverlay = env.state.GuidedView.applyBubbleOverlay;
      // Zoom speech bubble [100, 100, 200, 80] inside top panel [50, 50, 900, 350]
      applyBubbleOverlay([100, 100, 200, 80], false);

      const overlay = env.sandbox.document.getElementById('bubble-magnifier-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay.style.display).toBe('block');

      // Transform format is translate(Xpx, Ypx) scale(...)
      const match = overlay.style.transform.match(/translate\((\d+)px,\s*(\d+)px\)/);
      expect(match).toBeTruthy();
      const targetY = parseInt(match[2], 10);
      // Smart placement places overlay below the top panel (>= 400)
      expect(targetY).toBeGreaterThanOrEqual(400);
    });

    test('Panel zoom centers the panel on screen and is NOT affected by bubble placement', () => {
      const env = createPlacementSandbox();

      env.sandbox.document.body.innerHTML = `
        <div id="fullscreen-viewer" style="width: 1000px; height: 1500px;">
          <img id="fullscreen-image" src="test.jpg" />
        </div>
      `;
      const stage = env.sandbox.document.getElementById('fullscreen-viewer');
      Object.defineProperty(stage, 'clientWidth', { value: 1000, configurable: true });
      Object.defineProperty(stage, 'clientHeight', { value: 1500, configurable: true });

      const img = env.sandbox.document.getElementById('fullscreen-image');
      Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 1500, configurable: true });
      Object.defineProperty(img, 'clientWidth', { value: 1000, configurable: true });
      Object.defineProperty(img, 'clientHeight', { value: 1500, configurable: true });

      env.state.currentComic = { id: 'comic-1', mangaMode: false, guidedViewStatus: 'completed' };
      env.state.getViewerPages = () => ['page_1.jpg'];
      env.state.currentPageIndex = 0;
      env.state.GuidedView.cache.set('comic-1', {
        pages: {
          'page_1.jpg': {
            panels: [[50, 50, 900, 350]],
            bubbles: [[100, 100, 200, 80]]
          }
        }
      });

      const applyBubbleOverlay = env.state.GuidedView.applyBubbleOverlay;
      // Zoom panel [50, 50, 900, 350] (isPanelZoom: true)
      applyBubbleOverlay([50, 50, 900, 350], true);

      const overlay = env.sandbox.document.getElementById('bubble-magnifier-overlay');
      expect(overlay).toBeTruthy();

      const match = overlay.style.transform.match(/translate\((\d+)px,\s*(\d+)px\)/);
      expect(match).toBeTruthy();
      const targetX = parseInt(match[1], 10);
      const targetY = parseInt(match[2], 10);
      const overlayW = parseInt(overlay.style.width, 10);
      const overlayH = parseInt(overlay.style.height, 10);

      // In panel zoom, overlay is centered on screen:
      // targetX ≈ (1000 - overlayW) / 2
      // targetY ≈ (1500 - overlayH) / 2
      expect(Math.abs(targetX - (1000 - overlayW) / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(targetY - (1500 - overlayH) / 2)).toBeLessThanOrEqual(2);
    });
  });
});
