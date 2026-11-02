/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Fullscreen persistent header controls & clean display title', () => {
  let sandbox;
  let state;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="fullscreen-viewer" class="fullscreen-viewer hidden">
        <div id="fullscreen-title" class="fullscreen-title hidden" role="heading" aria-level="2"></div>
        <button id="fullscreen-close-btn" class="fullscreen-close-button hidden" type="button">
          <span aria-hidden="true">&times;</span>
        </button>
        <div id="fullscreen-info-bar" class="fullscreen-info-bar"></div>
        <div id="fullscreen-controls" class="fullscreen-controls hidden"></div>
        <img id="fullscreen-image" src="test.jpg" />
        <div id="fullscreen-scrubber-container" class="hidden">
          <span id="fullscreen-scrubber-current-page">1</span>
          <div id="fullscreen-scrubber-track-fill"></div>
          <input type="range" id="fullscreen-scrubber-slider" min="1" max="20" value="1" />
          <span id="fullscreen-scrubber-total-pages">20</span>
        </div>
        <div id="reader-scrubber-preview" class="hidden">
          <img id="reader-scrubber-preview-img" />
          <span id="reader-scrubber-preview-page-text"></span>
          <span id="reader-scrubber-preview-spread" class="hidden"></span>
        </div>
      </div>
    `;

    state = {
      fullscreenViewer: document.getElementById('fullscreen-viewer'),
      fullscreenTitle: document.getElementById('fullscreen-title'),
      fullscreenCloseBtn: document.getElementById('fullscreen-close-btn'),
      fullscreenInfoBar: document.getElementById('fullscreen-info-bar'),
      fullscreenControls: document.getElementById('fullscreen-controls'),
      fullscreenImage: document.getElementById('fullscreen-image'),
      currentComic: { name: 'Batman (2016) #1', series: 'Batman' },
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

    function loadFile(relPath) {
      const fullPath = path.resolve(__dirname, relPath);
      const code = fs.readFileSync(fullPath, 'utf-8');
      const cleanContent = code
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+const\s+/g, 'var ')
        .replace(/export\s+let\s+/g, 'var ')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/\bconst\s+/g, 'var ')
        .replace(/\blet\s+/g, 'var ')
        .replace(/export\s+\{[\s\S]*?\};?/g, '')
        .replace(/export\s+default\s+[^;]+;?/g, '');
      new vm.Script(cleanContent).runInContext(sandbox);
    }

    sandbox.getThumbnailUrl = jest.fn().mockResolvedValue('thumb.jpg');
    sandbox.goToPage = jest.fn().mockResolvedValue(undefined);
    loadFile('../public/js/viewer/fullscreen/controls.js');
    loadFile('../public/js/viewer/fullscreen/lifecycle.js');
    loadFile('../public/js/viewer/previews/scrubber.js');
  });

  test('hideFullscreenControls leaves title and top-right close button visible', () => {
    const titleEl = document.getElementById('fullscreen-title');
    const closeBtn = document.getElementById('fullscreen-close-btn');
    const controls = document.getElementById('fullscreen-controls');

    // Show controls first
    sandbox.showFullscreenControls(false);
    expect(controls.classList.contains('hidden')).toBe(false);
    expect(titleEl.classList.contains('hidden')).toBe(false);
    expect(closeBtn.classList.contains('hidden')).toBe(false);

    // Call hideFullscreenControls
    sandbox.hideFullscreenControls();

    // Controls container should be hidden, but title and close button must NOT be hidden
    expect(controls.classList.contains('hidden')).toBe(true);
    expect(titleEl.classList.contains('hidden')).toBe(false);
    expect(closeBtn.classList.contains('hidden')).toBe(false);
  });

  test('auto-hide timer keeps title and close button visible after timeout', () => {
    jest.useFakeTimers();
    try {
      const titleEl = document.getElementById('fullscreen-title');
      const closeBtn = document.getElementById('fullscreen-close-btn');
      const controls = document.getElementById('fullscreen-controls');

      sandbox.showFullscreenControls(true);
      expect(controls.classList.contains('hidden')).toBe(false);
      expect(titleEl.classList.contains('hidden')).toBe(false);
      expect(closeBtn.classList.contains('hidden')).toBe(false);

      // Fast-forward past the autohide delay (3000ms)
      jest.advanceTimersByTime(3500);

      // Controls container should be hidden, but title and close button must stay visible
      expect(controls.classList.contains('hidden')).toBe(true);
      expect(titleEl.classList.contains('hidden')).toBe(false);
      expect(closeBtn.classList.contains('hidden')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('openFullscreen displays title and close button and populates title text', () => {
    const titleEl = document.getElementById('fullscreen-title');
    const closeBtn = document.getElementById('fullscreen-close-btn');

    // Initially both have 'hidden' class
    titleEl.classList.add('hidden');
    closeBtn.classList.add('hidden');

    sandbox.openFullscreen();

    expect(titleEl.classList.contains('hidden')).toBe(false);
    expect(closeBtn.classList.contains('hidden')).toBe(false);
    expect(titleEl.textContent).toBe('Batman (2016) #1');
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

  test('scrubber bar (#fullscreen-scrubber-container) does not disappear while dragging/scrubbing the circle thumb even past the 3000ms autohide timeout', async () => {
    jest.useFakeTimers();
    try {
      const scrubberContainer = document.getElementById('fullscreen-scrubber-container');
      const slider = document.getElementById('fullscreen-scrubber-slider');
      const controls = document.getElementById('fullscreen-controls');

      sandbox.initFullscreenNavigation();
      sandbox.initReaderScrubber();

      // Open fullscreen controls with autoHide = true (starts 3000ms timer)
      sandbox.showFullscreenControls(true);
      expect(scrubberContainer.classList.contains('hidden')).toBe(false);
      expect(controls.classList.contains('hidden')).toBe(false);

      // User starts dragging the scrubber circle thumb
      slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      slider.value = '8';
      slider.dispatchEvent(new Event('input', { bubbles: true }));

      // Even if pointer leaves the scrubber bar while dragging, and 5000ms (> 3000ms timeout) elapses:
      scrubberContainer.dispatchEvent(new Event('pointerleave', { bubbles: true }));
      jest.advanceTimersByTime(5000);

      // Scrubber and controls MUST remain visible while scrubbing!
      expect(scrubberContainer.classList.contains('hidden')).toBe(false);
      expect(controls.classList.contains('hidden')).toBe(false);

      // User releases the thumb to finish scrubbing
      slider.dispatchEvent(new Event('pointerup', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));

      // Before the 3000ms post-scrub timeout finishes, it is still visible
      jest.advanceTimersByTime(1000);
      expect(scrubberContainer.classList.contains('hidden')).toBe(false);

      // After the full 3000ms post-scrub inactivity timeout elapses, it auto-hides normally
      jest.advanceTimersByTime(2500);
      expect(scrubberContainer.classList.contains('hidden')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
