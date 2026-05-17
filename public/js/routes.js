function registerRoutes() {
  if (window.router) {
    // 1. Main views
    window.router.addRoute('/', () => {
      if (typeof window.showRootFolderList === 'function') {
        window.showRootFolderList();
      } else {
        window.showView(document.getElementById('root-folder-list'));
      }
    });
    window.router.addRoute('/reading-lists', () => {
      window.openReadingListModal();
    });
    window.router.addRoute('/library', (params, query) => {
      const rootFolder = query.get('rootFolder');
      if (rootFolder && typeof window.showPublisherList === 'function') {
        window.showPublisherList(decodeURIComponent(rootFolder));
      } else {
        if (typeof window.showRootFolderList === 'function') {
          window.showRootFolderList();
        } else {
          window.showView(document.getElementById('root-folder-list'));
        }
      }
    });
    window.router.addRoute('/series-list', (params, query) => {
      const publisher = query.get('publisher');
      window.currentRootFolder = query.get('rootFolder') || null;
      if (publisher && typeof window.showSeriesList === 'function') {
        window.showSeriesList(decodeURIComponent(publisher));
      }
    });
    window.router.addRoute('/settings', () => {
      window.openSettingsModal();
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
    window.router.addRoute('/settings/logs', () => {
      window.openSettingsModal();
      const logsTab = document.getElementById('settings-tab-logs');
      if (logsTab) logsTab.click();
    });

    window.router.addRoute('/settings/downloads', () => {
      window.openSettingsModal();
      const downloadsTab = document.getElementById('settings-tab-downloads');
      if (downloadsTab) downloadsTab.click();
    });

    window.router.addRoute('/settings/defaults', () => {
      window.openSettingsModal();
      const defaultsTab = document.getElementById('settings-tab-comics-defaults');
      if (defaultsTab) defaultsTab.click();
    });

    window.router.addRoute('/settings/devices', () => {
      window.openSettingsModal();
      const devicesTab = document.getElementById('settings-tab-devices');
      if (devicesTab) devicesTab.click();
    });

    window.router.addRoute('/settings/users', () => {
      window.openSettingsModal();
      const usersTab = document.getElementById('settings-tab-users');
      if (usersTab) usersTab.click();
    });

    window.router.addRoute('/comictagger', () => {
      if (window.openCTModal) window.openCTModal();
      if (ctTabSettings) ctTabSettings.click();
    });

    window.router.addRoute('/comictagger/matches', () => {
      if (window.openCTModal) window.openCTModal();
      if (ctTabMatches) ctTabMatches.click();
    });

    window.router.addRoute('/comictagger/output', () => {
      if (window.openCTModal) window.openCTModal();
      if (ctTabOutput) ctTabOutput.click();
    });

    window.router.addRoute('/comictagger/management', () => {
      if (window.openCTModal) window.openCTModal();
      if (ctTabManagement) ctTabManagement.click();
    });

    window.router.addRoute('/settings/guided-reader', () => {
      window.openSettingsModal();
      const guidedTab = document.getElementById('settings-tab-guided-reader');
      if (guidedTab) guidedTab.click();
    });

    window.router.addRoute('/folder', (params, query) => {
      const folderPath = query.get('path');
      if (folderPath && typeof window.showFolderView === 'function') {
        window.showFolderView(decodeURIComponent(folderPath));
      } else {
        if (typeof window.showRootFolderList === 'function') {
          window.showRootFolderList();
        } else {
          window.showView(document.getElementById('root-folder-list'));
        }
      }
    });

    // Search Route
    window.router.addRoute('/search', (params, query) => {
      const q = query.get('q');
      const field = query.get('field') || 'all';
      if (q && typeof window.showSearchView === 'function') {
        window.showSearchView(q, field);
      } else {
        const results = document.getElementById('search-results-view');
        if (results && window.showView) window.showView(results);
      }
    });

    // 3. Series, Comic, and Page Views
    window.router.addRoute('/series/:seriesName', (params, query) => {
      const seriesName = decodeURIComponent(params.seriesName);
      window.currentRootFolder = query.get('rootFolder') || null;
      window.currentPublisher = query.get('publisher') || null;

      // If missing publisher/rootFolder, try to find them in the library
      if ((!window.currentRootFolder || !window.currentPublisher) && window.library) {
        for (const rootPath of Object.keys(window.library)) {
          const rootData = window.library[rootPath];
          if (!rootData.publishers) continue;
          for (const pubName of Object.keys(rootData.publishers)) {
            const pubData = rootData.publishers[pubName];
            if (pubData.series && pubData.series[seriesName]) {
              window.currentRootFolder = rootPath;
              window.currentPublisher = pubName;
              break;
            }
          }
          if (window.currentPublisher) break;
        }
      }

      if (typeof window.showComicList === 'function') {
        window.showComicList(seriesName);
      }
    });

    window.router.addRoute('/comic/:id', (params, query) => {
      const result = window.getComicById(params.id, true);
      const folderPath = query.get('folderPath');
      if (result && window.openComicViewer) {
        // Recover context if missing (e.g. on refresh)
        if (result.rootFolder) window.currentRootFolder = result.rootFolder;
        if (result.publisher) window.currentPublisher = result.publisher;
        if (result.series) window.currentSeries = result.series;
        if (folderPath) window.currentFolderPath = decodeURIComponent(folderPath);
        
        window.openComicViewer(result.comic);
      }
    });

    window.router.addRoute('/comic/:id/page/:pageNumber', (params, query) => {
      const result = window.getComicById(params.id, true);
      const folderPath = query.get('folderPath');
      if (result && window.openComicViewer) {
        // Recover context if missing
        if (result.rootFolder) window.currentRootFolder = result.rootFolder;
        if (result.publisher) window.currentPublisher = result.publisher;
        if (result.series) window.currentSeries = result.series;
        if (folderPath) window.currentFolderPath = decodeURIComponent(folderPath);

        window.openComicViewer(result.comic);
        const pageNum = parseInt(params.pageNumber, 10);
        setTimeout(() => {
          if (window.turnToPage) window.turnToPage(pageNum - 1); 
        }, 300);
      }
    });
  }
}
