/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = [
  'guided/geometry.js',
  'guided/data.js',
  'guided/bubble-placement.js',
  'guided/mode-registry.js',
  'guided/overlay.js',
  'guided/pan.js',
  'guided/hotspot-arbitration.js',
  'guided/modes/western-speech-zoom.js',
  'guided/modes/manga-speech-zoom.js',
  'guided/modes/manga-panel-zoom.js',
  'guided/input.js',
  'guided/index.js',
  'fullscreen/long-press.js'
];

// Image box 600x800 holding a 400x800 image => pillarbox bars of 100px each side.
// Drawn image spans client x 100..500, so natural x = clientX - 100 (scale 1).
const SPEECH_BUBBLES = [[10, 100, 80, 40], [56, 300, 60, 40]];

function stripModuleSyntax(content) {
  return content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+const\s+/g, 'var ')
    .replace(/export\s+let\s+/g, 'var ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/\bconst\s+/g, 'var ')
    .replace(/\blet\s+/g, 'var ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');
}

function buildEnv({ manga = false, modeName = 'western-speech-zoom' } = {}) {
  document.body.innerHTML = `
    <div id="fullscreen-viewer" class="fullscreen-fit-mode">
      <div id="fullscreen-nav-left" class="fullscreen-nav left"></div>
      <div id="fullscreen-nav-right" class="fullscreen-nav right"></div>
      <img id="fullscreen-image" src="test.jpg" />
      <div id="fullscreen-controls" class="hidden"></div>
    </div>`;
  const img = document.getElementById('fullscreen-image');
  Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true });
  Object.defineProperty(img, 'clientWidth', { value: 400, configurable: true });
  Object.defineProperty(img, 'clientHeight', { value: 800, configurable: true });
  img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800 });

  const state = {
    currentView: 'root',
    fullscreenPage: 0,
    GuidedView: {},
    fullscreenNavLeft: document.getElementById('fullscreen-nav-left'),
    fullscreenNavRight: document.getElementById('fullscreen-nav-right'),
    navigatePage: jest.fn(),
    cancelPendingSideNav: jest.fn(),
    hideFullscreenControls: jest.fn(),
    showFullscreenControls: jest.fn(),
    triggerEinkFlash: jest.fn(),
    isFullscreenZoomed: false,
    isContinuousMode: false,
    isFullImageMode: false
  };
  const sandbox = {
    window, document, state, console, fetch: jest.fn(),
    global: state, canonicalGlobal: state,
    navigator: { vibrate: jest.fn() },
    performance: { now: () => Date.now() },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Date,
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a)
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const only = FILES.filter((f) => fs.existsSync(path.resolve(__dirname, '../public/js/viewer', f)));
  only.forEach((f) => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/viewer', f), 'utf8');
    new vm.Script(stripModuleSyntax(src)).runInContext(sandbox);
  });

  const view = state.GuidedView;
  view.isFullscreenOpen = () => true;
  ['Bubble', 'WesternSpeechZoom', 'MangaPanelZoom', 'MangaSpeechZoom'].forEach((n) => {
    view[`update${n}UI`] = jest.fn();
  });
  view.ModeRegistry.persistOnlyMode = jest.fn();
  state.currentComic = { id: 'c1', mangaMode: manga, guidedViewStatus: 'completed' };
  state.getViewerPages = () => ['p1.jpg'];
  state.currentPageIndex = 0;
  view.cache.set('c1', {
    pages: { 'p1.jpg': { panels: [[0, 0, 400, 800]], bubbles: SPEECH_BUBBLES, sequence: SPEECH_BUBBLES } }
  });
  if (typeof state.bindFullscreenLongPress === 'function') state.bindFullscreenLongPress();
  return { sandbox, state, view, modeName };
}

async function activate(env, modeName) {
  const ok = await env.view.ModeRegistry.enable(modeName);
  expect(ok).toBe(true);
}

function click(target, x, y) {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  ev.stopPropagation = jest.fn(ev.stopPropagation.bind(ev));
  target.dispatchEvent(ev);
  return ev;
}

function pointer(target, type, x, y, pointerType = 'touch') {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  Object.defineProperty(ev, 'pointerId', { value: 7 });
  target.dispatchEvent(ev);
  return ev;
}

const navLeft = () => document.getElementById('fullscreen-nav-left');
const navRight = () => document.getElementById('fullscreen-nav-right');
const flush = () => jest.advanceTimersByTime(600);

// Client coordinates: bubble 0 center (140,120); bubble 1 spans x 156..216, y 300..340.
const ON_BUBBLE = [140, 120];
const EMPTY_EDGE = [120, 600];

