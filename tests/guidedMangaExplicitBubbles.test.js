/**
 * @jest-environment jsdom
 *
 * Manga explicit-bubbles path: editor-written manga sidecars carry a non-empty
 * `bubbles` list (pure bubbles) that the page sequence references (editor
 * regeneration writes sequence = panels + bubbles). The reader must step
 * exactly that list, and panel classification must treat the raw `panels` list
 * as pure panels (no IoA child-classification). Everything else — legacy
 * sidecars with bubbles: [], and sidecars whose bubbles the sequence never
 * references — must behave byte-identically to the previous
 * classifyMangaPage() algorithm.
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

// Load geometry.js + data.js against a single-page manga comic.
// Default sequence mirrors the editor-written shape (panels + bubbles);
// legacy shapes pass their own sequence explicitly.
function setupPageEnv({ panels, bubbles, sequence }) {
  const env = createModuleSandbox();
  env.loadFile('../public/js/viewer/guided/geometry.js');
  env.loadFile('../public/js/viewer/guided/data.js');

  env.state.currentComic = { id: 'c1', mangaMode: true };
  env.state.getViewerPages = () => ['p1.jpg'];
  env.state.currentPageIndex = 0;
  env.state.GuidedView.cache.set('c1', {
    pages: { 'p1.jpg': { panels, bubbles, sequence: sequence || [...panels, ...bubbles] } }
  });
  return env;
}

describe('guided view: manga explicit bubbles', () => {
  describe('legacy pages (bubbles: []) keep the old classification', () => {
    test('a bubble inside a panel is classified as its child', () => {
      const env = setupPageEnv({
        panels: [[0, 0, 100, 100], [10, 10, 30, 30], [200, 0, 50, 50]],
        bubbles: []
      });
      const classified = env.state.GuidedView.classifyMangaPage();
      expect(classified).toHaveLength(2);
      expect(classified[0].box).toEqual([0, 0, 100, 100]);
      expect(classified[0].bubbles).toEqual([[10, 10, 30, 30]]);
      expect(classified[1].box).toEqual([200, 0, 50, 50]);
      expect(classified[1].bubbles).toEqual([]);
      expect(env.state.GuidedView.mangaPageBubbles()).toEqual([[10, 10, 30, 30]]);
    });

    test('overlaps below the 0.7 child threshold stay panels', () => {
      // 65% overlap each way: neither box is >= 0.7 inside the other, so
      // neither is classified as a child bubble.
      const env = setupPageEnv({ panels: [[0, 0, 100, 100], [0, 35, 100, 100]], bubbles: [] });
      const classified = env.state.GuidedView.classifyMangaPage();
      expect(classified).toHaveLength(2);
      expect(classified[0].bubbles).toEqual([]);
      expect(classified[1].bubbles).toEqual([]);
    });
  });

  describe('bubbles the sequence never references (legacy sidecars with a separate detection pass)', () => {
    // Some legacy manga sidecars carry a bubbles list from a detection pass the
    // sequence never references (the sequence holds only panels/children). Those
    // are not editor-written pages and must keep the heuristic behaviour.
    const gannibalShape = () => setupPageEnv({
      panels: [[0, 0, 100, 100], [10, 10, 30, 30]],
      bubbles: [[500, 500, 20, 20]],
      sequence: [[0, 0, 100, 100], [10, 10, 30, 30]]
    });

    test('mangaPageBubbles() ignores unreferenced bubbles and keeps the heuristic classification', () => {
      const env = gannibalShape();
      expect(env.state.GuidedView.mangaPageBubbles()).toEqual([[10, 10, 30, 30]]);
    });

    test('panel classification still drops heuristic children from the panel list', () => {
      const env = gannibalShape();
      const classified = env.state.GuidedView.classifyMangaPage();
      expect(classified).toHaveLength(1);
      expect(classified[0].box).toEqual([0, 0, 100, 100]);
      expect(classified[0].bubbles).toEqual([[10, 10, 30, 30]]);
    });
  });

  describe('editor-written pages (explicit bubbles)', () => {
    test('mangaPageBubbles() steps the explicit list verbatim', () => {
      const env = setupPageEnv({
        panels: [[0, 0, 100, 100]],
        bubbles: [[5, 5, 10, 10], [9, 90, 8, 8]]
      });
      expect(env.state.GuidedView.mangaPageBubbles()).toEqual([[5, 5, 10, 10], [9, 90, 8, 8]]);
    });

    test('explicit bubbles are not lost when they overlap no panel', () => {
      const env = setupPageEnv({
        panels: [[0, 0, 10, 10]],
        bubbles: [[500, 500, 20, 20]]
      });
      expect(env.state.GuidedView.mangaPageBubbles()).toEqual([[500, 500, 20, 20]]);
    });

    test('every raw box stays a panel; bubbles attach to the best-overlapping panel', () => {
      // B sits fully inside A, but with explicit bubbles the raw list is pure
      // panels, so B must remain its own panel.
      const env = setupPageEnv({
        panels: [[0, 0, 100, 100], [10, 10, 30, 30]],
        bubbles: [[10, 10, 30, 30]]
      });
      const classified = env.state.GuidedView.classifyMangaPage();
      expect(classified).toHaveLength(2);
      expect(classified[0].box).toEqual([0, 0, 100, 100]);
      expect(classified[0].bubbles).toEqual([[10, 10, 30, 30]]);
      expect(classified[1].box).toEqual([10, 10, 30, 30]);
      expect(classified[1].bubbles).toEqual([]);
    });

    test('a bubble spanning two panels goes to the one it overlaps more', () => {
      const env = setupPageEnv({
        panels: [[0, 0, 100, 100], [70, 0, 100, 100]],
        bubbles: [[60, 0, 60, 50]] // 0.667 of A, 0.833 of C
      });
      const classified = env.state.GuidedView.classifyMangaPage();
      expect(classified[0].bubbles).toEqual([]);
      expect(classified[1].bubbles).toEqual([[60, 0, 60, 50]]);
    });
  });
});
