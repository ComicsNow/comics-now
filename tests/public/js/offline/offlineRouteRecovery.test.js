/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Offline Route Recovery & Downloaded-First Fallback', () => {
  test('/comic/:id and /comic/:id/page/:pageNumber recover downloaded comic via getOfflineComicMetaById when getComicById returns null', async () => {
    const registeredRoutes = {};
    const openViewer = jest.fn().mockResolvedValue();
    const turnToPage = jest.fn();
    const getOfflineComicMetaById = jest.fn().mockResolvedValue({
      id: 'off-42',
      comicInfo: {
        id: 'off-42',
        name: 'Offline Issue #42',
        path: '/comics/DC/Batman/42.cbz',
        progress: { lastReadPage: 2, totalPages: 24 }
      }
    });

    const state = {
      currentRootFolder: null,
      currentPublisher: null,
      currentSeries: null,
      router: {
        addRoute: (pattern, handler) => { registeredRoutes[pattern] = handler; }
      },
      getComicById: () => null,
      openComicViewer: openViewer,
      turnToPage,
      OfflineDB: { getOfflineComicMetaById }
    };

    const sandbox = {
      window: {},
      state,
      URLSearchParams,
      decodeURIComponent,
      setTimeout,
      clearTimeout,
      console
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const routesCode = fs.readFileSync(path.resolve(__dirname, '../../../../public/js/routes.js'), 'utf8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    vm.runInContext(routesCode, sandbox);
    sandbox.registerRoutes();

    await registeredRoutes['/comic/:id']({ id: 'off-42' }, new URLSearchParams());
    expect(getOfflineComicMetaById).toHaveBeenCalledWith('off-42');
    expect(openViewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'off-42', name: 'Offline Issue #42' }),
      {}
    );

    openViewer.mockClear();
    await registeredRoutes['/comic/:id/page/:pageNumber']({ id: 'off-42', pageNumber: '5' }, new URLSearchParams());
    expect(openViewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'off-42' }),
      {}
    );
    await new Promise((r) => setTimeout(r, 350));
    expect(turnToPage).toHaveBeenCalledWith(4);
  });

  test('library-loader switches to Downloaded smartlist instead of Offline unavailable when downloaded comics exist', async () => {
    const showDownloadedSmartList = jest.fn();
    const showOfflineLibraryUnavailableMessage = jest.fn();

    const state = {
      downloadedComicIds: new Set(['c1', 'c2']),
      LibrarySmartLists: { showDownloadedSmartList },
      OfflineDB: {
        loadLibraryCacheFromDB: jest.fn().mockResolvedValue(null),
        getAllDownloadedComicIds: jest.fn().mockResolvedValue(new Set(['c1', 'c2']))
      }
    };

    const sandbox = {
      window: {},
      state,
      appGlobal: state,
      rootFolderListContainer: document.createElement('div'),
      navigator: { onLine: false },
      isAppOnline: () => false,
      loadLibraryCacheFromDB: state.OfflineDB.loadLibraryCacheFromDB,
      showOfflineLibraryUnavailableMessage,
      checkServerConnectivity: jest.fn().mockResolvedValue(false),
      mergeOfflineStatusesIntoLibrary: jest.fn().mockResolvedValue(),
      updateContinueReadingSection: jest.fn(),
      updateInProgressSection: jest.fn(),
      renderRootFolders: jest.fn(),
      console,
      debugLog: () => {}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const loaderCode = fs.readFileSync(path.resolve(__dirname, '../../../../public/js/app/library-loader.js'), 'utf8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    vm.runInContext(loaderCode, sandbox);

    await sandbox.loadLibraryOfflineFirst();
    expect(showDownloadedSmartList).toHaveBeenCalled();
    expect(showOfflineLibraryUnavailableMessage).not.toHaveBeenCalled();
  });
});