describe('Edge hotspot vs speech bubble arbitration', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const speechModes = [
    ['western-speech-zoom', false],
    ['manga-speech-zoom', true]
  ];

  describe.each(speechModes)('%s', (modeName, manga) => {
    test.each([['left', navLeft], ['right', navRight]])('edge bubble tap on %s hotspot zooms bubble, no page turn', async (_s, getNav) => {
      const env = buildEnv({ manga });
      await activate(env, modeName);
      const ev = click(getNav(), ...ON_BUBBLE);
      flush();
      expect(env.state.navigatePage).not.toHaveBeenCalled();
      expect(env.state.cancelPendingSideNav).toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(true);
      expect(ev.stopPropagation).toHaveBeenCalled();
      expect(env.view.ModeRegistry.getActiveMode().getRenderState().targetBox).toEqual(SPEECH_BUBBLES[0]);
    });

    test('empty edge space turns the page', async () => {
      const env = buildEnv({ manga });
      await activate(env, modeName);
      click(navLeft(), ...EMPTY_EDGE);
      flush();
      expect(env.state.navigatePage).toHaveBeenCalledTimes(1);
    });

    test('pillarbox bar tap turns the page and never opens controls', async () => {
      const env = buildEnv({ manga });
      await activate(env, modeName);
      click(navLeft(), 50, 120);
      flush();
      expect(env.state.navigatePage).toHaveBeenCalledTimes(1);
      expect(env.state.showFullscreenControls).not.toHaveBeenCalledWith(true);
    });

    test('tight 6px pad: 18px away turns page, 4px away zooms bubble', async () => {
      const env = buildEnv({ manga });
      await activate(env, modeName);
      // bubble 1 starts at natural x=56 (client 156)
      click(navLeft(), 138, 320);
      flush();
      expect(env.state.navigatePage).toHaveBeenCalledTimes(1);
      env.state.navigatePage.mockClear();
      click(navLeft(), 152, 320);
      flush();
      expect(env.state.navigatePage).not.toHaveBeenCalled();
      expect(env.view.ModeRegistry.getActiveMode().getRenderState().targetBox).toEqual(SPEECH_BUBBLES[1]);
    });

    test('long press over edge bubble does not navigate or vibrate; empty edge does', async () => {
      const env = buildEnv({ manga });
      await activate(env, modeName);
      pointer(navLeft(), 'pointerdown', ...ON_BUBBLE);
      jest.advanceTimersByTime(300);
      expect(env.state.navigatePage).not.toHaveBeenCalled();
      expect(env.sandbox.navigator.vibrate).not.toHaveBeenCalled();
      pointer(navLeft(), 'pointerup', ...ON_BUBBLE);

      pointer(navRight(), 'pointerdown', ...EMPTY_EDGE);
      jest.advanceTimersByTime(300);
      expect(env.state.navigatePage).toHaveBeenCalledTimes(1);
    });

    test('mouse hover toggles bubble-target cursor class; touch never does', async () => {
      const env = buildEnv({ manga });
      await activate(env, modeName);
      pointer(navLeft(), 'pointermove', ...ON_BUBBLE, 'touch');
      expect(navLeft().classList.contains('fullscreen-nav--bubble-target')).toBe(false);
      pointer(navLeft(), 'pointermove', ...ON_BUBBLE, 'mouse');
      expect(navLeft().classList.contains('fullscreen-nav--bubble-target')).toBe(true);
      pointer(navLeft(), 'pointermove', ...EMPTY_EDGE, 'mouse');
      expect(navLeft().classList.contains('fullscreen-nav--bubble-target')).toBe(false);
      pointer(navLeft(), 'pointermove', ...ON_BUBBLE, 'mouse');
      pointer(navLeft(), 'pointerleave', ...ON_BUBBLE, 'mouse');
      expect(navLeft().classList.contains('fullscreen-nav--bubble-target')).toBe(false);
    });
  });

  describe('manga-panel-zoom (bubbles only, never panels)', () => {
    test('edge bubble zooms bubble; edge panel without bubble turns page; no NaN with 0 pad', async () => {
      const env = buildEnv({ manga: true });
      await activate(env, 'manga-panel-zoom');
      const ev = click(navRight(), ...ON_BUBBLE);
      flush();
      expect(env.state.navigatePage).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(true);
      expect(env.view.ModeRegistry.getActiveMode().getRenderState().targetBox).toEqual(SPEECH_BUBBLES[0]);

      click(navRight(), ...EMPTY_EDGE); // inside panel [0,0,400,800] only
      flush();
      expect(env.state.navigatePage).toHaveBeenCalledTimes(1);
    });

    test('exact hits only (0px pad) and findBubbleAtPoint never yields NaN', async () => {
      const env = buildEnv({ manga: true });
      await activate(env, 'manga-panel-zoom');
      expect(env.view.hasEdgeBubbleAtClient(152, 320)).toBe(false); // 4px away
      expect(env.view.hasEdgeBubbleAtClient(160, 320)).toBe(true);
      expect(env.view.findBubbleAtPoint(SPEECH_BUBBLES, 52, 320, { hitPadX: 0, hitPadY: 0 })).toBe(-1);
    });
  });

  describe('normal fullscreen and guards', () => {
    test('no active mode: bubble coordinates still turn the page', () => {
      const env = buildEnv();
      click(navLeft(), ...ON_BUBBLE);
      flush();
      expect(env.state.navigatePage).toHaveBeenCalledTimes(1);
      expect(env.view.hasEdgeBubbleAtClient(...ON_BUBBLE)).toBe(false);
    });

    test('controls open: edge click hides controls, hasEdgeBubbleAtClient is false', async () => {
      const env = buildEnv();
      await activate(env, 'western-speech-zoom');
      document.getElementById('fullscreen-controls').classList.remove('hidden');
      expect(env.view.hasEdgeBubbleAtClient(...ON_BUBBLE)).toBe(false);
      click(navLeft(), ...ON_BUBBLE);
      flush();
      expect(env.state.hideFullscreenControls).toHaveBeenCalled();
      expect(env.state.navigatePage).not.toHaveBeenCalled();
    });

    test('zoomed, continuous, full-image states disable arbitration', async () => {
      const env = buildEnv();
      await activate(env, 'western-speech-zoom');
      ['isFullscreenZoomed', 'isContinuousMode', 'isFullImageMode'].forEach((flag) => {
        env.state[flag] = true;
        expect(env.view.hasEdgeBubbleAtClient(...ON_BUBBLE)).toBe(false);
        env.state[flag] = false;
      });
      expect(env.view.hasEdgeBubbleAtClient(...ON_BUBBLE)).toBe(true);
    });

    test('open magnifier overlay covering the point blocks match and dismisses on click', async () => {
      const env = buildEnv();
      await activate(env, 'western-speech-zoom');
      const overlay = document.createElement('div');
      overlay.id = 'bubble-magnifier-overlay';
      overlay.innerHTML = '<img id="bubble-magnifier-img" />';
      document.getElementById('fullscreen-viewer').appendChild(overlay);
      overlay.getBoundingClientRect = () => ({ left: 100, top: 90, right: 200, bottom: 150, width: 100, height: 60 });
      expect(env.view.hasEdgeBubbleAtClient(...ON_BUBBLE)).toBe(false);
      const ev = click(overlay, ...ON_BUBBLE);
      flush();
      expect(ev.defaultPrevented).toBe(true);
      expect(env.state.navigatePage).not.toHaveBeenCalled();
    });

    test('open magnifier elsewhere still lets an uncovered edge bubble match', async () => {
      const env = buildEnv();
      await activate(env, 'western-speech-zoom');
      const overlay = document.createElement('div');
      overlay.id = 'bubble-magnifier-overlay';
      overlay.innerHTML = '<img id="bubble-magnifier-img" />';
      document.getElementById('fullscreen-viewer').appendChild(overlay);
      overlay.getBoundingClientRect = () => ({ left: 300, top: 600, right: 400, bottom: 660, width: 100, height: 60 });
      expect(env.view.hasEdgeBubbleAtClient(...ON_BUBBLE)).toBe(true);
      click(navLeft(), ...ON_BUBBLE);
      flush();
      expect(env.state.navigatePage).not.toHaveBeenCalled();
    });

    test('refreshRender and clearHotspotBubbleCursor clear the cursor class', async () => {
      const env = buildEnv();
      await activate(env, 'western-speech-zoom');
      pointer(navLeft(), 'pointermove', ...ON_BUBBLE, 'mouse');
      expect(navLeft().classList.contains('fullscreen-nav--bubble-target')).toBe(true);
      env.view.refreshRender();
      expect(navLeft().classList.contains('fullscreen-nav--bubble-target')).toBe(false);
      pointer(navLeft(), 'pointermove', ...ON_BUBBLE, 'mouse');
      env.state.clearHotspotBubbleCursor();
      expect(navLeft().classList.contains('fullscreen-nav--bubble-target')).toBe(false);
    });

    test('double-tap zoom on edge hotspot cancels side nav and sets manual override box', async () => {
      const env = buildEnv();
      await activate(env, 'western-speech-zoom');
      env.view.handleDoubleClickZoom({
        type: 'dblclick', clientX: 120, clientY: 600, target: navLeft(),
        preventDefault: jest.fn(), stopPropagation: jest.fn()
      });
      expect(env.state.cancelPendingSideNav).toHaveBeenCalled();
      expect(env.view.ModeRegistry.getManualOverrideBox()).not.toBeNull();
    });
  });
});
