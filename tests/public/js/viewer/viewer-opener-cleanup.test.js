/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createOpenerSandbox() {
  const state = {
    API_BASE_URL: 'http://localhost:3000',
    encodePath: (p) => p.replace(/\//g, '|'),
    pageUrlCache: new Map(),
    preloadedImages: new Map(),
    inFlightPageLoads: new Map(),
    currentComicArchiveCache: { id: 'old-comic', archive: {} },
    currentComicZipCache: { id: 'old-comic', zip: {} },
    isLocalMode: false,
    initServerViewer: jest.fn(),
    renderPage: jest.fn().mockResolvedValue(true),
    preloadPages: jest.fn(),
    updateViewerBreadcrumbs: jest.fn(),
    setLibraryControlsVisibility: jest.fn(),
    loadOfflineComicPages: jest.fn().mockResolvedValue(['p1.jpg']),
    normalizePagesResponse: jest.fn((d) => d.pages || [])
  };

  const sandbox = {
    window: window,
    document: document,
    navigator: { onLine: false },
    state: state,
    canonicalGlobal: state,
    updateViewerBreadcrumbs: state.updateViewerBreadcrumbs,
    setLibraryControlsVisibility: state.setLibraryControlsVisibility,
    loadOfflineComicPages: state.loadOfflineComicPages,
    normalizePagesResponse: state.normalizePagesResponse,
    console: console,
    fetch: jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pages: ['p1.jpg'] })
    }),
    URL: {
      createObjectURL: jest.fn(() => 'blob:mock-new'),
      revokeObjectURL: jest.fn()
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const fullPath = path.resolve(__dirname, '../../../../public/js/viewer/nav/viewer-opener.js');
  const content = fs.readFileSync(fullPath, 'utf8');
  const cleanContent = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/const\s+global\s*=/g, 'var global =')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+/g, '');
  vm.runInContext(cleanContent, sandbox);

  return { sandbox, state };
}

describe('viewer-opener.js cleanup (Bug 1b)', () => {
  it('revokes all blob: URLs in pageUrlCache and resets currentComicArchiveCache on openComicViewer', async () => {
    const { sandbox, state } = createOpenerSandbox();

    state.pageUrlCache.set('p1.jpg', 'blob:http://localhost/old-1');
    state.pageUrlCache.set('p2.jpg', 'blob:http://localhost/old-2');
    state.pageUrlCache.set('p3.jpg', 'http://localhost:3000/api/v1/comics/pages/image?page=p3.jpg');

    await sandbox.openComicViewer({
      id: 'new-comic',
      name: 'New Comic',
      path: 'DC/New/01.cbz',
      pages: ['p1.jpg']
    });

    expect(sandbox.URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(sandbox.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/old-1');
    expect(sandbox.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/old-2');
    expect(state.currentComicArchiveCache).toBeNull();
    expect(state.currentComicZipCache).toBeNull();
  });
});
