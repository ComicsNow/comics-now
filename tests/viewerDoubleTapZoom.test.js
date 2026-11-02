/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Double-Tap to Zoom Anywhere - Resilience and Timing', () => {
  let sandbox;

  function loadFile(relPath, customSandbox = sandbox) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/\bconst\s+/g, 'var ')
      .replace(/\blet\s+/g, 'var ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    vm.runInContext(cleanContent, customSandbox);
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="fullscreen-viewer" class="fullscreen-fit-mode">
        <div id="fullscreen-nav-left" class="fullscreen-nav left"></div>
        <div id="fullscreen-nav-right" class="fullscreen-nav right"></div>
        <img id="fullscreen-image" src="test.jpg" />
        <div id="fullscreen-controls" class="hidden"></div>
      </div>
    `;

    const img = document.getElementById('fullscreen-image');
    img.getBoundingClientRect = () => ({
      left: 100,
      top: 50,
      right: 900,
      bottom: 1250,
      width: 800,
      height: 1200
    });

    const state = {
      fullscreenViewer: document.getElementById('fullscreen-viewer'),
      fullscreenImage: img,
      fullscreenNavLeft: document.getElementById('fullscreen-nav-left'),
      fullscreenNavRight: document.getElementById('fullscreen-nav-right'),
      isFullscreenZoomed: false,
      fullscreenZoomScale: 1,
      isFullImageMode: false,
      isContinuousMode: false,
      GuidedView: { isAnyActive: () => false },
      hideFullscreenControls: jest.fn(),
      showFullscreenControls: jest.fn(),
      navigatePage: jest.fn(),
      applyFullscreenZoom: jest.fn((scale, rx, ry) => {
        state.isFullscreenZoomed = true;
        state.fullscreenZoomScale = scale;
      }),
      resetFullscreenZoom: jest.fn(() => {
        state.isFullscreenZoomed = false;
        state.fullscreenZoomScale = 1;
      }),
      endFullscreenPan: jest.fn()
    };

    sandbox = {
      window,
      document,
      console,
      state,
      global: state,
      canonicalGlobal: state,
      setTimeout: (...args) => setTimeout(...args),
      clearTimeout: (...args) => clearTimeout(...args),
      performance: { now: () => 1000 },
      isCinemaPanningActive: () => false,
      stopCinemaPan: jest.fn(),
      getHasDragged: () => false,
      clamp: (v, min, max) => Math.min(Math.max(v, min), max),
      applyFullscreenZoom: state.applyFullscreenZoom,
      showFullscreenControls: state.showFullscreenControls,
      hideFullscreenControls: state.hideFullscreenControls
    };
    vm.createContext(sandbox);

    loadFile('../public/js/viewer/fullscreen/gestures.js', sandbox);
    loadFile('../public/js/viewer/fullscreen/long-press.js', sandbox);
  });

  test('tolerates realistic human touch double-tap interval (340ms)', () => {
    let now = 1000;
    sandbox.performance.now = () => now;

    // First tap at (400, 500)
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 400,
      clientY: 500,
      target: sandbox.state.fullscreenImage
    });

    expect(sandbox.state.applyFullscreenZoom).not.toHaveBeenCalled();

    // Second tap 340ms later at (405, 505) - within realistic human timing
    now += 340;
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 405,
      clientY: 505,
      target: sandbox.state.fullscreenImage
    });

    expect(sandbox.state.applyFullscreenZoom).toHaveBeenCalledWith(2, expect.any(Number), expect.any(Number));
  });

  test('tolerates realistic finger movement distance between taps (42px)', () => {
    let now = 1000;
    sandbox.performance.now = () => now;

    // First tap at (400, 500)
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 400,
      clientY: 500,
      target: sandbox.state.fullscreenImage
    });

    // Second tap 220ms later with 42px offset (e.g. slight finger tilt on glass)
    now += 220;
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 430, // dx = 30
      clientY: 529, // dy = 29 -> sqrt(900 + 841) = ~41.7px
      target: sandbox.state.fullscreenImage
    });

    expect(sandbox.state.applyFullscreenZoom).toHaveBeenCalled();
  });

  test('double-tapping on side navigation hotspot zooms and does NOT turn page', (done) => {
    let now = 1000;
    sandbox.performance.now = () => now;
    sandbox.bindFullscreenLongPress();

    const left = sandbox.state.fullscreenNavLeft;

    // First tap on left hotspot
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 50,
      clientY: 400,
      target: left
    });

    // Click event fired by browser for first tap
    const clickEvt1 = new window.MouseEvent('click', { clientX: 50, clientY: 400, bubbles: true });
    left.dispatchEvent(clickEvt1);

    // Second tap 320ms later on left hotspot
    now += 320;
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 52,
      clientY: 402,
      target: left
    });

    // Click event fired by browser for second tap
    const clickEvt2 = new window.MouseEvent('click', { clientX: 52, clientY: 402, bubbles: true });
    left.dispatchEvent(clickEvt2);

    expect(sandbox.state.applyFullscreenZoom).toHaveBeenCalled();

    // Wait 450ms to ensure no pending side nav turns the page
    setTimeout(() => {
      expect(sandbox.state.navigatePage).not.toHaveBeenCalled();
      done();
    }, 450);
  });

  test('double-tapping on side navigation hotspot while zoomed in resets zoom and does NOT turn page', (done) => {
    sandbox.state.isFullscreenZoomed = true;
    sandbox.state.fullscreenZoomScale = 2;
    let now = 1000;
    sandbox.performance.now = () => now;
    sandbox.bindFullscreenLongPress();

    const right = sandbox.state.fullscreenNavRight;

    // First tap
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 950,
      clientY: 400,
      target: right
    });
    const clickEvt1 = new window.MouseEvent('click', { clientX: 950, clientY: 400, bubbles: true });
    right.dispatchEvent(clickEvt1);

    // Second tap 250ms later -> zooms out
    now += 250;
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 952,
      clientY: 402,
      target: right
    });
    const clickEvt2 = new window.MouseEvent('click', { clientX: 952, clientY: 402, bubbles: true });
    right.dispatchEvent(clickEvt2);

    expect(sandbox.state.resetFullscreenZoom).toHaveBeenCalled();

    // Wait 450ms: navigatePage must NOT be called on tap 2's click
    setTimeout(() => {
      expect(sandbox.state.navigatePage).not.toHaveBeenCalled();
      done();
    }, 450);
  });

  test('clicking in middle of page when controls are closed surfaces fullscreen controls after debounce', () => {
    jest.useFakeTimers();
    try {
      const controls = document.getElementById('fullscreen-controls');
      controls.classList.add('hidden');
      sandbox.state.showFullscreenControls = jest.fn();

      const img = sandbox.state.fullscreenImage;
      // Click in the horizontal middle of the image, near the top (clientY = 200)
      sandbox.handleFullscreenImageClick({
        clientX: 500,
        clientY: 200,
        currentTarget: img,
        target: img
      });

      jest.advanceTimersByTime(400);
      expect(sandbox.state.showFullscreenControls).toHaveBeenCalledWith(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('clicking in middle of page when controls are open dismisses fullscreen controls', () => {
    const controls = document.getElementById('fullscreen-controls');
    controls.classList.remove('hidden');
    sandbox.state.hideFullscreenControls = jest.fn();

    const img = sandbox.state.fullscreenImage;
    sandbox.handleFullscreenImageClick({
      clientX: 500,
      clientY: 600,
      currentTarget: img,
      target: img
    });

    expect(sandbox.state.hideFullscreenControls).toHaveBeenCalled();
  });

  test('clicking a control button inside #fullscreen-controls does NOT dismiss controls', () => {
    const controls = document.getElementById('fullscreen-controls');
    controls.classList.remove('hidden');
    controls.innerHTML = `<button id="test-zoom-btn">Zoom</button>`;
    const btn = document.getElementById('test-zoom-btn');

    sandbox.state.hideFullscreenControls = jest.fn();

    // Event targeting the button inside #fullscreen-controls
    const clickEvt = {
      target: btn,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn()
    };

    // If handleImageClick runs during capture, it must ignore control clicks
    if (typeof sandbox.handleImageClick === 'function') {
      sandbox.handleImageClick(clickEvt);
      expect(sandbox.state.hideFullscreenControls).not.toHaveBeenCalled();
      expect(clickEvt.preventDefault).not.toHaveBeenCalled();
    }
  });

  test('double-clicking with mouse in standard viewer zooms in, and double-clicking again unzooms', () => {
    let now = 1000;
    sandbox.performance.now = () => now;

    const img = sandbox.state.fullscreenImage;
    sandbox.handleViewerDblClick({
      clientX: 500,
      clientY: 650,
      target: img
    });

    expect(sandbox.state.applyFullscreenZoom).toHaveBeenCalledWith(2, expect.any(Number), expect.any(Number));
    expect(sandbox.state.resetFullscreenZoom).not.toHaveBeenCalled();

    // Advance past debounce
    now += 300;
    sandbox.handleViewerDblClick({
      clientX: 500,
      clientY: 650,
      target: img
    });

    expect(sandbox.state.resetFullscreenZoom).toHaveBeenCalled();
  });

  test('browser emitting native dblclick immediately after touch double-tap does NOT double-toggle zoom back out', () => {
    let now = 1000;
    sandbox.performance.now = () => now;
    const img = sandbox.state.fullscreenImage;

    // Touch tap 1
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 400,
      clientY: 500,
      target: img
    });

    // Touch tap 2 200ms later -> zooms in
    now += 200;
    sandbox.handleFullscreenPointerUpForDblTap({
      pointerType: 'touch',
      button: 0,
      clientX: 402,
      clientY: 502,
      target: img
    });

    expect(sandbox.state.applyFullscreenZoom).toHaveBeenCalledTimes(1);

    // Browser fires native dblclick 10ms after tap 2
    now += 10;
    sandbox.handleViewerDblClick({
      clientX: 402,
      clientY: 502,
      target: img
    });

    // Must still only be zoomed in once, NOT unzoomed!
    expect(sandbox.state.applyFullscreenZoom).toHaveBeenCalledTimes(1);
    expect(sandbox.state.resetFullscreenZoom).not.toHaveBeenCalled();
  });

  describe('Guided View Mode - Double-Tap Zoom Anywhere', () => {
    let gvSandbox;

    beforeEach(() => {
      document.body.innerHTML = `
        <div id="fullscreen-viewer">
          <img id="fullscreen-image" src="test.jpg" />
          <div id="fullscreen-controls" class="hidden"></div>
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

      let manualBox = null;
      const state = {
        GuidedView: {
          ModeRegistry: {
            getActiveModeName: () => 'western-speech-zoom',
            getActiveMode: () => ({ handleImageClick: jest.fn(() => false) }),
            getManualOverrideBox: () => manualBox,
            setManualOverrideBox: (box) => { manualBox = box; }
          },
          refreshRender: jest.fn()
        },
        showFullscreenControls: jest.fn()
      };

      gvSandbox = {
        window,
        document,
        console,
        state,
        performance: { now: () => 1000 },
        setTimeout,
        clearTimeout
      };
      vm.createContext(gvSandbox);
      loadFile('../public/js/viewer/guided/input.js', gvSandbox);
    });

    test('tolerates 340ms interval and 42px finger offset in Guided View mode', () => {
      let now = 1000;
      gvSandbox.performance.now = () => now;

      // Tap 1
      gvSandbox.handlePointerUpForDblTap({
        pointerType: 'touch',
        button: 0,
        clientX: 500,
        clientY: 600,
        target: document.getElementById('fullscreen-image')
      });

      expect(gvSandbox.state.GuidedView.ModeRegistry.getManualOverrideBox()).toBeNull();

      // Tap 2 at 340ms with 42px offset
      now += 340;
      gvSandbox.handlePointerUpForDblTap({
        pointerType: 'touch',
        button: 0,
        clientX: 530,
        clientY: 629,
        target: document.getElementById('fullscreen-image')
      });

      const box = gvSandbox.state.GuidedView.ModeRegistry.getManualOverrideBox();
      expect(box).toBeTruthy();
      expect(box[2]).toBe(250); // 25% of 1000
      expect(box[3]).toBe(330); // 22% of 1500
    });

    test('Tap 2 click event does not trigger conflicting single-click speech bubble action', () => {
      let now = 1000;
      gvSandbox.performance.now = () => now;

      // Tap 1
      gvSandbox.handlePointerUpForDblTap({
        pointerType: 'touch',
        button: 0,
        clientX: 500,
        clientY: 600,
        target: document.getElementById('fullscreen-image')
      });

      // Tap 2 double tap triggers manual override box
      now += 200;
      gvSandbox.handlePointerUpForDblTap({
        pointerType: 'touch',
        button: 0,
        clientX: 502,
        clientY: 602,
        target: document.getElementById('fullscreen-image')
      });

      // Browser generates click event after tap 2
      const clickEvt = {
        clientX: 502,
        clientY: 602,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        target: document.getElementById('fullscreen-image')
      };
      gvSandbox.handleImageClick(clickEvt);

      // Box remains active and was not immediately closed or overridden by click
      expect(gvSandbox.state.GuidedView.ModeRegistry.getManualOverrideBox()).toBeTruthy();
      expect(clickEvt.preventDefault).toHaveBeenCalled();
    });

    test('Tapping when fullscreen controls are open dismisses (hides) them and suppresses bubble zoom', () => {
      const controls = document.getElementById('fullscreen-controls');
      controls.classList.remove('hidden');

      gvSandbox.state.hideFullscreenControls = jest.fn();
      const mockMode = { handleImageClick: jest.fn(() => true) };
      gvSandbox.state.GuidedView.ModeRegistry.getActiveMode = () => mockMode;

      const clickEvt = {
        clientX: 500,
        clientY: 600,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        target: document.getElementById('fullscreen-image')
      };
      gvSandbox.handleImageClick(clickEvt);

      expect(gvSandbox.state.hideFullscreenControls).toHaveBeenCalled();
      expect(mockMode.handleImageClick).not.toHaveBeenCalled();
    });

    test('Clicking a control button inside #fullscreen-controls does NOT dismiss controls', () => {
      const controls = document.getElementById('fullscreen-controls');
      controls.classList.remove('hidden');
      controls.innerHTML = `<button id="gv-zoom-btn">Mode</button>`;
      const btn = document.getElementById('gv-zoom-btn');

      gvSandbox.state.hideFullscreenControls = jest.fn();

      const clickEvt = {
        target: btn,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };
      gvSandbox.handleImageClick(clickEvt);

      expect(gvSandbox.state.hideFullscreenControls).not.toHaveBeenCalled();
      expect(clickEvt.preventDefault).not.toHaveBeenCalled();
    });

    test('Clicking on space above or below image surfaces fullscreen controls', () => {
      const controls = document.getElementById('fullscreen-controls');
      controls.classList.add('hidden');

      gvSandbox.state.showFullscreenControls = jest.fn();

      // Click below the image (image bottom is 1500, click at y=1600)
      const clickEvt = {
        clientX: 500,
        clientY: 1600,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        target: document.getElementById('fullscreen-viewer')
      };
      gvSandbox.handleImageClick(clickEvt);

      expect(gvSandbox.state.showFullscreenControls).toHaveBeenCalledWith(true);
      expect(clickEvt.stopPropagation).toHaveBeenCalled();
    });

    test('In Panel Zoom mode with object-fit contain (100vh box), clicking letterbox space above or below rendered page surfaces controls instead of zooming top/bottom panel', () => {
      const img = document.getElementById('fullscreen-image');
      // Image natural aspect ratio is 1000x1500 (2:3), so in a 600px wide x 1400px tall 100vh box:
      // renderedW = 600, renderedH = 900, renderedTop = 250, renderedBottom = 1150.
      img.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 600,
        bottom: 1400,
        width: 600,
        height: 1400
      });

      const mockPanelMode = {
        handleImageClick: jest.fn(() => true) // Would zoom panel if called!
      };
      gvSandbox.state.GuidedView.ModeRegistry.getActiveMode = () => mockPanelMode;
      gvSandbox.state.showFullscreenControls = jest.fn();

      // Click at y=100 (in the top letterbox space above renderedTop=250)
      const topClickEvt = {
        clientX: 300,
        clientY: 100,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        target: img
      };
      gvSandbox.handleImageClick(topClickEvt);

      expect(mockPanelMode.handleImageClick).not.toHaveBeenCalled();
      expect(gvSandbox.state.showFullscreenControls).toHaveBeenCalledWith(true);
      expect(topClickEvt.stopPropagation).toHaveBeenCalled();

      // Click at y=1300 (in the bottom letterbox space below renderedBottom=1150)
      gvSandbox.state.showFullscreenControls.mockClear();
      const bottomClickEvt = {
        clientX: 300,
        clientY: 1300,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        target: img
      };
      gvSandbox.handleImageClick(bottomClickEvt);

      expect(mockPanelMode.handleImageClick).not.toHaveBeenCalled();
      expect(gvSandbox.state.showFullscreenControls).toHaveBeenCalledWith(true);
      expect(bottomClickEvt.stopPropagation).toHaveBeenCalled();
    });

    test('gestures.js executes in strict mode without undeclared longPressJustFired and surfaces controls across central 80% of page', () => {
      jest.useFakeTimers();
      const strictSandbox = vm.createContext({
        window: sandbox.window,
        document,
        performance: { now: () => 5000 },
        Date,
        Math,
        setTimeout,
        clearTimeout,
        state: sandbox.state,
        canonicalGlobal: sandbox.canonicalGlobal,
        isCinemaPanningActive: () => false,
        stopCinemaPan: () => {},
        getHasDragged: () => false,
        clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
        applyFullscreenZoom: jest.fn(),
        showFullscreenControls: sandbox.state.showFullscreenControls,
        hideFullscreenControls: sandbox.state.hideFullscreenControls,
        consumeLongPressJustFired: () => false
      });

      const fullPath = path.resolve(__dirname, '../public/js/viewer/fullscreen/gestures.js');
      const content = fs.readFileSync(fullPath, 'utf8');
      const strictContent = '"use strict";\n' + content
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+let\s+/g, 'let ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+\{[\s\S]*?\};?/g, '');
      vm.runInContext(strictContent, strictSandbox);

      const img = document.getElementById('fullscreen-image');
      // Image rect: left=100, right=900, width=800.
      // Click at x=220 (15% from left edge -> inside the central 80%, outside the old 60%).
      expect(() => {
        strictSandbox.handleFullscreenImageClick({
          clientX: 220,
          clientY: 600,
          currentTarget: img,
          target: img
        });
      }).not.toThrow();

      jest.advanceTimersByTime(400);
      expect(sandbox.state.showFullscreenControls).toHaveBeenCalledWith(true);
      jest.useRealTimers();
    });

    test('browser emitting native dblclick right after touch double-tap does NOT cancel manual zoom box', () => {
      let now = 1000;
      gvSandbox.performance.now = () => now;

      // Touch tap 1
      gvSandbox.handlePointerUpForDblTap({
        pointerType: 'touch',
        button: 0,
        clientX: 500,
        clientY: 600,
        target: document.getElementById('fullscreen-image')
      });

      // Touch tap 2 200ms later -> creates box
      now += 200;
      gvSandbox.handlePointerUpForDblTap({
        pointerType: 'touch',
        button: 0,
        clientX: 502,
        clientY: 602,
        target: document.getElementById('fullscreen-image')
      });

      expect(gvSandbox.state.GuidedView.ModeRegistry.getManualOverrideBox()).toBeTruthy();

      // Browser fires dblclick 10ms later
      now += 10;
      gvSandbox.handleDoubleClickZoom({
        clientX: 502,
        clientY: 602,
        target: document.getElementById('fullscreen-image')
      });

      // Must NOT unzoom or cancel box on synthetic dblclick
      expect(gvSandbox.state.GuidedView.ModeRegistry.getManualOverrideBox()).toBeTruthy();
    });

    test('real browser flow: double-tap via gestures.js pointerup followed by input.js click on image or overlay does NOT immediately dismiss the zoom box', () => {
      let now = 2000;
      sandbox.performance.now = () => now;
      gvSandbox.performance.now = () => now;

      // Link gestures.js state and gvSandbox state like the real app
      const img = document.getElementById('fullscreen-image');
      sandbox.state.fullscreenImage = img;
      sandbox.state.fullscreenViewer = document.getElementById('fullscreen-viewer');
      sandbox.state.GuidedView = gvSandbox.state.GuidedView;
      gvSandbox.state.getLastDoubleTapAt = () => sandbox.getLastDoubleTapAt();

      const viewer = document.getElementById('fullscreen-viewer');
      const overlay = document.createElement('div');
      overlay.id = 'bubble-magnifier-overlay';
      viewer.appendChild(overlay);

      // Tap 1 pointerup (t = 2000)
      sandbox.handleFullscreenPointerUpForDblTap({
        pointerType: 'touch',
        button: 0,
        clientX: 500,
        clientY: 600,
        target: img
      });

      // Tap 2 pointerup 350ms later (within 380ms limit) -> gestures.js creates manualOverrideBox
      now += 350;
      sandbox.handleFullscreenPointerUpForDblTap({
        pointerType: 'touch',
        button: 0,
        clientX: 504,
        clientY: 604,
        target: img
      });

      expect(gvSandbox.state.GuidedView.ModeRegistry.getManualOverrideBox()).toBeTruthy();

      // 5ms later, browser dispatches Tap 2's click event (which hits #bubble-magnifier-overlay or #fullscreen-image)
      now += 5;
      gvSandbox.handleImageClick({
        clientX: 504,
        clientY: 604,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        target: overlay
      });

      // Zoom box MUST still be active and NOT dismissed by Tap 2's click!
      expect(gvSandbox.state.GuidedView.ModeRegistry.getManualOverrideBox()).toBeTruthy();
    });
  });
});
