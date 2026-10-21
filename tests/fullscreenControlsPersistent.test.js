/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Fullscreen Immersive HUD & Clean Display Title', () => {
  let sandbox;
  let state;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="fullscreen-viewer" class="fullscreen-viewer hidden">
        <div id="fullscreen-title" class="fullscreen-title hidden" role="heading" aria-level="2"></div>
        <button id="fullscreen-close-btn" class="fullscreen-close-button hidden" type="button">
          <span aria-hidden="true">&times;</span>
        </button>
        <div id="fullscreen-info-bar" class="fullscreen-info-bar hidden"></div>
        <div id="fullscreen-controls" class="fullscreen-controls hidden"></div>
        <img id="fullscreen-image" src="test.jpg" />
        <div id="fullscreen-scrubber-container" class="hidden"></div>
      </div>
    `;

    state = {
      fullscreenViewer: document.getElementById('fullscreen-viewer'),
      fullscreenTitle: document.getElementById('fullscreen-title'),
      fullscreenCloseBtn: document.getElementById('fullscreen-close-btn'),
      fullscreenInfoBar: document.getElementById('fullscreen-info-bar'),
      fullscreenControls: document.getElementById('fullscreen-controls'),
      fullscreenImage: document.getElementById('fullscreen-image'),
      currentComic: { name: '01 Future Heroes [215 INK] (2015) #86.cbz', series: 'Future Heroes' },
      currentPageIndex: 0,
      resetFullscreenZoom: jest.fn(),
      renderPage: jest.fn().mockResolvedValue(undefined),
      applyFullscreenFitMode: jest.fn()
    };

    sandbox = {
      window,
      document,
      state,
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    vm.createContext(sandbox);

    const filePath = path.join(__dirname, '../public/js/viewer/fullscreen.js');
    const code = fs.readFileSync(filePath, 'utf-8');
    const cleanContent = code
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[^;]+;?/g, '');
    new vm.Script(cleanContent).runInContext(sandbox);
  });

  test('hideFullscreenControls hides all HUD chrome for edge-to-edge immersive reading', () => {
    const titleEl = document.getElementById('fullscreen-title');
    const closeBtn = document.getElementById('fullscreen-close-btn');
    const infoBar = document.getElementById('fullscreen-info-bar');
    const controls = document.getElementById('fullscreen-controls');

    // Show controls first
    sandbox.showFullscreenControls(false);
    expect(controls.classList.contains('hidden')).toBe(false);
    expect(titleEl.classList.contains('hidden')).toBe(false);
    expect(closeBtn.classList.contains('hidden')).toBe(false);
    expect(infoBar.classList.contains('hidden')).toBe(false);

    // Call hideFullscreenControls
    sandbox.hideFullscreenControls();

    // All HUD elements must be hidden for full-screen edge-to-edge reading
    expect(controls.classList.contains('hidden')).toBe(true);
    expect(titleEl.classList.contains('hidden')).toBe(true);
    expect(closeBtn.classList.contains('hidden')).toBe(true);
    expect(infoBar.classList.contains('hidden')).toBe(true);
  });

  test('toggleFullscreenHUD toggles between visible and hidden', () => {
    const titleEl = document.getElementById('fullscreen-title');
    const controls = document.getElementById('fullscreen-controls');

    // Initially controls are hidden
    sandbox.hideFullscreenControls();
    expect(controls.classList.contains('hidden')).toBe(true);

    // First toggle: shows HUD
    sandbox.toggleFullscreenHUD();
    expect(controls.classList.contains('hidden')).toBe(false);
    expect(titleEl.classList.contains('hidden')).toBe(false);

    // Second toggle: hides HUD
    sandbox.toggleFullscreenHUD();
    expect(controls.classList.contains('hidden')).toBe(true);
    expect(titleEl.classList.contains('hidden')).toBe(true);
  });

  test('auto-hide timer hides all HUD elements after timeout', () => {
    jest.useFakeTimers();
    try {
      const titleEl = document.getElementById('fullscreen-title');
      const closeBtn = document.getElementById('fullscreen-close-btn');
      const infoBar = document.getElementById('fullscreen-info-bar');
      const controls = document.getElementById('fullscreen-controls');

      sandbox.showFullscreenControls(true);
      expect(controls.classList.contains('hidden')).toBe(false);
      expect(titleEl.classList.contains('hidden')).toBe(false);
      expect(closeBtn.classList.contains('hidden')).toBe(false);
      expect(infoBar.classList.contains('hidden')).toBe(false);

      // Fast-forward past the autohide delay (3000ms)
      jest.advanceTimersByTime(3500);

      // All HUD elements must be hidden after timeout
      expect(controls.classList.contains('hidden')).toBe(true);
      expect(titleEl.classList.contains('hidden')).toBe(true);
      expect(closeBtn.classList.contains('hidden')).toBe(true);
      expect(infoBar.classList.contains('hidden')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('syncFullscreenTitle cleans raw filenames with archive extensions, tags, and track numbers', () => {
    const titleEl = document.getElementById('fullscreen-title');
    state.currentComic = { name: '01 Future Heroes [215 INK] (2015) #86.cbz', series: 'Future Heroes' };

    sandbox.syncFullscreenTitle();
    expect(titleEl.textContent).toBe('Future Heroes #86');
  });

  test('syncFullscreenTitle utilizes applyDisplayInfoToComic when available', () => {
    const titleEl = document.getElementById('fullscreen-title');
    state.currentComic = {
      name: '01 Future Heroes [215 INK] (2015) #86.cbz',
      series: 'Future Heroes',
      metadata: { Number: '86', Series: 'Future Heroes' }
    };
    state.applyDisplayInfoToComic = jest.fn((comic) => ({
      displayTitle: `${comic.metadata.Series} #${comic.metadata.Number}`
    }));

    sandbox.syncFullscreenTitle();
    expect(state.applyDisplayInfoToComic).toHaveBeenCalledWith(state.currentComic);
    expect(titleEl.textContent).toBe('Future Heroes #86');
  });

  test('openFullscreen displays sanitized clean title and initial HUD with autohide', () => {
    const titleEl = document.getElementById('fullscreen-title');
    const closeBtn = document.getElementById('fullscreen-close-btn');

    titleEl.classList.add('hidden');
    closeBtn.classList.add('hidden');

    state.currentComic = { name: '01 Future Heroes [215 INK] (2015) #86.cbz', series: 'Future Heroes' };
    sandbox.openFullscreen();

    expect(titleEl.classList.contains('hidden')).toBe(false);
    expect(closeBtn.classList.contains('hidden')).toBe(false);
    expect(titleEl.textContent).toBe('Future Heroes #86');
  });

  test('zoom overlay has higher z-index in style.css than fullscreen title and close button', () => {
    const cssPath = path.join(__dirname, '../public/style.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    const titleMatch = css.match(/\.fullscreen-title\s*\{[^}]*z-index:\s*(\d+)/);
    const closeBtnMatch = css.match(/\.fullscreen-close-button\s*\{[^}]*z-index:\s*(\d+)/);
    const overlayMatch = css.match(/#bubble-magnifier-overlay\s*\{[^}]*z-index:\s*(\d+)/);

    expect(titleMatch).toBeTruthy();
    expect(closeBtnMatch).toBeTruthy();
    expect(overlayMatch).toBeTruthy();

    const titleZ = parseInt(titleMatch[1], 10);
    const closeBtnZ = parseInt(closeBtnMatch[1], 10);
    const overlayZ = parseInt(overlayMatch[1], 10);

    expect(overlayZ).toBeGreaterThan(titleZ);
    expect(overlayZ).toBeGreaterThan(closeBtnZ);
  });
});
