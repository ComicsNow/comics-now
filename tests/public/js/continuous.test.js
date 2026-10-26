/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Continuous Mode Module', () => {
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
      <button id="fullscreen-continuous-mode-btn" class="fullscreen-tool-btn"></button>
    `;

    state = {
      currentPageIndex: 0,
      isContinuousMode: false,
      currentComic: { id: 'comic-123', continuousMode: false },
      getViewerPages: jest.fn(() => ['p1.jpg', 'p2.jpg']),
      updateViewerPageCounter: jest.fn(),
      saveProgress: jest.fn(),
      updateLibraryProgress: jest.fn(),
      getPageUrl: jest.fn(p => Promise.resolve(`blob:${p}`)),
      updateComicInLibrary: jest.fn(),
      loadLibraryCacheFromDB: jest.fn(),
      saveLibraryCacheToDB: jest.fn(),
      GuidedView: { disableAll: jest.fn() }
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
      requestAnimationFrame: (cb) => cb(),
      alert: jest.fn()
    };
    vm.createContext(sandbox);

    const continuousPath = path.join(__dirname, '../../../public/js/continuous.js');
    const continuousCode = fs.readFileSync(continuousPath, 'utf-8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[^;]+;?/g, '');
    new vm.Script(continuousCode).runInContext(sandbox);
  });

  test('toggleContinuousMode flips the current continuous mode value', () => {
    const resultTrue = sandbox.toggleContinuousMode('comic-123', false);
    expect(resultTrue).toBe(true);

    const resultFalse = sandbox.toggleContinuousMode('comic-123', true);
    expect(resultFalse).toBe(false);
  });

  test('updateContinuousModeInCache updates mode in indexedDB cache', async () => {
    const mockLibrary = {
      root1: {
        publishers: {
          pub1: {
            series: {
              series1: [
                { id: 'comic-123', continuousMode: false },
                { id: 'comic-456', continuousMode: false }
              ]
            }
          }
        }
      }
    };

    sandbox.state.loadLibraryCacheFromDB.mockResolvedValue({ data: mockLibrary });
    sandbox.state.saveLibraryCacheToDB.mockResolvedValue(true);

    const result = await sandbox.updateContinuousModeInCache('comic-123', true);

    expect(result).toBe(true);
    expect(sandbox.state.loadLibraryCacheFromDB).toHaveBeenCalled();
    expect(sandbox.state.saveLibraryCacheToDB).toHaveBeenCalledWith(mockLibrary);
    expect(mockLibrary.root1.publishers.pub1.series.series1[0].continuousMode).toBe(true);
  });

  test('disableContinuousMode cleans up continuous mode state', async () => {
    sandbox.state.isContinuousMode = true;
    sandbox.state.currentComic.continuousMode = true;
    const fullscreenViewer = document.getElementById('fullscreen-viewer');
    fullscreenViewer.classList.add('continuous-active');

    await sandbox.disableContinuousMode();

    expect(sandbox.state.isContinuousMode).toBe(false);
    expect(sandbox.state.currentComic.continuousMode).toBe(false);
    expect(fullscreenViewer.classList.contains('continuous-active')).toBe(false);
    expect(sandbox.state.updateComicInLibrary).toHaveBeenCalledWith('comic-123', { continuousMode: false });
  });


  test('updateContinuousModeUI toggles active class on buttons', () => {
    const btn1 = document.createElement('button');
    btn1.id = 'continuous-mode-btn';
    document.body.appendChild(btn1);

    sandbox.updateContinuousModeUI(true);
    expect(btn1.classList.contains('active')).toBe(true);

    sandbox.updateContinuousModeUI(false);
    expect(btn1.classList.contains('active')).toBe(false);
  });

  test('setupContinuousModeButtonHandler sets up event listener correctly', async () => {
    // We already have initialization running due to DOMContentLoaded inside continuous.js logic
    // We can clear and try again to see if it sets _continuousAttached
    const btn = document.getElementById('fullscreen-continuous-mode-btn');

    // Clear attachment flag set during script loading
    delete btn._continuousAttached;
    expect(btn._continuousAttached).toBeUndefined();

    sandbox.initializeContinuousMode();

    expect(btn._continuousAttached).toBe(true);
  });

});
