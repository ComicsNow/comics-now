/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Comic Page Previews & Thumbnail Grid Navigator', () => {
  let sandbox;
  let ioInstances;
  let ioAutoIntersect;

  beforeEach(() => {
    // NOTE: the overlay is NOT in the static DOM — the module builds it on open
    // and removes it on close, so nothing full-screen lingers to block scrolling.
    document.body.innerHTML = `
      <div id="comic-viewer">
        <div class="viewer-nav">
          <button id="prev-page-btn" type="button" aria-label="Previous page">←</button>
          <button id="page-grid-btn" type="button" aria-label="View all pages in a grid">⊞</button>
          <button id="next-page-btn" type="button" aria-label="Next page">→</button>
        </div>
        <div id="viewer-pages"></div>
      </div>

      <div id="fullscreen-viewer" class="hidden fullscreen-viewer">
        <img id="fullscreen-image" src="" alt="Fullscreen Comic Page" />
        <div id="fullscreen-info-bar" class="fullscreen-info-bar">
          <button id="fullscreen-page-grid-btn" type="button" aria-label="View all pages in a grid">⊞</button>
          <button id="fullscreen-close-btn-bottom" type="button">&times;</button>
        </div>
      </div>
    `;

    window.HTMLElement.prototype.scrollIntoView = jest.fn();

    ioInstances = [];
    ioAutoIntersect = true;
    class MockIntersectionObserver {
      constructor(cb) { this.cb = cb; this.observed = []; ioInstances.push(this); }
      observe(el) { this.observed.push(el); if (ioAutoIntersect) this.cb([{ target: el, isIntersecting: true }], this); }
      unobserve(el) { this.observed = this.observed.filter((e) => e !== el); }
      disconnect() { this.observed = []; }
      fire(el) { this.cb([{ target: el, isIntersecting: true }], this); }
    }

    const mockPages = ['page_001.jpg', 'page_002.jpg', 'page_003.jpg', 'page_004.jpg', 'page_005.jpg'];

    const state = {
      currentPageIndex: 2,
      currentComic: {
        id: 'comic-123', series: 'Batman',
        path: '/comics/Batman/Batman_001.cbz',
        progress: { totalPages: 5, lastReadPage: 2 }
      },
      API_BASE_URL: 'http://localhost:3000',
      encodePath: (p) => Buffer.from(p).toString('base64'),
      getViewerPages: jest.fn(() => mockPages),
      getPageUrl: jest.fn(async (pageName) => `http://localhost:3000/api/v1/comics/pages/image?page=${pageName}&fmt=webp`),
      saveProgress: jest.fn(),
      saveProgressToDB: jest.fn(),
      updateLibraryProgress: jest.fn(),
      renderPage: jest.fn().mockResolvedValue(true),
      updateViewerPageCounter: jest.fn(),
      closeFullscreen: jest.fn()
    };

    sandbox = {
      window, document, state,
      navigator: window.navigator,
      IntersectionObserver: MockIntersectionObserver,
      URL: { createObjectURL: jest.fn(() => 'blob:http://localhost/fake-blob') },
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    vm.createContext(sandbox);
  });

  function loadModule() {
    const filePath = path.join(__dirname, '../public/js/viewer/page-previews.js');
    const code = fs.readFileSync(filePath, 'utf-8');
    const wrapped = code
      .replace(/import\s+{[^}]+}\s+from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+default\s+[^;]+;?/g, '');
    new vm.Script(`(function(global){ ${wrapped} })(state);`).runInContext(sandbox);
  }

  const overlay = () => document.getElementById('comic-page-grid-overlay');

  test('builds overlay on open and removes it entirely on close (no lingering full-screen element)', async () => {
    loadModule();
    expect(overlay()).toBeNull(); // nothing in the DOM to start

    await sandbox.state.openPagePreviewGrid();
    await flush();
    expect(overlay()).not.toBeNull();
    expect(document.querySelectorAll('.comic-page-preview-card').length).toBe(5);

    sandbox.state.closePagePreviewGrid();
    expect(overlay()).toBeNull(); // fully removed — cannot block scroll/pointer
  });

  test('does not lock body scroll (no page-grid-open class left behind)', async () => {
    loadModule();
    await sandbox.state.openPagePreviewGrid();
    sandbox.state.closePagePreviewGrid();
    expect(document.body.classList.contains('page-grid-open')).toBe(false);
    expect(document.body.style.overflow === 'hidden').toBe(false);
  });

  test('loads server thumbnails as full-res WebP once a card scrolls into view', async () => {
    loadModule();
    await sandbox.state.openPagePreviewGrid();
    await flush();
    const firstImg = document.querySelector('.comic-page-preview-card img');
    expect(firstImg.src).toContain('w=220'); // thumbnails downscale
    expect(firstImg.loading).toBe('lazy');
  });

  test('does NOT eagerly load off-screen thumbnails (lazy)', async () => {
    ioAutoIntersect = false;
    loadModule();
    await sandbox.state.openPagePreviewGrid();
    await flush();
    const cards = document.querySelectorAll('.comic-page-preview-card');
    cards.forEach((c) => expect(c.querySelector('img').getAttribute('src')).toBeFalsy());
    ioInstances[0].fire(cards[0].querySelector('img'));
    await flush();
    expect(cards[0].querySelector('img').src).toContain('w=220');
    expect(cards[4].querySelector('img').getAttribute('src')).toBeFalsy();
  });

  test('highlights the active page and scrolls it into view', async () => {
    loadModule();
    sandbox.state.currentPageIndex = 2;
    await sandbox.state.openPagePreviewGrid();
    await flush();
    const cards = document.querySelectorAll('.comic-page-preview-card');
    expect(cards[2].classList.contains('active-page-card')).toBe(true);
    expect(cards[0].classList.contains('active-page-card')).toBe(false);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test('selecting a thumbnail navigates to that page and closes the overlay', async () => {
    loadModule();
    await sandbox.state.openPagePreviewGrid();
    document.querySelectorAll('.comic-page-preview-card')[3].click();
    await flush();
    expect(overlay()).toBeNull();
    expect(sandbox.state.currentPageIndex).toBe(3);
    expect(sandbox.state.renderPage).toHaveBeenCalled();
    expect(sandbox.state.saveProgress).toHaveBeenCalledWith(3);
  });

  test('closes via close button, backdrop, and Escape', async () => {
    loadModule();
    await sandbox.state.openPagePreviewGrid();
    document.getElementById('comic-page-grid-close').click();
    expect(overlay()).toBeNull();

    await sandbox.state.openPagePreviewGrid();
    document.getElementById('comic-page-grid-backdrop').click();
    expect(overlay()).toBeNull();

    await sandbox.state.openPagePreviewGrid();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay()).toBeNull();
  });

  test('opens/closes inside fullscreen without exiting fullscreen', async () => {
    loadModule();
    const fs2 = document.getElementById('fullscreen-viewer');
    fs2.classList.remove('hidden');
    await sandbox.state.openPagePreviewGrid(document.getElementById('fullscreen-page-grid-btn'));
    expect(overlay()).not.toBeNull();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay()).toBeNull();
    expect(fs2.classList.contains('hidden')).toBe(false);
    expect(sandbox.state.closeFullscreen).not.toHaveBeenCalled();
  });

  test('mounts inside fullscreen element when fullscreen is active, else in body', async () => {
    loadModule();
    const fs2 = document.getElementById('fullscreen-viewer');
    fs2.classList.remove('hidden');
    await sandbox.state.openPagePreviewGrid(document.getElementById('fullscreen-page-grid-btn'));
    expect(overlay().parentElement).toBe(fs2);
    sandbox.state.closePagePreviewGrid();

    fs2.classList.add('hidden');
    await sandbox.state.openPagePreviewGrid(document.getElementById('page-grid-btn'));
    expect(overlay().parentElement).toBe(document.body);
  });

  test('offline mode uses offline page URLs for thumbnails', async () => {
    sandbox.state.currentComic.isOffline = true;
    sandbox.state.getPageUrl = jest.fn(async (pageName) => `blob:http://localhost/offline-${pageName}`);
    loadModule();
    await sandbox.state.openPagePreviewGrid();
    await flush();
    const firstImg = document.querySelector('.comic-page-preview-card img');
    expect(firstImg.src).toContain('blob:http://localhost/offline-page_001.jpg');
    expect(sandbox.state.getPageUrl).toHaveBeenCalledWith('page_001.jpg');
  });

  test('disconnects the IntersectionObserver on close', async () => {
    loadModule();
    await sandbox.state.openPagePreviewGrid();
    const observer = ioInstances[ioInstances.length - 1];
    const spy = jest.spyOn(observer, 'disconnect');
    sandbox.state.closePagePreviewGrid();
    expect(spy).toHaveBeenCalled();
  });
});
