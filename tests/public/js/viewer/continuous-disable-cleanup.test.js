/**
 * @jest-environment jsdom
 */

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

describe('disableContinuousMode fully exits continuous mode even when the viewer is already hidden', () => {
  let sandbox;
  let state;
  let prevBtn;
  let nextBtn;
  let origPrevHandler;
  let origNextHandler;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="fullscreen-viewer" class="continuous-active hidden"></div>
      <img id="fullscreen-image" class="hidden" src="page.jpg">
      <div id="fullscreen-pages-continuous"></div>
      <button id="fullscreen-prev-page-btn">↑</button>
      <button id="fullscreen-next-page-btn">↓</button>
      <div id="fullscreen-nav-left"></div>
      <div id="fullscreen-nav-right"></div>
    `;

    state = {
      currentComic: { id: 'comic-123' },
      updateComicInLibrary: jest.fn(),
      renderPage: jest.fn(async () => {})
    };
    const actions = {
      viewer: { setContinuousMode: jest.fn() }
    };

    sandbox = {
      window: { ...window, HTMLElement: window.HTMLElement },
      document,
      state,
      actions,
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      localStorage: { getItem: jest.fn(() => null), setItem: jest.fn() },
      updateContinuousModeUI: jest.fn(),
      updateContinuousModeInCache: jest.fn(async () => {}),
      scrollToNextPage: jest.fn(),
      scrollToPreviousPage: jest.fn(),
      initIntersectionObserver: jest.fn(),
      renderContinuousMode: jest.fn(async () => {})
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    loadModuleInVm('public/js/continuous/state.js', sandbox);

    // Leave continuous mode state exactly as enableContinuousMode would have
    // (then closeFullscreen hid the viewer before calling disableContinuousMode).
    const container = document.getElementById('fullscreen-pages-continuous');
    sandbox.continuousState.isContinuousMode = true;
    sandbox.continuousState.continuousContainer = container;
    container.classList.remove('hidden');
    sandbox.continuousState.continuousClickHandler = () => {};
    container.addEventListener('click', sandbox.continuousState.continuousClickHandler);

    prevBtn = document.getElementById('fullscreen-prev-page-btn');
    nextBtn = document.getElementById('fullscreen-next-page-btn');
    origPrevHandler = jest.fn();
    origNextHandler = jest.fn();
    prevBtn._navListener = origPrevHandler;
    nextBtn._navListener = origNextHandler;
    prevBtn._continuousListener = jest.fn();
    nextBtn._continuousListener = jest.fn();
    prevBtn.addEventListener('click', prevBtn._continuousListener);
    nextBtn.addEventListener('click', nextBtn._continuousListener);
    sandbox.continuousState.originalNavigationState = {
      prevBtnText: '←',
      nextBtnText: '→',
      prevBtnHandler: origPrevHandler,
      nextBtnHandler: origNextHandler,
      navLeftHandler: null,
      navRightHandler: null
    };

    sandbox.continuousState.intersectionObserver = { disconnect: jest.fn() };

    loadModuleInVm('public/js/continuous/lifecycle.js', sandbox);
  });

  test('cleans up continuous DOM state when the viewer is already hidden', async () => {
    await sandbox.disableContinuousMode();

    const viewer = document.getElementById('fullscreen-viewer');
    expect(viewer.classList.contains('continuous-active')).toBe(false);

    const image = document.getElementById('fullscreen-image');
    expect(image.classList.contains('hidden')).toBe(false);

    const container = document.getElementById('fullscreen-pages-continuous');
    expect(container.classList.contains('hidden')).toBe(true);

    expect(sandbox.continuousState.isContinuousMode).toBe(false);
    expect(sandbox.continuousState.continuousClickHandler).toBeNull();
    expect(sandbox.continuousState.intersectionObserver.disconnect).toHaveBeenCalled();
    expect(state.updateComicInLibrary).toHaveBeenCalledWith('comic-123', { continuousMode: false });
  });

  test('restores original prev/next navigation handlers', async () => {
    await sandbox.disableContinuousMode();

    expect(prevBtn._continuousListener).toBeNull();
    expect(nextBtn._continuousListener).toBeNull();
    expect(prevBtn.textContent).toBe('←');
    expect(nextBtn.textContent).toBe('→');
    prevBtn.click();
    nextBtn.click();
    expect(origPrevHandler).toHaveBeenCalled();
    expect(origNextHandler).toHaveBeenCalled();
  });

  test('does not re-render the single page while the viewer is hidden', async () => {
    await sandbox.disableContinuousMode();

    expect(state.renderPage).not.toHaveBeenCalled();
  });

  test('re-renders the single page when the viewer is still visible', async () => {
    document.getElementById('fullscreen-viewer').classList.remove('hidden');

    await sandbox.disableContinuousMode();

    expect(state.renderPage).toHaveBeenCalled();
  });
});
