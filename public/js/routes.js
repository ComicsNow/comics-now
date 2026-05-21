import {
  state,
  ctTabSettings,
  ctTabMatches,
  ctTabOutput,
  ctTabManagement
} from './globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

function registerRoutes() {
  if (global.router) {
    // 1. Main views
    global.router.addRoute('/', () => {
      if (typeof global.showRootFolderList === 'function') {
        global.showRootFolderList();
      } else {
        if (typeof global.showView === 'function') {
          global.showView(document.getElementById('root-folder-list'));
        }
      }
    });
    global.router.addRoute('/reading-lists', () => {
      if (typeof global.openReadingListModal === 'function') {
        global.openReadingListModal();
      }
    });
    global.router.addRoute('/library', (params, query) => {
      const rootFolder = query.get('rootFolder');
      if (rootFolder && typeof global.showPublisherList === 'function') {
        global.showPublisherList(decodeURIComponent(rootFolder));
      } else {
        if (typeof global.showRootFolderList === 'function') {
          global.showRootFolderList();
        } else {
          if (typeof global.showView === 'function') {
            global.showView(document.getElementById('root-folder-list'));
          }
        }
      }
    });
    global.router.addRoute('/series-list', (params, query) => {
      const publisher = query.get('publisher');
      global.currentRootFolder = query.get('rootFolder') || null;
      if (publisher && typeof global.showSeriesList === 'function') {
        global.showSeriesList(decodeURIComponent(publisher));
      }
    });
    global.router.addRoute('/settings', () => {
      if (typeof global.openSettingsModal === 'function') {
        global.openSettingsModal();
      }
      const generalTab = document.getElementById('settings-tab-general');
      if (generalTab) {
        generalTab.click();
      } else {
        // Fallback for non-admins - try to click the first available user tab
        const downloadsTab = document.getElementById('settings-tab-downloads');
        if (downloadsTab) {
          downloadsTab.click();
        } else {
          const devicesTab = document.getElementById('settings-tab-devices');
          if (devicesTab) devicesTab.click();
        }
      }
    });
    
    // 2. Specific Settings Tabs
    global.router.addRoute('/settings/logs', () => {
      if (typeof global.openSettingsModal === 'function') {
        global.openSettingsModal();
      }
      const logsTab = document.getElementById('settings-tab-logs');
      if (logsTab) logsTab.click();
    });

    global.router.addRoute('/settings/downloads', () => {
      if (typeof global.openSettingsModal === 'function') {
        global.openSettingsModal();
      }
      const downloadsTab = document.getElementById('settings-tab-downloads');
      if (downloadsTab) downloadsTab.click();
    });

    global.router.addRoute('/settings/defaults', () => {
      if (typeof global.openSettingsModal === 'function') {
        global.openSettingsModal();
      }
      const defaultsTab = document.getElementById('settings-tab-comics-defaults');
      if (defaultsTab) defaultsTab.click();
    });

    global.router.addRoute('/settings/devices', () => {
      if (typeof global.openSettingsModal === 'function') {
        global.openSettingsModal();
      }
      const devicesTab = document.getElementById('settings-tab-devices');
      if (devicesTab) devicesTab.click();
    });

    global.router.addRoute('/settings/users', () => {
      if (typeof global.openSettingsModal === 'function') {
        global.openSettingsModal();
      }
      const usersTab = document.getElementById('settings-tab-users');
      if (usersTab) usersTab.click();
    });

    global.router.addRoute('/comictagger', () => {
      if (typeof global.openCTModal === 'function') global.openCTModal();
      if (ctTabSettings) ctTabSettings.click();
    });

    global.router.addRoute('/comictagger/matches', () => {
      if (typeof global.openCTModal === 'function') global.openCTModal();
      if (ctTabMatches) ctTabMatches.click();
    });

    global.router.addRoute('/comictagger/output', () => {
      if (typeof global.openCTModal === 'function') global.openCTModal();
      if (ctTabOutput) ctTabOutput.click();
    });

    global.router.addRoute('/comictagger/management', () => {
      if (typeof global.openCTModal === 'function') global.openCTModal();
      if (ctTabManagement) ctTabManagement.click();
    });

    global.router.addRoute('/settings/guided-reader', () => {
      if (typeof global.openSettingsModal === 'function') {
        global.openSettingsModal();
      }
      const guidedTab = document.getElementById('settings-tab-guided-reader');
      if (guidedTab) guidedTab.click();
    });

    global.router.addRoute('/folder', (params, query) => {
      const folderPath = query.get('path');
      if (folderPath && typeof global.showFolderView === 'function') {
        global.showFolderView(decodeURIComponent(folderPath));
      } else {
        if (typeof global.showRootFolderList === 'function') {
          global.showRootFolderList();
        } else {
          if (typeof global.showView === 'function') {
            global.showView(document.getElementById('root-folder-list'));
          }
        }
      }
    });

    // Search Route
    global.router.addRoute('/search', (params, query) => {
      const q = query.get('q');
      const field = query.get('field') || 'all';
      if (q && typeof global.showSearchView === 'function') {
        global.showSearchView(q, field);
      } else {
        const results = document.getElementById('search-results-view');
        if (results && typeof global.showView === 'function') global.showView(results);
      }
    });

    // 3. Series, Comic, and Page Views
    global.router.addRoute('/series/:seriesName', (params, query) => {
      const seriesName = decodeURIComponent(params.seriesName);
      global.currentRootFolder = query.get('rootFolder') || null;
      global.currentPublisher = query.get('publisher') || null;

      // If missing publisher/rootFolder, try to find them in the library
      if ((!global.currentRootFolder || !global.currentPublisher) && global.library) {
        for (const rootPath of Object.keys(global.library)) {
          const rootData = global.library[rootPath];
          if (!rootData.publishers) continue;
          for (const pubName of Object.keys(rootData.publishers)) {
            const pubData = rootData.publishers[pubName];
            if (pubData.series && pubData.series[seriesName]) {
              global.currentRootFolder = rootPath;
              global.currentPublisher = pubName;
              break;
            }
          }
          if (global.currentPublisher) break;
        }
      }

      if (typeof global.showComicList === 'function') {
        global.showComicList(seriesName);
      }
    });

    global.router.addRoute('/comic/:id', (params, query) => {
      if (typeof global.getComicById === 'function' && typeof global.openComicViewer === 'function') {
        const result = global.getComicById(params.id, true);
        const folderPath = query.get('folderPath');
        if (result) {
          // Recover context if missing (e.g. on refresh)
          if (result.rootFolder) global.currentRootFolder = result.rootFolder;
          if (result.publisher) global.currentPublisher = result.publisher;
          if (result.series) global.currentSeries = result.series;
          if (folderPath) global.currentFolderPath = decodeURIComponent(folderPath);
          
          global.openComicViewer(result.comic);
        }
      }
    });

    global.router.addRoute('/comic/:id/page/:pageNumber', (params, query) => {
      if (typeof global.getComicById === 'function' && typeof global.openComicViewer === 'function') {
        const result = global.getComicById(params.id, true);
        const folderPath = query.get('folderPath');
        if (result) {
          // Recover context if missing
          if (result.rootFolder) global.currentRootFolder = result.rootFolder;
          if (result.publisher) global.currentPublisher = result.publisher;
          if (result.series) global.currentSeries = result.series;
          if (folderPath) global.currentFolderPath = decodeURIComponent(folderPath);

          global.openComicViewer(result.comic);
          const pageNum = parseInt(params.pageNumber, 10);
          setTimeout(() => {
            if (typeof global.turnToPage === 'function') global.turnToPage(pageNum - 1); 
          }, 300);
        }
      }
    });
  }
}

export { registerRoutes };

state.registerRoutes = registerRoutes;

if (typeof window !== 'undefined') {
  window.registerRoutes = registerRoutes;
}
