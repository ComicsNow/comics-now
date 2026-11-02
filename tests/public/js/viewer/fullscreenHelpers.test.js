const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModuleInVm(relPath, sandbox) {
  const fullPath = path.resolve(__dirname, '../../../..', relPath);
  const content = fs.readFileSync(fullPath, 'utf8');

  const cleanContent = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+class\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = class $1')
    .replace(/export\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = function $1')
    .replace(/export\s+async\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = async function $1')
    .replace(/export\s+const\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+let\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/\bconst\s+/g, 'var ')
    .replace(/\blet\s+/g, 'var ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');

  const script = new vm.Script(cleanContent);
  script.runInContext(sandbox);
}

describe('Fullscreen Submodules Unit Tests (TDD Harness)', () => {
  let sandbox;
  let state;

  beforeEach(() => {
    state = {
      isLandscapeOrientation: true,
      isFullImageMode: false,
      GuidedView: null,
      fullscreenImage: {
        style: {},
        naturalWidth: 1000,
        naturalHeight: 1500
      }
    };

    sandbox = {
      window: {},
      document: {
        getElementById: jest.fn(() => null),
        querySelector: jest.fn(() => null)
      },
      state,
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
  });

  describe('zoom.js & pan.js: Geometry & Bounds', () => {
    test('clamp restricts numbers within min and max boundaries', () => {
      loadModuleInVm('public/js/viewer/fullscreen/zoom.js', sandbox);
      const clamp = sandbox.clamp;
      expect(clamp(5, 1, 10)).toBe(5);
      expect(clamp(0, 1, 10)).toBe(1);
      expect(clamp(15, 1, 10)).toBe(10);
      expect(clamp(-5, -2, 4)).toBe(-2);
    });

    test('getDistanceBetweenPoints computes Euclidean distance correctly', () => {
      loadModuleInVm('public/js/viewer/fullscreen/zoom.js', sandbox);
      loadModuleInVm('public/js/viewer/fullscreen/pan.js', sandbox);
      const getDistanceBetweenPoints = sandbox.getDistanceBetweenPoints;
      expect(getDistanceBetweenPoints({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
      expect(getDistanceBetweenPoints({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
      expect(getDistanceBetweenPoints(null, { x: 2, y: 2 })).toBe(0);
      expect(getDistanceBetweenPoints({ x: 2, y: 2 }, null)).toBe(0);
    });
  });

  describe('controls.js: Constants & Title Sanitization', () => {
    test('FULLSCREEN_CONTROLS_AUTOHIDE_DELAY is 3000ms', () => {
      loadModuleInVm('public/js/viewer/fullscreen/controls.js', sandbox);
      expect(sandbox.FULLSCREEN_CONTROLS_AUTOHIDE_DELAY).toBe(3000);
    });

    test('sanitizeComicTitleLocal cleans extensions, dirty release tags, and leading issue numbers', () => {
      loadModuleInVm('public/js/viewer/fullscreen/controls.js', sandbox);
      const sanitizeComicTitleLocal = sandbox.sanitizeComicTitleLocal;
      expect(sanitizeComicTitleLocal('Batman 001.cbz')).toBe('Batman 001');
      expect(sanitizeComicTitleLocal('[Group] Action Comics #1000 (2018).cbr')).toBe('Action Comics #1000 (2018)');
      expect(sanitizeComicTitleLocal('01_Amazing_Spider-Man_01.cbz')).toBe('Amazing Spider-Man 01');
      expect(sanitizeComicTitleLocal('Special_Edition.pdf')).toBe('Special Edition');
      expect(sanitizeComicTitleLocal('')).toBe('');
      expect(sanitizeComicTitleLocal(null)).toBe('');
    });

    test('getCleanComicTitle extracts and sanitizes title from comic object', () => {
      loadModuleInVm('public/js/viewer/fullscreen/controls.js', sandbox);
      const getCleanComicTitle = sandbox.getCleanComicTitle;
      expect(getCleanComicTitle({ displayName: 'X-Men #1.cbz' })).toBe('X-Men #1');
      expect(getCleanComicTitle({ name: 'Detective Comics #27.cbz' })).toBe('Detective Comics #27');
      expect(getCleanComicTitle({ series: 'Saga' })).toBe('Saga');
      expect(getCleanComicTitle(null)).toBe('');
    });
  });

  describe('landscape-pan.js: Orientation & Free-Pan State', () => {
    test('isLandscapePanActive returns true only in landscape orientation when not in full-image or guided mode', () => {
      loadModuleInVm('public/js/viewer/fullscreen/landscape-pan.js', sandbox);
      const isLandscapePanActive = sandbox.isLandscapePanActive;

      state.isLandscapeOrientation = true;
      state.isFullImageMode = false;
      state.GuidedView = null;
      expect(isLandscapePanActive()).toBe(true);

      state.isLandscapeOrientation = false;
      expect(isLandscapePanActive()).toBe(false);

      state.isLandscapeOrientation = true;
      state.isFullImageMode = true;
      expect(isLandscapePanActive()).toBe(false);

      state.isFullImageMode = false;
      state.GuidedView = { isActive: () => true };
      expect(isLandscapePanActive()).toBe(false);
    });
  });
});
