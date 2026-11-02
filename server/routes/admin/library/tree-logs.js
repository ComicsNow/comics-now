const path = require('path');

module.exports = function attachTreeLogsRoutes(router, deps) {
  const {
    log,
    dbAll,
    getComicsDirectories,
    getConfig,
    getLogs,
    formatErrorMessage,
    requireAdmin
  } = deps;

  router.get('/api/v1/library-tree', requireAdmin, async (req, res) => {
    try {
      const comics = await dbAll('SELECT id, path, name, publisher, series FROM comics');
      const rootFolders = getComicsDirectories();

      const config = getConfig();
      const libraries = Array.isArray(config.libraries) ? [...config.libraries] : [];
      if (config.comicsLocation && !libraries.some(l => l.path === config.comicsLocation)) {
        libraries.push({
          path: config.comicsLocation,
          hierarchyMode: 'metadata'
        });
      }

      const getLibraryMode = (rootFolder) => {
        const lib = libraries.find(l => l.path === rootFolder);
        return lib?.hierarchyMode || 'metadata';
      };

      const getRootFolder = (comicPath) => {
        for (const folder of rootFolders) {
          if (comicPath.startsWith(folder)) {
            return folder;
          }
        }
        return 'Unknown';
      };

      const tree = {};

      for (const folder of rootFolders) {
        const mode = getLibraryMode(folder);
        tree[folder] = {
          mode,
          children: {}
        };
      }

      for (const comic of comics) {
        const rootFolder = getRootFolder(comic.path);
        if (rootFolder === 'Unknown') continue;

        const mode = tree[rootFolder].mode;

        if (mode === 'metadata') {
          const pub = comic.publisher || 'Unknown Publisher';
          const ser = comic.series || 'Unknown Series';

          if (!tree[rootFolder].children[pub]) {
            tree[rootFolder].children[pub] = {};
          }
          if (!tree[rootFolder].children[pub][ser]) {
            tree[rootFolder].children[pub][ser] = true;
          }
        } else {
          const relPath = path.relative(rootFolder, comic.path);
          const parts = relPath.split(path.sep);

          let current = tree[rootFolder].children;
          let currentPath = rootFolder;

          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentPath = path.join(currentPath, part);

            if (i === parts.length - 1) {
              current[part] = {
                type: 'comic',
                id: comic.id,
                name: part
              };
            } else {
              if (!current[part]) {
                current[part] = {
                  type: 'folder',
                  path: currentPath,
                  children: {}
                };
              }
              current = current[part].children;
            }
          }
        }
      }

      res.json({ ok: true, tree });
    } catch (error) {
      log('ERROR', 'ACCESS', `Failed to fetch library tree: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to fetch library tree') });
    }
  });

  router.get('/api/v1/logs', requireAdmin, (req, res) => {
    const { level = 'ALL', category = 'ALL' } = req.query;
    const entries = getLogs().filter(l =>
      (level === 'ALL' || l.level === level) &&
      (category === 'ALL' || l.category === category)
    );
    res.json(entries);
  });
};
