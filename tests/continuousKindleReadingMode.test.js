/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Continuous Mode Kindle / E-Ink Reading Mode Respect', () => {
  let sandbox;
  let state;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="fullscreen-viewer" class="fullscreen-viewer">
        <div id="fullscreen-pages-continuous">
          <div class="page-container" data-index="0" style="height: 1000px;">
            <img src="page1.jpg" alt="Page 1" />
          </div>
          <div class="page-container" data-index="1" style="height: 1000px;">
            <img src="page2.jpg" alt="Page 2" />
          </div>
        </div>
      </div>
    `;

    state = {
      currentPageIndex: 0,
      einkMode: 'monochrome',
      isContinuousMode: true,
      currentComic: { id: 'comic-eink', continuousMode: true },
      triggerEinkFlash: jest.fn(),
      getViewerPages: jest.fn(() => ['p1.jpg', 'p2.jpg']),
      updateViewerPageCounter: jest.fn(),
      saveProgress: jest.fn(),
      updateLibraryProgress: jest.fn(),
      getPageUrl: jest.fn(p => Promise.resolve(`blob:${p}`))
    };

    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    window.HTMLElement.prototype.scrollTo = jest.fn();

    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    sandbox = {
      window: { ...window, IntersectionObserver: MockIntersectionObserver, HTMLElement: window.HTMLElement },
      document,
      HTMLElement: window.HTMLElement,
      IntersectionObserver: MockIntersectionObserver,
      state,
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      requestAnimationFrame: (cb) => cb()
    };
    vm.createContext(sandbox);

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

  test('1. public/style.css applies monochrome and color E-Ink filters to continuous mode images', () => {
    const cssPath = path.join(__dirname, '../public/style.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Monochrome Kindle/E-Ink optimization rule must include continuous images
    expect(css).toMatch(/body\.eink-mode[^{]*#fullscreen-pages-continuous\s+img/);
    expect(css).toMatch(/body\.eink-mode[^{]*#viewer-pages-continuous\s+img/);

    // Color Kindle/E-Ink optimization rule must include continuous images
    expect(css).toMatch(/body\.eink-color-mode[^{]*#fullscreen-pages-continuous\s+img/);
    expect(css).toMatch(/body\.eink-color-mode[^{]*#viewer-pages-continuous\s+img/);
  });

  test('2. scrollToNextPage and scrollToPreviousPage use instant behavior and triggerEinkFlash on Kindle/E-Ink', async () => {
    document.body.classList.add('eink-mode');
    sandbox.state.einkMode = 'monochrome';

    // Enable continuous mode to bind continuousContainer
    await sandbox.enableContinuousMode();
    await new Promise(r => setTimeout(r, 350));

    window.HTMLElement.prototype.scrollIntoView.mockClear();
    sandbox.state.triggerEinkFlash.mockClear();

    // From page 0 -> page 1
    sandbox.scrollToNextPage();

    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({
      behavior: 'instant'
    }));
    expect(sandbox.state.triggerEinkFlash).toHaveBeenCalled();

    window.HTMLElement.prototype.scrollIntoView.mockClear();
    sandbox.state.triggerEinkFlash.mockClear();

    // Mock page 1 is in view so scrollToPreviousPage scrolls to page 0
    const pageContainers = document.querySelectorAll('.page-container');
    pageContainers[0].getBoundingClientRect = () => ({ top: -2000, height: 1000 });
    pageContainers[1].getBoundingClientRect = () => ({ top: (window.innerHeight / 2) - 500, height: 1000 });

    sandbox.scrollToPreviousPage();

    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({
      behavior: 'instant'
    }));
    expect(sandbox.state.triggerEinkFlash).toHaveBeenCalled();
  });

  test('3. updateCurrentPageFromScroll triggers e-ink flash when advancing page on Kindle/E-Ink', async () => {
    document.body.classList.add('eink-mode');
    sandbox.state.einkMode = 'monochrome';

    await sandbox.enableContinuousMode();
    await new Promise(r => setTimeout(r, 350));
    sandbox.state.currentPageIndex = 0;
    sandbox.state.triggerEinkFlash.mockClear();

    const pageContainers = document.querySelectorAll('.page-container');
    expect(pageContainers.length).toBeGreaterThan(1);
    // Mock getBoundingClientRect so page 2 is in center
    pageContainers[0].getBoundingClientRect = () => ({ top: -2000, height: 1000 });
    pageContainers[1].getBoundingClientRect = () => ({ top: (window.innerHeight / 2) - 500, height: 1000 });

    await sandbox.updateCurrentPageFromScroll();

    expect(sandbox.state.currentPageIndex).toBe(1);
    expect(sandbox.state.triggerEinkFlash).toHaveBeenCalled();
  });
});
