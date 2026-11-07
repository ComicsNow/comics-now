/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createDeviceLibrarySandbox() {
  const state = {
    showRootFolderList: jest.fn(),
    applyFilterAndRender: jest.fn(),
    showView: jest.fn(),
    showComicList: jest.fn(),
    openComicViewer: jest.fn(),
    OfflineDB: {
      openOfflineDB: jest.fn()
    }
  };

  const sandbox = {
    window,
    document,
    Element: window.Element,
    state,
    console,
    alert: jest.fn(),
    confirm: jest.fn().mockReturnValue(true),
    setTimeout,
    clearTimeout
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, '../../../..', relPath);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+class\s+/g, 'class ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+/g, '')
      .replace(/^const\s+(clear|renderContent|safeHtml|safeRaw)\s*=/gm, 'var $1 =')
      .replace(/const\s+global\s*=/g, 'var global =');
    vm.runInContext(content, sandbox);
  }

  return { sandbox, loadFile, state };
}

describe('Device Library Module', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="comic-list" class="hidden">
        <h2 id="comic-list-title"></h2>
        <div id="comic-list-container"></div>
      </div>
      <div id="root-folder-container"></div>
    `;
    env = createDeviceLibrarySandbox();
    env.loadFile('public/js/library/device/progress.js');
    env.loadFile('public/js/library/device/storage.js');
    env.loadFile('public/js/library/device/ui.js');
    env.loadFile('public/js/library/device-library.js');
  });

  test('renderLocalComicList populates container with local comic cards', () => {
    const { renderLocalComicList, state } = env.sandbox;

    const mockComics = [
      { name: 'Batman #1.cbz', path: 'Batman #1.cbz' },
      { name: 'Superman #1.cbz', path: 'Superman #1.cbz' }
    ];

    renderLocalComicList('Local Files', mockComics);

    const titleEl = document.getElementById('comic-list-title');
    const container = document.getElementById('comic-list-container');
    expect(titleEl.textContent).toBe('Local Files');
    expect(container.children.length).toBe(2);
    expect(container.textContent).toContain('Batman #1.cbz');
    expect(container.textContent).toContain('Superman #1.cbz');
    expect(state.showView).toHaveBeenCalled();
  });

  test('DeviceLibrary namespace is cleanly registered on state and window', () => {
    const { DeviceLibrary, state, window } = env.sandbox;

    expect(DeviceLibrary).toBeDefined();
    expect(typeof DeviceLibrary.requestDeviceLibrary).toBe('function');
    expect(typeof DeviceLibrary.getDeviceLibraries).toBe('function');
    expect(typeof DeviceLibrary.getDeviceComics).toBe('function');
    expect(state.DeviceLibrary).toBe(DeviceLibrary);
    expect(window.DeviceLibrary).toBe(DeviceLibrary);
  });

  test('deduplicates device libraries with the same folder name and does not prompt for handle permission when comics are already saved in IndexedDB', async () => {
    const { DeviceLibrary, state } = env.sandbox;

    const libStoreData = new Map([
      ['device-100', { id: 'device-100', name: 'MyComics', addedAt: 100, handle: { name: 'MyComics', queryPermission: jest.fn().mockResolvedValue('prompt'), requestPermission: jest.fn().mockResolvedValue('granted') } }],
      ['device-200', { id: 'device-200', name: 'MyComics', addedAt: 200, handle: { name: 'MyComics', queryPermission: jest.fn().mockResolvedValue('prompt'), requestPermission: jest.fn().mockResolvedValue('granted') } }]
    ]);
    const comicStoreData = new Map([
      ['device-100:a.cbz', { id: 'device-100:a.cbz', libraryId: 'device-100', name: 'a.cbz', path: 'a.cbz', file: new Blob(['cbz-1']) }],
      ['device-200:a.cbz', { id: 'device-200:a.cbz', libraryId: 'device-200', name: 'a.cbz', path: 'a.cbz', file: new Blob(['cbz-2']) }]
    ]);

    const mockDb = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx = {
          objectStore: (storeName) => {
            const map = storeName === 'deviceLibraries' ? libStoreData : comicStoreData;
            return {
              getAll: () => {
                const req = {};
                setTimeout(() => {
                  req.result = Array.from(map.values());
                  if (req.onsuccess) req.onsuccess();
                }, 0);
                return req;
              },
              put: (val) => {
                map.set(val.id, val);
                const req = {};
                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                return req;
              },
              delete: (key) => {
                map.delete(key);
              }
            };
          }
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 5);
        return tx;
      }
    };

    state.OfflineDB.openOfflineDB.mockResolvedValue(mockDb);

    // 1. getDeviceLibraries() should deduplicate same-named folders (keeping newest 'device-200' and removing 'device-100')
    const libs = await DeviceLibrary.getDeviceLibraries();
    expect(libs.length).toBe(1);
    expect(libs[0].id).toBe('device-200');
    expect(libStoreData.has('device-100')).toBe(false);

    // 2. Concurrent appendDeviceLibraryCards() calls must only render 1 card in container, and clicking it should NOT call requestPermission because comic.file is already saved
    const container = document.getElementById('root-folder-container');
    await Promise.all([
      DeviceLibrary.appendDeviceLibraryCards(container),
      DeviceLibrary.appendDeviceLibraryCards(container)
    ]);

    const cards = container.querySelectorAll('.device-library-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('MyComics');

    // Click the card -> should open comics directly without calling handle.requestPermission
    await cards[0].onclick({ target: cards[0] });
    expect(libs[0].handle.requestPermission).not.toHaveBeenCalled();
  });

  test('upgrades existing handle-only library to persistent IndexedDB Blobs upon one-time permission grant', async () => {
    const { DeviceLibrary, state } = env.sandbox;

    const mockFileEntry = {
      kind: 'file',
      name: 'Issue1.cbz',
      getFile: jest.fn().mockResolvedValue({
        name: 'Issue1.cbz',
        type: 'application/vnd.comicbook+zip',
        arrayBuffer: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
      })
    };

    const mockDirHandle = {
      name: 'LegacyHandleFolder',
      queryPermission: jest.fn().mockResolvedValue('prompt'),
      requestPermission: jest.fn().mockResolvedValue('granted'),
      values: async function* () {
        yield mockFileEntry;
      }
    };

    const libStoreData = new Map([
      ['device-300', { id: 'device-300', name: 'LegacyHandleFolder', addedAt: 300, handle: mockDirHandle }]
    ]);
    const comicStoreData = new Map([
      ['device-300:Issue1.cbz', { id: 'device-300:Issue1.cbz', libraryId: 'device-300', name: 'Issue1.cbz', path: 'Issue1.cbz', handle: mockFileEntry }]
    ]);

    const mockDb = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx = {
          objectStore: (storeName) => {
            const map = storeName === 'deviceLibraries' ? libStoreData : comicStoreData;
            return {
              getAll: () => {
                const req = {};
                setTimeout(() => {
                  req.result = Array.from(map.values());
                  if (req.onsuccess) req.onsuccess();
                }, 0);
                return req;
              },
              put: (val) => {
                map.set(val.id, val);
                const req = {};
                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                return req;
              },
              delete: (key) => {
                map.delete(key);
              }
            };
          }
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 5);
        return tx;
      }
    };

    state.OfflineDB.openOfflineDB.mockResolvedValue(mockDb);

    const container = document.getElementById('root-folder-container');
    await DeviceLibrary.appendDeviceLibraryCards(container);

    const card = container.querySelector('.device-library-card');
    expect(card).not.toBeNull();

    // Clicking the un-cached handle card prompts once and upgrades comics to persistent Blobs
    await card.onclick({ target: card });
    expect(mockDirHandle.requestPermission).toHaveBeenCalledTimes(1);
    expect(mockFileEntry.getFile).toHaveBeenCalledTimes(1);
    const savedComic = comicStoreData.get('device-300:Issue1.cbz');
    expect(savedComic.file).toBeDefined();
    expect(savedComic.file).not.toBeNull();
  });

  test('showRootFolderList does not skip to publisher view when 1 server library and 1 device library exist', async () => {
    const { DeviceLibrary, state } = env.sandbox;

    document.body.innerHTML += `
      <div id="root-folder-list" class="hidden">
        <div id="root-folder-list-container"></div>
      </div>
    `;
    env.sandbox.rootFolderListDiv = document.getElementById('root-folder-list');
    env.sandbox.rootFolderListContainer = document.getElementById('root-folder-list-container');
    env.sandbox.ICONS = { READ: '✓', DOWNLOAD: '↓' };
    env.sandbox.getRelativePath = () => '/';
    env.sandbox.getRootStatusCounts = () => ({ total: 5, unread: 5, inProgress: 0, read: 0 });
    env.sandbox.statusCountsMatchFilter = () => true;
    env.sandbox.updateFilterButtonCounts = jest.fn();
    env.sandbox.updateBreadcrumb = jest.fn();
    env.sandbox.makeCountChips = () => '';
    env.sandbox.showFolderView = jest.fn();
    env.sandbox.renderAlphaFilter = jest.fn();
    env.sandbox.applyFilterAndRender = jest.fn();
    env.sandbox.syncSmartFilterButtons = jest.fn();
    env.sandbox.mountSmartFilterHostInto = jest.fn();
    env.sandbox.hideSmartFilterHost = jest.fn();
    env.sandbox.showPublisherList = jest.fn();
    env.sandbox.showView = state.showView;

    env.loadFile('public/js/library/render/root-folders.js');

    const libStoreData = new Map([
      ['device-400', { id: 'device-400', name: 'PhoneComics', addedAt: 400, isLegacy: true }]
    ]);
    const comicStoreData = new Map([
      ['device-400:a.cbz', { id: 'device-400:a.cbz', libraryId: 'device-400', name: 'a.cbz', path: 'a.cbz', file: new Blob(['cbz']) }]
    ]);
    const mockDb = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({
        objectStore: (storeName) => {
          const map = storeName === 'deviceLibraries' ? libStoreData : comicStoreData;
          return {
            getAll: () => {
              const req = {};
              setTimeout(() => {
                req.result = Array.from(map.values());
                if (req.onsuccess) req.onsuccess();
              }, 0);
              return req;
            }
          };
        }
      })
    };
    state.OfflineDB.openOfflineDB.mockResolvedValue(mockDb);

    // Sync device library count via getDeviceLibraries()
    await DeviceLibrary.getDeviceLibraries();

    // Configure 1 server library
    state.configuredRootFolders = ['default-lib'];
    state.library = {
      'default-lib': {
        publishers: { DC: { series: { Batman: [{ id: '1' }] } } }
      }
    };

    // Call showRootFolderList() WITHOUT { force: true }
    env.sandbox.showRootFolderList();

    // Because there is 1 server library + 1 device library (2 libraries total), it must NOT skip to showPublisherList
    expect(env.sandbox.showPublisherList).not.toHaveBeenCalled();
    expect(state.showView).toHaveBeenCalledWith(env.sandbox.rootFolderListDiv);
  });

  test('provides live visual progress feedback while scanning and saving device library comics', async () => {
    const { DeviceLibrary, state } = env.sandbox;

    const makeEntry = (name) => ({
      kind: 'file',
      name,
      getFile: jest.fn().mockResolvedValue({
        name,
        type: 'application/vnd.comicbook+zip',
        arrayBuffer: jest.fn().mockResolvedValue(new Uint8Array([1, 2]).buffer)
      })
    });

    const mockDirHandle = {
      name: 'BigLocalLibrary',
      queryPermission: jest.fn().mockResolvedValue('granted'),
      requestPermission: jest.fn().mockResolvedValue('granted'),
      values: async function* () {
        yield makeEntry('Comic1.cbz');
        yield makeEntry('Comic2.cbz');
      }
    };

    const libStoreData = new Map([
      ['device-500', { id: 'device-500', name: 'BigLocalLibrary', addedAt: 500, handle: mockDirHandle }]
    ]);
    const comicStoreData = new Map();

    const mockDb = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx = {
          objectStore: (storeName) => {
            const map = storeName === 'deviceLibraries' ? libStoreData : comicStoreData;
            return {
              getAll: () => {
                const req = {};
                setTimeout(() => {
                  req.result = Array.from(map.values());
                  if (req.onsuccess) req.onsuccess();
                }, 0);
                return req;
              },
              put: (val) => {
                map.set(val.id, val);
                const req = {};
                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                return req;
              }
            };
          }
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 2);
        return tx;
      }
    };

    state.OfflineDB.openOfflineDB.mockResolvedValue(mockDb);

    const progressUpdates = [];
    await DeviceLibrary.scanDeviceLibrary('device-500', mockDirHandle, (info) => {
      progressUpdates.push({ ...info });
    });

    expect(progressUpdates.some(p => p.status === 'scanning' && p.current === 1 && p.total === 2)).toBe(true);
    expect(progressUpdates.some(p => p.status === 'scanning' && p.current === 2 && p.total === 2)).toBe(true);
    expect(progressUpdates[progressUpdates.length - 1]).toMatchObject({
      status: 'ready',
      current: 2,
      total: 2
    });

    const toast = document.getElementById('device-library-sync-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('BigLocalLibrary');
    expect(toast.textContent).toContain('2');
  });
});
