/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createInteractiveZoomSandbox() {
  const state = {
    currentView: 'root',
    currentRootFolder: null,
    activeSmartFilter: null,
    comicIdMap: new Map(),
    mangaModePreference: false,
    fullscreenPage: 0
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
  loadFile('../public/js/viewer/guided/mode-registry.js');
  loadFile('../public/js/viewer/guided/overlay.js');
  loadFile('../public/js/viewer/guided/pan.js');
  loadFile('../public/js/viewer/guided/input.js');

  return { sandbox, loadFile, state };
}

describe('Interactive Guided Zoom Modes', () => {
  describe('Automated Guided Views Disabled', () => {
    test('ModeRegistry prevents enabling automated guided or bubble modes', async () => {
      const { sandbox } = createInteractiveZoomSandbox();
      const registry = sandbox.state.GuidedView.ModeRegistry;

      const guidedResult = await registry.enable('guided');
      expect(guidedResult).toBe(false);
      expect(registry.getActiveModeName()).toBeNull();

      const bubbleResult = await registry.enable('bubble');
      expect(bubbleResult).toBe(false);
      expect(registry.getActiveModeName()).toBeNull();
    });
  });

  describe('findBubbleAtPoint: expanded click hit target', () => {
    test('Matches exact hit inside bubble', () => {
      const { sandbox } = createInteractiveZoomSandbox();
      const fn = sandbox.state.GuidedView.findBubbleAtPoint;
      const bubbles = [[100, 100, 150, 60]];

      expect(fn(bubbles, 120, 120)).toBe(0);
    });

    test('Matches click within padding tolerance outside bubble borders', () => {
      const { sandbox } = createInteractiveZoomSandbox();
      const fn = sandbox.state.GuidedView.findBubbleAtPoint;
      const bubbles = [[100, 100, 150, 60]];

      // 20px above top edge
      expect(fn(bubbles, 120, 80)).toBe(0);
      // 20px below bottom edge
      expect(fn(bubbles, 120, 180)).toBe(0);
      // 20px left of left edge
      expect(fn(bubbles, 80, 120)).toBe(0);
      // 20px right of right edge
      expect(fn(bubbles, 270, 120)).toBe(0);
    });

    test('Does not match click far outside bubble', () => {
      const { sandbox } = createInteractiveZoomSandbox();
      const fn = sandbox.state.GuidedView.findBubbleAtPoint;
      const bubbles = [[100, 100, 150, 60]];

      expect(fn(bubbles, 10, 10)).toBe(-1);
      expect(fn(bubbles, 400, 400)).toBe(-1);
    });

    test('Picks the closest bubble when clicked in between two bubbles', () => {
      const { sandbox } = createInteractiveZoomSandbox();
      const fn = sandbox.state.GuidedView.findBubbleAtPoint;
      const bubbles = [
        [100, 100, 100, 50],  // bottom at y = 150
        [100, 200, 100, 50]   // top at y = 200
      ];

      // y = 160 is 10px from bubble 0 and 40px from bubble 1
      expect(fn(bubbles, 150, 160)).toBe(0);

      // y = 190 is 40px from bubble 0 and 10px from bubble 1
      expect(fn(bubbles, 150, 190)).toBe(1);
    });
  });

  describe('Western Mode: Only Bubble Zoom (WesternSpeechZoomMode)', () => {
    let env;
    let mode;

    beforeEach(() => {
      env = createInteractiveZoomSandbox();
      env.loadFile('../public/js/viewer/guided/modes/western-speech-zoom.js');

      env.state.GuidedView.isFullscreenOpen = () => true;
      env.state.currentComic = { id: 'comic-w1', mangaMode: false, guidedViewStatus: 'completed' };
      env.state.getViewerPages = () => ['page_1.jpg'];
      env.state.currentPageIndex = 0;
      env.state.GuidedView.refreshRender = jest.fn();
      env.state.GuidedView.updateWesternSpeechZoomUI = jest.fn();

      const panels = [[50, 50, 400, 300], [50, 400, 400, 300]];
      const bubbles = [[100, 100, 150, 60]];
      env.state.GuidedView.cache.set('comic-w1', {
        pages: {
          'page_1.jpg': {
            panels,
            bubbles,
            sequence: bubbles
          }
        }
      });

      mode = env.state.GuidedView.ModeRegistry.get('western-speech-zoom');
    });

    test('Clicking inside speech bubble zooms the speech bubble (isPanelZoom: false)', async () => {
      await mode.enable();

      // Click at (120, 120), which is inside bubble [100, 100, 150, 60]
      const handled = mode.handleImageClick(120, 120);
      expect(handled).toBe(true);

      const renderState = mode.getRenderState();
      expect(renderState.isPanelZoom).toBe(false);
      expect(renderState.targetBox).toEqual([100, 100, 150, 60]);
    });

    test('Clicking in expanded hit area outside bubble boundary (e.g. 20px above) zooms speech bubble', async () => {
      await mode.enable();

      // Click at (120, 80), which is 20px above bubble [100, 100, 150, 60]
      const handled = mode.handleImageClick(120, 80);
      expect(handled).toBe(true);

      const renderState = mode.getRenderState();
      expect(renderState.isPanelZoom).toBe(false);
      expect(renderState.targetBox).toEqual([100, 100, 150, 60]);
    });

    test('Western speech zoom only zooms bubbles: clicking panel outside bubble does not zoom panel', async () => {
      await mode.enable();

      // Click at (350, 250), inside panel but far outside bubbles
      const handled = mode.handleImageClick(350, 250);
      expect(handled).toBe(false);
      expect(mode.getRenderState().targetBox).toBeNull();
    });

    test('Clicking active bubble again toggles unzoom back to full page', async () => {
      await mode.enable();

      mode.handleImageClick(120, 120);
      expect(mode.getRenderState().targetBox).toEqual([100, 100, 150, 60]);

      // Second click on same bubble unzooms
      const unzoomHandled = mode.handleImageClick(120, 120);
      expect(unzoomHandled).toBe(true);
      expect(mode.getRenderState().targetBox).toBeNull();
    });

    test('Clicking outside while zoomed unzooms back to full page', async () => {
      await mode.enable();

      mode.handleImageClick(120, 120);
      expect(mode.getRenderState().targetBox).toEqual([100, 100, 150, 60]);

      // Click at (10, 10) outside all bubbles
      const handled = mode.handleImageClick(10, 10);
      expect(handled).toBe(true);
      expect(mode.getRenderState().targetBox).toBeNull();
    });
  });

  describe('Manga Mode: Speech Bubble Zoom (MangaSpeechZoomMode)', () => {
    let env;
    let mode;

    beforeEach(() => {
      env = createInteractiveZoomSandbox();
      env.loadFile('../public/js/viewer/guided/modes/manga-speech-zoom.js');

      env.state.GuidedView.isFullscreenOpen = () => true;
      env.state.currentComic = { id: 'comic-m1', mangaMode: true, guidedViewStatus: 'completed' };
      env.state.getViewerPages = () => ['page_1.jpg'];
      env.state.currentPageIndex = 0;
      env.state.fullscreenPage = 0;
      env.state.GuidedView.refreshRender = jest.fn();
      env.state.GuidedView.updateMangaSpeechZoomUI = jest.fn();

      const panels = [[50, 50, 400, 300], [50, 400, 400, 300]];
      const bubbles = [[100, 100, 150, 60]];
      env.state.GuidedView.cache.set('comic-m1', {
        pages: {
          'page_1.jpg': {
            panels,
            bubbles,
            sequence: [...panels, ...bubbles]
          }
        }
      });

      mode = env.state.GuidedView.ModeRegistry.get('manga-speech-zoom');
    });

    test('Only zooms speech bubbles: clicking bubble zooms, clicking panel does not zoom panel', async () => {
      await mode.enable();

      // Click bubble
      const bubbleHandled = mode.handleImageClick(120, 120);
      expect(bubbleHandled).toBe(true);
      let renderState = mode.getRenderState();
      expect(renderState.isPanelZoom).toBe(false);
      expect(renderState.targetBox).toEqual([100, 100, 150, 60]);

      // Click same bubble unzooms
      mode.handleImageClick(120, 120);
      expect(mode.getRenderState().targetBox).toBeNull();

      // Click in expanded hit area outside bubble boundary (e.g. 20px above) zooms bubble
      const expandedHandled = mode.handleImageClick(120, 80);
      expect(expandedHandled).toBe(true);
      expect(mode.getRenderState().targetBox).toEqual([100, 100, 150, 60]);
      mode.handleImageClick(120, 80); // unzoom

      // Click panel far outside bubbles does not zoom panel
      const panelHandled = mode.handleImageClick(350, 250);
      expect(panelHandled).toBe(false);
      expect(mode.getRenderState().targetBox).toBeNull();
    });
  });

  describe('Manga Mode: Panel Zoom with Bubble Zoom Support (MangaPanelZoomMode)', () => {
    let env;
    let mode;

    beforeEach(() => {
      env = createInteractiveZoomSandbox();
      env.loadFile('../public/js/viewer/guided/modes/manga-panel-zoom.js');

      env.state.GuidedView.isFullscreenOpen = () => true;
      env.state.currentComic = { id: 'comic-m2', mangaMode: true, guidedViewStatus: 'completed' };
      env.state.getViewerPages = () => ['page_1.jpg'];
      env.state.currentPageIndex = 0;
      env.state.fullscreenPage = 0;
      env.state.GuidedView.refreshRender = jest.fn();
      env.state.GuidedView.updateMangaPanelZoomUI = jest.fn();

      const panels = [[50, 50, 400, 300], [50, 400, 400, 300]];
      const bubbles = [[100, 100, 150, 60]];
      env.state.GuidedView.cache.set('comic-m2', {
        pages: {
          'page_1.jpg': {
            panels,
            bubbles,
            sequence: [...panels, ...bubbles]
          }
        }
      });

      mode = env.state.GuidedView.ModeRegistry.get('manga-panel-zoom');
    });

    test('Clicking speech bubble zooms bubble, clicking panel zooms panel', async () => {
      await mode.enable();

      // Click bubble -> zooms bubble
      const bubbleHandled = mode.handleImageClick(120, 120);
      expect(bubbleHandled).toBe(true);
      let renderState = mode.getRenderState();
      expect(renderState.isPanelZoom).toBe(false);
      expect(renderState.targetBox).toEqual([100, 100, 150, 60]);

      // Click same bubble unzooms
      mode.handleImageClick(120, 120);
      expect(mode.getRenderState().targetBox).toBeNull();

      // Click in expanded bubble hit area (e.g. 20px above) prioritizes bubble zoom over panel zoom
      mode.handleImageClick(120, 80);
      renderState = mode.getRenderState();
      expect(renderState.isPanelZoom).toBe(false);
      expect(renderState.targetBox).toEqual([100, 100, 150, 60]);
      mode.handleImageClick(120, 80); // unzoom

      // Click panel outside bubble -> zooms panel
      const panelHandled = mode.handleImageClick(350, 250);
      expect(panelHandled).toBe(true);
      renderState = mode.getRenderState();
      expect(renderState.isPanelZoom).toBe(true);
      expect(renderState.targetBox).toEqual([50, 50, 400, 300]);

      // Clicking same panel toggles unzoom
      const unzoomHandled = mode.handleImageClick(350, 250);
      expect(unzoomHandled).toBe(true);
      expect(mode.getRenderState().targetBox).toBeNull();

      // Clicking outside while zoomed in unzooms
      mode.handleImageClick(350, 250);
      expect(mode.getRenderState().targetBox).toEqual([50, 50, 400, 300]);
      mode.handleImageClick(5, 5);
      expect(mode.getRenderState().targetBox).toBeNull();
    });
  });

  describe('Manual Override Double-Tap Zoom Box & Pan', () => {
    test('Double-tapping in western-speech-zoom mode opens manual zoom box and can be dismissed', async () => {
      const env = createInteractiveZoomSandbox();
      env.loadFile('../public/js/viewer/guided/modes/western-speech-zoom.js');

      env.sandbox.document.body.innerHTML = `
        <div id="fullscreen-viewer">
          <img id="fullscreen-image" src="test.jpg" />
        </div>
      `;
      const img = env.sandbox.document.getElementById('fullscreen-image');
      Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 1500, configurable: true });
      img.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 1500,
        width: 1000,
        height: 1500
      });

      env.state.GuidedView.isFullscreenOpen = () => true;
      env.state.currentComic = { id: 'comic-w1', mangaMode: false, guidedViewStatus: 'completed' };
      env.state.getViewerPages = () => ['page_1.jpg'];
      env.state.currentPageIndex = 0;
      env.state.GuidedView.refreshRender = jest.fn();
      env.state.GuidedView.updateWesternSpeechZoomUI = jest.fn();
      env.state.GuidedView.cache.set('comic-w1', {
        pages: { 'page_1.jpg': { panels: [[50, 50, 400, 300]], bubbles: [[100, 100, 150, 60]] } }
      });

      let testTime = 1000;
      env.sandbox.performance = { now: () => testTime };

      const registry = env.state.GuidedView.ModeRegistry;
      await registry.enable('western-speech-zoom');
      expect(registry.getManualOverrideBox()).toBeNull();

      // Simulate double tap at (400, 600)
      const dblClickEvent = {
        clientX: 400,
        clientY: 600,
        type: 'dblclick',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };

      env.sandbox.handleDoubleClickZoom(dblClickEvent);

      const box = registry.getManualOverrideBox();
      expect(box).toBeTruthy();
      expect(box[2]).toBe(250);
      expect(box[3]).toBe(330);
      expect(box[0]).toBe(275);
      expect(box[1]).toBe(435);

      // Advance time past 250ms debounce
      testTime += 500;
      env.sandbox.handleDoubleClickZoom(dblClickEvent);
      expect(registry.getManualOverrideBox()).toBeNull();
    });

    test('Double-tapping in manga-panel-zoom mode opens manual zoom box and can be dismissed', async () => {
      const env = createInteractiveZoomSandbox();
      env.loadFile('../public/js/viewer/guided/modes/manga-panel-zoom.js');

      env.sandbox.document.body.innerHTML = `
        <div id="fullscreen-viewer">
          <img id="fullscreen-image" src="test.jpg" />
        </div>
      `;
      const img = env.sandbox.document.getElementById('fullscreen-image');
      Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
      Object.defineProperty(img, 'naturalHeight', { value: 1500, configurable: true });
      img.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 1500,
        width: 1000,
        height: 1500
      });

      env.state.GuidedView.isFullscreenOpen = () => true;
      env.state.currentComic = { id: 'comic-m1', mangaMode: true, guidedViewStatus: 'completed' };
      env.state.getViewerPages = () => ['page_1.jpg'];
      env.state.currentPageIndex = 0;
      env.state.GuidedView.refreshRender = jest.fn();
      env.state.GuidedView.updateMangaPanelZoomUI = jest.fn();
      env.state.GuidedView.cache.set('comic-m1', {
        pages: { 'page_1.jpg': { panels: [[50, 50, 400, 300]], bubbles: [[100, 100, 150, 60]] } }
      });

      let testTime = 1000;
      env.sandbox.performance = { now: () => testTime };

      const registry = env.state.GuidedView.ModeRegistry;
      await registry.enable('manga-panel-zoom');
      expect(registry.getManualOverrideBox()).toBeNull();

      // Simulate double tap at (500, 500)
      const dblClickEvent = {
        clientX: 500,
        clientY: 500,
        type: 'dblclick',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };

      env.sandbox.handleDoubleClickZoom(dblClickEvent);

      const box = registry.getManualOverrideBox();
      expect(box).toBeTruthy();
      expect(box[2]).toBe(250);
      expect(box[3]).toBe(330);

      // Single click on stage dismisses the manual zoom box after 500ms debounce
      testTime += 600;
      const singleClickEvent = {
        clientX: 500,
        clientY: 500,
        type: 'click',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };
      env.sandbox.handleImageClick(singleClickEvent);

      expect(registry.getManualOverrideBox()).toBeNull();
    });

    test('Two-finger pan moves the manual override zoom box', () => {
      const env = createInteractiveZoomSandbox();

      env.sandbox.document.body.innerHTML = `
        <div id="fullscreen-viewer">
          <div id="bubble-magnifier-overlay" style="display: block; opacity: 1;">
            <img id="bubble-magnifier-img" style="transform: scale(2);" />
          </div>
        </div>
      `;
      const overlay = env.sandbox.document.getElementById('bubble-magnifier-overlay');
      overlay.setPointerCapture = jest.fn();
      overlay.releasePointerCapture = jest.fn();

      const registry = env.state.GuidedView.ModeRegistry;
      registry.setManualOverrideBox([200, 200, 250, 330]);

      // Finger 1 down
      env.sandbox.handlePointerDown({
        pointerId: 1,
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      });

      // Finger 2 down (triggers two-finger pan!)
      env.sandbox.handlePointerDown({
        pointerId: 2,
        pointerType: 'touch',
        clientX: 200,
        clientY: 200,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      });

      expect(env.state.GuidedView.isPanning).toBe(true);

      // Move both fingers by +20px in X and Y
      env.sandbox.handlePointerMove({
        pointerId: 1,
        clientX: 120,
        clientY: 120,
        stopPropagation: jest.fn()
      });
      env.sandbox.handlePointerMove({
        pointerId: 2,
        clientX: 220,
        clientY: 220,
        stopPropagation: jest.fn()
      });

      // Release finger
      env.sandbox.handlePointerUp({
        pointerId: 1,
        pointerType: 'touch',
        stopPropagation: jest.fn()
      });
      expect(env.state.GuidedView.isPanning).toBe(false);
    });
  });
});
