/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createOfflineLoaderSandbox(archiveMock) {
  const state = {
    downloadedComicIds: new Set(),
    currentComic: { id: 'comic-cbr-1', name: 'Batman #1.cbr', progress: {} },
    getComicFromDB: jest.fn().mockResolvedValue({
      id: 'comic-cbr-1',
      fileBlob: new Blob([new Uint8Array([0x52, 0x61, 0x72, 0x21])])
    }),
    openClientArchive: jest.fn().mockResolvedValue(archiveMock)
  };

  const sandbox = {
    window: {},
    state,
    canonicalGlobal: state,
    console,
    Blob
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const fullPath = path.resolve(__dirname, '../../../../public/js/viewer/nav/offline-loader.js');
  const code = fs.readFileSync(fullPath, 'utf8')
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/const\s+global\s*=/g, 'var global =')
    .replace(/export\s+\{[\s\S]*?\};?/g, '');

  vm.runInContext(code, sandbox);
  return { sandbox, state };
}

describe('public/js/viewer/nav/offline-loader.js', () => {
  test('loadOfflineComicPages uses openClientArchive for CBR/CBZ and caches archive in currentComicArchiveCache', async () => {
    const archiveMock = {
      type: 'cbr',
      listEntries: () => ['page10.jpg', '__MACOSX/._page1.jpg', 'page2.png', 'readme.txt', 'page1.jpg'],
      extractEntryBlob: jest.fn()
    };

    const { sandbox, state } = createOfflineLoaderSandbox(archiveMock);
    const pages = await sandbox.loadOfflineComicPages(state.currentComic);

    expect(state.openClientArchive).toHaveBeenCalledTimes(1);
    expect(pages).toEqual(['page1.jpg', 'page2.png', 'page10.jpg']);
    expect(state.currentComicArchiveCache).toEqual({
      id: 'comic-cbr-1',
      archive: archiveMock
    });
    expect(state.downloadedComicIds.has('comic-cbr-1')).toBe(true);
    expect(state.currentComic.progress.totalPages).toBe(3);
  });
});
