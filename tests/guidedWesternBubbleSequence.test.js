/**
 * @jest-environment jsdom
 *
 * Western guided-view sequence test:
 * For Western comics, guided view exclusively navigates through `sequence` (the authoritative
 * reading flow). Redundant navigation through raw un-sequenced `bubbles` is eliminated.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createModuleSandbox() {
  const state = {
    currentView: 'root',
    currentRootFolder: null,
    activeSmartFilter: null,
    comicIdMap: new Map(),
    mangaModePreference: false
  };

  const sandbox = {
    window: window,
    document: document,
    state: state,
    console: console,
    fetch: jest.fn()
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    const script = new vm.Script(cleanContent);
    script.runInContext(sandbox);
  }

  return { sandbox, loadFile, state };
}

describe('guided view: western sequence navigation', () => {
  test('currentPagePanels and currentPageBubbles both strictly follow pageData.sequence for Western comics', () => {
    const env = createModuleSandbox();
    env.loadFile('../public/js/viewer/guided/data.js');

    // Page 26 coordinates
    const b1 = [440, 195, 614, 382];   // Badge 1 (Top-Left)
    const b2 = [1524, 178, 797, 663];  // Badge 2 (Top-Left)
    const b3 = [792, 2174, 364, 313];  // Badge 3 (Mid-Left)
    const b4 = [1953, 2695, 327, 264]; // Badge 4 (Mid-Left)
    const b5 = [2451, 206, 537, 467];  // Badge 5 (Top-Right)
    const b6 = [3205, 230, 546, 320];  // Badge 6 (Top-Right)
    const b7 = [3449, 2714, 374, 293]; // Badge 7 (Mid-Right)

    // The raw `bubbles` array that was sorted blindly by Y-height (jumped to 5 & 6 before 3 & 4)
    const rawYHeightBubbles = [b1, b2, b5, b6, b3, b4, b7];

    // The curated reading sequence matching GVE Now badges 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
    const curatedSequence = [b1, b2, b3, b4, b5, b6, b7];

    env.state.currentComic = { id: 'carmen-red-claw', mangaMode: false };
    env.state.getViewerPages = () => ['page_26.jpg'];
    env.state.currentPageIndex = 0;
    env.state.GuidedView.cache.set('carmen-red-claw', {
      pages: {
        'page_26.jpg': {
          panels: [[162, 136, 2184, 1922]],
          bubbles: rawYHeightBubbles,
          sequence: curatedSequence
        }
      }
    });

    // Both panel flow and bubble flow must follow sequence in 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 order
    expect(env.state.GuidedView.currentPagePanels()).toEqual(curatedSequence);
    expect(env.state.GuidedView.currentPageBubbles()).toEqual(curatedSequence);
  });

  test('currentPagePanels falls back to panels for silent Western page without sequence', () => {
    const env = createModuleSandbox();
    env.loadFile('../public/js/viewer/guided/data.js');

    const panels = [
      [0, 0, 800, 600],
      [0, 600, 800, 600]
    ];

    env.state.currentComic = { id: 'western-silent', mangaMode: false };
    env.state.getViewerPages = () => ['cover.jpg'];
    env.state.currentPageIndex = 0;
    env.state.GuidedView.cache.set('western-silent', {
      pages: {
        'cover.jpg': {
          panels,
          bubbles: []
        }
      }
    });

    expect(env.state.GuidedView.currentPagePanels()).toEqual(panels);
  });
});
