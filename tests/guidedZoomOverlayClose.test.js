/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSandbox() {
  const state = {
    currentView: 'root',
    fullscreenPage: 0,
    getViewerPages: () => ['page_1.jpg'],
    currentPageIndex: 0,
    GuidedView: {
      isFullscreenOpen: () => true,
      refreshRender: jest.fn(),
      updateWesternSpeechZoomUI: jest.fn(),
      updateMangaSpeechZoomUI: jest.fn(),
      updateMangaPanelZoomUI: jest.fn()
    }
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
  sandbox.window = sandbox;
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

describe('Guided View - Zoom Overlay Dismiss on Click', () => {
  function setupDOM() {
    document.body.innerHTML = `
      <div id="fullscreen-viewer">
        <img id="fullscreen-image" src="test.jpg" style="width: 1000px; height: 1500px;" />
        <div id="bubble-magnifier-overlay" style="display: block; position: absolute; left: 100px; top: 100px; width: 400px; height: 300px;">
          <img id="bubble-magnifier-img" src="test.jpg" />
        </div>
      </div>
    `;

    const img = document.getElementById('fullscreen-image');
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
  }

  test('Clicking directly on the zoom overlay closes western-speech-zoom instead of switching to a different bubble hidden behind it', async () => {
    setupDOM();
    const env = createSandbox();
    env.loadFile('../public/js/viewer/guided/modes/western-speech-zoom.js');

    env.state.currentComic = { id: 'comic-w1', guidedViewStatus: 'completed', mangaMode: false, hotZoomMode: true };
    // Bubble 0 is at (200, 200). Bubble 1 is at (600, 600).
    const bubbles = [
      [150, 150, 100, 100], // index 0 (hidden under overlay)
      [550, 550, 100, 100]  // index 1 (currently zoomed)
    ];
    env.state.GuidedView.cache.set('comic-w1', {
      pages: { 'page_1.jpg': { panels: [[100, 100, 700, 700]], bubbles, sequence: bubbles } }
    });

    const registry = env.state.GuidedView.ModeRegistry;
    await registry.enable('western-speech-zoom');
    const mode = registry.getActiveMode();
    expect(mode).toBeDefined();

    // Zoom into bubble 1 at (600, 600)
    mode.handleImageClick(600, 600);
    expect(mode.getRenderState().targetBox).toEqual([550, 550, 100, 100]);

    // Now user clicks on the overlay at screen (200, 200).
    // In background coordinates, this falls on bubble 0!
    const overlay = document.getElementById('bubble-magnifier-overlay');
    const overlayClickEvt = {
      target: overlay,
      clientX: 200,
      clientY: 200,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn()
    };

    env.sandbox.handleImageClick(overlayClickEvt);

    // Zoom must be CLOSED (null), NOT switched to bubble 0!
    expect(mode.getRenderState().targetBox).toBeNull();
    expect(overlayClickEvt.preventDefault).toHaveBeenCalled();
    expect(overlayClickEvt.stopPropagation).toHaveBeenCalled();
  });

  test('Clicking on inner magnifier image closes manga-panel-zoom instead of switching to a different panel hidden behind it', async () => {
    setupDOM();
    const env = createSandbox();
    env.loadFile('../public/js/viewer/guided/modes/manga-panel-zoom.js');

    env.state.currentComic = { id: 'comic-m2', guidedViewStatus: 'completed', mangaMode: true };
    // Panel 0 is at (150, 150). Panel 1 is at (600, 600).
    const panels = [
      [100, 100, 200, 200], // index 0 (hidden under overlay)
      [500, 500, 300, 300]  // index 1 (currently zoomed)
    ];
    env.state.GuidedView.cache.set('comic-m2', {
      pages: { 'page_1.jpg': { panels, bubbles: [], sequence: panels } }
    });

    const registry = env.state.GuidedView.ModeRegistry;
    await registry.enable('manga-panel-zoom');
    const mode = registry.getActiveMode();
    expect(mode).toBeDefined();

    // Zoom into panel 1 at (600, 600)
    mode.handleImageClick(600, 600);
    expect(mode.getRenderState().targetBox).toEqual([500, 500, 300, 300]);

    // Click on inner magnifier image at (200, 200)
    const innerImg = document.getElementById('bubble-magnifier-img');
    const innerClickEvt = {
      target: innerImg,
      clientX: 200,
      clientY: 200,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn()
    };

    env.sandbox.handleImageClick(innerClickEvt);

    // Zoom must be CLOSED (null), NOT switched to panel 0!
    expect(mode.getRenderState().targetBox).toBeNull();
    expect(innerClickEvt.preventDefault).toHaveBeenCalled();
    expect(innerClickEvt.stopPropagation).toHaveBeenCalled();
  });

  test('Clicking on zoom overlay closes manga-speech-zoom instead of switching to hidden bubble', async () => {
    setupDOM();
    const env = createSandbox();
    env.loadFile('../public/js/viewer/guided/modes/manga-speech-zoom.js');

    env.state.currentComic = { id: 'comic-m1', guidedViewStatus: 'completed', mangaMode: true };
    const bubbles = [
      [150, 150, 100, 100], // index 0 (hidden under overlay)
      [550, 550, 100, 100]  // index 1 (currently zoomed)
    ];
    env.state.GuidedView.cache.set('comic-m1', {
      pages: { 'page_1.jpg': { panels: [[100, 100, 700, 700]], bubbles, sequence: bubbles } }
    });

    const registry = env.state.GuidedView.ModeRegistry;
    await registry.enable('manga-speech-zoom');
    const mode = registry.getActiveMode();
    expect(mode).toBeDefined();

    // Zoom into bubble 1
    mode.handleImageClick(600, 600);
    expect(mode.getRenderState().targetBox).toEqual([550, 550, 100, 100]);

    const overlay = document.getElementById('bubble-magnifier-overlay');
    const overlayClickEvt = {
      target: overlay,
      clientX: 200,
      clientY: 200,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn()
    };

    env.sandbox.handleImageClick(overlayClickEvt);

    expect(mode.getRenderState().targetBox).toBeNull();
  });

  test('Clicking on zoom overlay clears manual override zoom box', () => {
    setupDOM();
    const env = createSandbox();

    const registry = env.state.GuidedView.ModeRegistry;
    registry.setManualOverrideBox([100, 100, 200, 200]);

    const overlay = document.getElementById('bubble-magnifier-overlay');
    const overlayClickEvt = {
      target: overlay,
      clientX: 200,
      clientY: 200,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn()
    };

    env.sandbox.handleImageClick(overlayClickEvt);

    expect(registry.getManualOverrideBox()).toBeNull();
  });
});
