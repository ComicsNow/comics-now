/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Continuous Reading Mode & Guided Mode Mutual Exclusion', () => {
  let sandbox;
  let state;
  let mockComic;
  let localStorageStore;

  beforeEach(() => {
    localStorageStore = {};
    const localStorageMock = {
      getItem: jest.fn(key => (key in localStorageStore ? localStorageStore[key] : null)),
      setItem: jest.fn((key, val) => { localStorageStore[key] = String(val); }),
      removeItem: jest.fn(key => { delete localStorageStore[key]; }),
      clear: jest.fn(() => { localStorageStore = {}; })
    };

    document.body.innerHTML = `
      <div id="fullscreen-viewer" class="fullscreen-viewer hidden">
        <div id="fullscreen-image"></div>
        <div id="fullscreen-pages-continuous" class="hidden"></div>
        <button id="fullscreen-continuous-mode-btn" class="fullscreen-tool-btn"></button>
        <button id="manga-guided-toggle-btn" class="active" aria-pressed="true"></button>
        <button id="western-guided-toggle-btn" class="active" aria-pressed="true"></button>
        <button id="western-speech-zoom" class="active" aria-pressed="true"></button>
        <button id="manga-panel-zoom" class="active" aria-pressed="true"></button>
        <button id="manga-speech-zoom-btn" class="active" aria-pressed="true"></button>
        <button id="fullscreen-prev-page-btn"></button>
        <button id="fullscreen-next-page-btn"></button>
      </div>
    `;

    mockComic = {
      id: 'comic-42',
      name: 'All-Star Comics #1',
      continuousMode: false,
      guidedMode: true,
      bubbleMode: false,
      hotZoomMode: false,
      mangaBubbleHotMode: false,
      guidedViewStatus: 'completed'
    };

    const disableAllMock = jest.fn();
    const updateAllUIMock = jest.fn();

    state = {
      currentComic: mockComic,
      isContinuousMode: false,
      updateComicInLibrary: jest.fn(),
      updateContinuousModeUI: jest.fn(),
      refreshGuidedToggle: jest.fn().mockResolvedValue(undefined),
      GuidedView: {
        disableAll: disableAllMock,
        updateAllUI: updateAllUIMock,
        ModeRegistry: {
          disableAll: disableAllMock,
          persistOnlyMode: jest.fn(),
          getActiveModeName: jest.fn(() => 'guided'),
          enable: jest.fn(),
          disable: jest.fn()
        }
      }
    };

    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    sandbox = {
      window: { ...window, localStorage: localStorageMock, IntersectionObserver: MockIntersectionObserver },
      document,
      localStorage: localStorageMock,
      IntersectionObserver: MockIntersectionObserver,
      state,
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      requestAnimationFrame: (cb) => cb()
    };
    vm.createContext(sandbox);

    // Load continuous.js in sandbox
    const continuousPath = path.join(__dirname, '../public/js/continuous.js');
    const continuousCode = fs.readFileSync(continuousPath, 'utf-8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[^;]+;?/g, '');
    new vm.Script(continuousCode).runInContext(sandbox);
  });

  test('1. enableContinuousMode automatically unselects any guided mode with persist=true and updates UI', async () => {
    localStorageStore['guided_pref_comic-42'] = 'guided';
    localStorageStore['guided_pref_global_active'] = 'true';

    await sandbox.enableContinuousMode();

    // ModeRegistry / GuidedView disableAll must be called with persist: true
    expect(state.GuidedView.disableAll).toHaveBeenCalledWith({ persist: true });

    // Comic guided flags must be set to false
    expect(mockComic.guidedMode).toBe(false);
    expect(mockComic.bubbleMode).toBe(false);
    expect(mockComic.hotZoomMode).toBe(false);
    expect(mockComic.mangaBubbleHotMode).toBe(false);

    // Guided preference must be stored as 'none'
    expect(sandbox.localStorage.setItem).toHaveBeenCalledWith('guided_pref_comic-42', 'none');
    expect(sandbox.localStorage.setItem).toHaveBeenCalledWith('guided_pref_global_active', 'false');

    // Comic in library must be updated
    expect(state.updateComicInLibrary).toHaveBeenCalledWith('comic-42', expect.objectContaining({
      guidedMode: false,
      bubbleMode: false,
      hotZoomMode: false,
      mangaBubbleHotMode: false
    }));

    // Guided UI buttons must be updated to unselected state
    expect(state.GuidedView.updateAllUI).toHaveBeenCalled();
  });

  test('2. clicking continuous mode button when toggling on automatically unselects any guided mode', async () => {
    mockComic.continuousMode = false;
    mockComic.bubbleMode = true;
    localStorageStore['guided_pref_comic-42'] = 'bubble';

    const btn = document.getElementById('fullscreen-continuous-mode-btn');
    btn.click();

    // Wait for async click handler
    await new Promise(r => setTimeout(r, 50));

    expect(mockComic.continuousMode).toBe(true);
    expect(mockComic.bubbleMode).toBe(false);
    expect(mockComic.guidedMode).toBe(false);
    expect(sandbox.localStorage.setItem).toHaveBeenCalledWith('guided_pref_comic-42', 'none');
    expect(state.GuidedView.disableAll).toHaveBeenCalledWith({ persist: true });
    expect(state.GuidedView.updateAllUI).toHaveBeenCalled();
  });

  test('3. ModeRegistry.enable automatically disables continuous mode if continuous mode is active', async () => {
    state.isContinuousMode = true;
    state.disableContinuousMode = jest.fn().mockResolvedValue(undefined);
    mockComic.continuousMode = true;

    // Load ModeRegistry logic
    const registryPath = path.join(__dirname, '../public/js/viewer/guided/mode-registry.js');
    const registryCode = fs.readFileSync(registryPath, 'utf-8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+ModeRegistry\s*=/g, 'const ModeRegistry =')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    new vm.Script(registryCode).runInContext(sandbox);

    const mockMode = {
      enable: jest.fn().mockResolvedValue(true),
      disable: jest.fn()
    };
    const registry = sandbox.state.GuidedView.ModeRegistry;
    registry.register('test-guided', mockMode);

    await registry.enable('test-guided');

    // Continuous mode must have been disabled
    expect(state.disableContinuousMode).toHaveBeenCalled();
    expect(mockComic.continuousMode).toBe(false);
    expect(state.updateComicInLibrary).toHaveBeenCalledWith('comic-42', { continuousMode: false });
  });

  test('4. context menu continuous toggle item unselects guided mode on comics when enabling', async () => {
    const comic1 = { id: 'c1', continuousMode: false, guidedMode: true, bubbleMode: false };
    const comic2 = { id: 'c2', continuousMode: false, guidedMode: false, bubbleMode: true };
    const comics = [comic1, comic2];

    sandbox.state.toggleContinuousMode = jest.fn((id, current) => !current);
    sandbox.createMenuItem = (html, cb) => ({ html, click: cb });
    sandbox.ICONS = { CHECKMARK: '✓', SCROLL: '📜' };
    sandbox.escapeHtml = s => s;
    sandbox.updateComicInLibrary = sandbox.state.updateComicInLibrary;
    sandbox.applyFilterAndRender = jest.fn();
    sandbox.closeContextMenu = jest.fn();

    const sharedPath = path.join(__dirname, '../public/js/context-menu/actions-shared.js');
    const sharedCode = fs.readFileSync(sharedPath, 'utf-8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    new vm.Script(sharedCode).runInContext(sandbox);

    const item = sandbox.createContinuousToggleItem(comics);
    expect(item).not.toBeNull();

    item.click();
    await new Promise(r => setTimeout(r, 50));

    expect(comic1.continuousMode).toBe(true);
    expect(comic1.guidedMode).toBe(false);
    expect(comic2.continuousMode).toBe(true);
    expect(comic2.bubbleMode).toBe(false);

    expect(sandbox.localStorage.setItem).toHaveBeenCalledWith('guided_pref_c1', 'none');
    expect(sandbox.localStorage.setItem).toHaveBeenCalledWith('guided_pref_c2', 'none');

    expect(state.updateComicInLibrary).toHaveBeenCalledWith('c1', expect.objectContaining({
      continuousMode: true,
      guidedMode: false,
      bubbleMode: false
    }));
    expect(state.updateComicInLibrary).toHaveBeenCalledWith('c2', expect.objectContaining({
      continuousMode: true,
      guidedMode: false,
      bubbleMode: false
    }));
  });

  test('5. ModeRegistry.disableAll clears activeModeName before mode.disable so refreshRender removes guided classes', () => {
    const fv = document.getElementById('fullscreen-viewer');
    fv.classList.add('guided-stage', 'guided-zoom-no-touchmenu');

    // Load actual ModeRegistry code
    const registryPath = path.join(__dirname, '../public/js/viewer/guided/mode-registry.js');
    const registryCode = fs.readFileSync(registryPath, 'utf-8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+ModeRegistry\s*=/g, 'const ModeRegistry =')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    new vm.Script(registryCode).runInContext(sandbox);

    const registry = sandbox.state.GuidedView.ModeRegistry;

    let activeDuringDisable = 'unknown';
    const mockMode = {
      enable: jest.fn().mockResolvedValue(true),
      disable: jest.fn(() => {
        activeDuringDisable = registry.getActiveModeName();
        // Simulate what mode.disable does (calls refreshRender)
        const activeNow = registry.getActiveModeName();
        if (!activeNow) {
          fv.classList.remove('guided-stage', 'guided-zoom-no-touchmenu');
        }
      })
    };

    registry.register('test-guided', mockMode);
    // Directly set active mode
    registry.enable('test-guided');

    registry.disableAll();

    // activeModeName must have been null when mode.disable() was called
    expect(activeDuringDisable).toBeNull();
    expect(fv.classList.contains('guided-stage')).toBe(false);
    expect(fv.classList.contains('guided-zoom-no-touchmenu')).toBe(false);
  });

  test('6. enableContinuousMode forcefully cleanses guided-stage, guided-zoom-no-touchmenu, and hides bubble overlay', async () => {
    const fv = document.getElementById('fullscreen-viewer');
    fv.classList.remove('hidden'); // fullscreen is active
    fv.classList.add('guided-stage', 'guided-zoom-no-touchmenu');

    const overlay = document.createElement('div');
    overlay.id = 'bubble-magnifier-overlay';
    overlay.style.display = 'block';
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
    overlay.style.touchAction = 'none';
    fv.appendChild(overlay);

    await sandbox.enableContinuousMode();

    expect(fv.classList.contains('guided-stage')).toBe(false);
    expect(fv.classList.contains('guided-zoom-no-touchmenu')).toBe(false);
    expect(overlay.style.display).toBe('none');
    expect(overlay.style.pointerEvents).toBe('none');
  });

  test('7. style.css and __guided_zoom_style exempt continuous-active so touch scrolling is not blocked', () => {
    const styleCss = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf-8');
    // .fullscreen-viewer.continuous-active must have display: block (not only :has())
    expect(styleCss).toMatch(/\.fullscreen-viewer\.continuous-active[\s\S]*?display:\s*block/);

    const guidedIndexPath = path.join(__dirname, '../public/js/viewer/guided/index.js');
    const guidedIndexCode = fs.readFileSync(guidedIndexPath, 'utf-8');
    // __guided_zoom_style must exempt continuous-active from touch-action: none
    expect(guidedIndexCode).toMatch(/continuous-active[\s\S]*?touch-action:\s*pan-y/);
  });

  test('8. refreshGuidedToggle treats comic.continuousMode as continuous and avoids enabling guided mode', async () => {
    mockComic.continuousMode = true;
    mockComic.guidedMode = true;

    // Load lifecycle.js
    const lifecyclePath = path.join(__dirname, '../public/js/viewer/guided/lifecycle.js');
    const lifecycleCode = fs.readFileSync(lifecyclePath, 'utf-8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    new vm.Script(lifecycleCode).runInContext(sandbox);

    const fv = document.getElementById('fullscreen-viewer');
    fv.classList.remove('hidden');

    sandbox.state.GuidedView.cache = new Map();
    sandbox.state.GuidedView.cache.set('comic-42', { pages: { p1: { panels: [[0, 0, 100, 100]] } } });
    sandbox.state.GuidedView.enable = jest.fn();
    sandbox.state.GuidedView.ModeRegistry.isTransitioning = jest.fn(() => false);
    sandbox.state.GuidedView.ModeRegistry.getActiveModeName = jest.fn(() => null);

    await sandbox.refreshGuidedToggle();

    // Mode must NOT be enabled
    expect(sandbox.state.GuidedView.enable).not.toHaveBeenCalled();
    expect(mockComic.guidedMode).toBe(false);
    expect(fv.classList.contains('guided-stage')).toBe(false);
    expect(fv.classList.contains('guided-zoom-no-touchmenu')).toBe(false);
  });
});
