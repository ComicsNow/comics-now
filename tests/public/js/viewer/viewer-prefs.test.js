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

describe('Viewer per-comic preference toggles: legacy endpoints removed (8a5d7f9)', () => {
  let sandbox;
  let storage;

  beforeEach(() => {
    storage = {};
    sandbox = {
      window: {},
      document: {
        getElementById: jest.fn(() => null),
        querySelector: jest.fn(() => null),
        readyState: 'complete'
      },
      state: { isFullImageMode: false, isLandscapeOrientation: false },
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      fetch: jest.fn(() => Promise.resolve({ ok: true })),
      localStorage: {
        getItem: jest.fn((k) => (k in storage ? storage[k] : null)),
        setItem: jest.fn((k, v) => { storage[k] = String(v); }),
        removeItem: jest.fn((k) => { delete storage[k]; })
      },
      innerHeight: 800
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
  });

  describe('full-image.js setFullImageMode', () => {
    test('updates local state and comic object WITHOUT calling the legacy /full-image-mode endpoint', async () => {
      loadModuleInVm('public/js/viewer/full-image.js', sandbox);
      sandbox.currentComic = { id: 42 };

      await sandbox.setFullImageMode(true);

      expect(sandbox.state.isFullImageMode).toBe(true);
      expect(sandbox.currentComic.fullImageMode).toBe(true);
      expect(sandbox.fetch).not.toHaveBeenCalled();
    });

    test('persist:false updates local state but leaves the comic object untouched', async () => {
      loadModuleInVm('public/js/viewer/full-image.js', sandbox);
      sandbox.currentComic = { id: 42 };

      await sandbox.setFullImageMode(false, { persist: false });

      expect(sandbox.state.isFullImageMode).toBe(false);
      expect(sandbox.currentComic.fullImageMode).toBeUndefined();
      expect(sandbox.fetch).not.toHaveBeenCalled();
    });

    test('persists per-comic preference to localStorage on enable', async () => {
      loadModuleInVm('public/js/viewer/full-image.js', sandbox);
      sandbox.currentComic = { id: 42 };

      await sandbox.setFullImageMode(true);

      expect(storage['full_image_pref_42']).toBe('true');
    });

    test('persists per-comic preference to localStorage on disable', async () => {
      loadModuleInVm('public/js/viewer/full-image.js', sandbox);
      sandbox.currentComic = { id: 42 };

      await sandbox.setFullImageMode(false);

      expect(storage['full_image_pref_42']).toBe('false');
    });

    test('persist:false does not write to localStorage', async () => {
      loadModuleInVm('public/js/viewer/full-image.js', sandbox);
      sandbox.currentComic = { id: 42 };

      await sandbox.setFullImageMode(true, { persist: false });

      expect(sandbox.localStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('full-image.js resolveFullImagePreference', () => {
    test('prefers localStorage over the comic field', () => {
      loadModuleInVm('public/js/viewer/full-image.js', sandbox);
      storage['full_image_pref_42'] = 'false';

      expect(sandbox.resolveFullImagePreference({ id: 42, fullImageMode: 1 })).toBe(false);
    });

    test('falls back to the comic field when localStorage has no entry', () => {
      loadModuleInVm('public/js/viewer/full-image.js', sandbox);

      expect(sandbox.resolveFullImagePreference({ id: 42, fullImageMode: 1 })).toBe(true);
      expect(sandbox.resolveFullImagePreference({ id: 42, fullImageMode: 0 })).toBe(false);
    });

    test('returns false when neither localStorage nor comic field is set', () => {
      loadModuleInVm('public/js/viewer/full-image.js', sandbox);

      expect(sandbox.resolveFullImagePreference({ id: 42 })).toBe(false);
      expect(sandbox.resolveFullImagePreference(null)).toBe(false);
    });
  });

  describe('ui-orientation.js setOrientationMode', () => {
    test('updates local state and comic object WITHOUT calling the legacy /landscape-mode endpoint', async () => {
      loadModuleInVm('public/js/viewer/ui-orientation.js', sandbox);
      sandbox.currentComic = { id: 42 };

      sandbox.setOrientationMode('landscape');

      expect(sandbox.state.isLandscapeOrientation).toBe(true);
      expect(sandbox.currentComic.landscapeMode).toBe(true);
      expect(sandbox.fetch).not.toHaveBeenCalled();
    });

    test('persist:false updates local state but leaves the comic object untouched', () => {
      loadModuleInVm('public/js/viewer/ui-orientation.js', sandbox);
      sandbox.currentComic = { id: 42 };

      sandbox.setOrientationMode('portrait', { persist: false });

      expect(sandbox.state.isLandscapeOrientation).toBe(false);
      expect(sandbox.currentComic.landscapeMode).toBeUndefined();
      expect(sandbox.fetch).not.toHaveBeenCalled();
    });

    test('persists per-comic preference to localStorage on landscape', () => {
      loadModuleInVm('public/js/viewer/ui-orientation.js', sandbox);
      sandbox.currentComic = { id: 42 };

      sandbox.setOrientationMode('landscape');

      expect(storage['landscape_pref_42']).toBe('true');
    });

    test('persists per-comic preference to localStorage on portrait', () => {
      loadModuleInVm('public/js/viewer/ui-orientation.js', sandbox);
      sandbox.currentComic = { id: 42 };

      sandbox.setOrientationMode('landscape');
      sandbox.setOrientationMode('portrait');

      expect(storage['landscape_pref_42']).toBe('false');
    });

    test('persist:false does not write to localStorage', () => {
      loadModuleInVm('public/js/viewer/ui-orientation.js', sandbox);
      sandbox.currentComic = { id: 42 };

      sandbox.setOrientationMode('landscape', { persist: false });

      expect(sandbox.localStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('ui-orientation.js resolveLandscapePreference', () => {
    test('prefers localStorage over the comic field', () => {
      loadModuleInVm('public/js/viewer/ui-orientation.js', sandbox);
      storage['landscape_pref_42'] = 'true';

      expect(sandbox.resolveLandscapePreference({ id: 42, landscapeMode: 0 })).toBe(true);
    });

    test('falls back to the comic field when localStorage has no entry', () => {
      loadModuleInVm('public/js/viewer/ui-orientation.js', sandbox);

      expect(sandbox.resolveLandscapePreference({ id: 42, landscapeMode: 1 })).toBe(true);
      expect(sandbox.resolveLandscapePreference({ id: 42, landscapeMode: 0 })).toBe(false);
    });

    test('returns false when neither localStorage nor comic field is set', () => {
      loadModuleInVm('public/js/viewer/ui-orientation.js', sandbox);

      expect(sandbox.resolveLandscapePreference({ id: 42 })).toBe(false);
      expect(sandbox.resolveLandscapePreference(null)).toBe(false);
    });
  });
});
