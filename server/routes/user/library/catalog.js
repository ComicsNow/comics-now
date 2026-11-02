const path = require('path');

/**
 * Attaches user library catalog and search routes.
 * @param {import('express').Router} router
 * @param {object} deps
 */
module.exports = function attachCatalogRoutes(router, deps) {
  const {
    log,
    dbGet,
    dbAll,
    buildLibrary,
    getComicsDirectories,
    getLibraryIdFromPath,
    checkComicAccess,
    getReadingPrefMaps,
    resolveReadingModes,
    validateSearchQuery,
    requireAuth
  } = deps;

  router.get('/api/v1/comics', requireAuth, async (req, res) => {
    try {
      const userId = req.user?.userId || 'default-user';
      const lib = await buildLibrary(userId);
      res.json(lib);
    } catch (e) {
      log('ERROR', 'LIST', `Failed to list library: ${e.message}`);
      res.json({});
    }
  });

  router.get('/api/v1/search', requireAuth, async (req, res) => {
    log('INFO', 'LIST', 'Searching library');
    try {
      const { query = '' } = req.query;
      const v = validateSearchQuery(query);
      if (!v.valid) {
        return res.status(400).json({ message: v.error });
      }
      const q = v.sanitized;
      const userId = req.user?.userId || 'default-user';
      const user = await dbGet('SELECT role FROM users WHERE userId = ?', [userId]);
      const userRole = user?.role || 'user';

      if (!q) {
        return res.json([]);
      }

      const searchPattern = `%${q}%`;
      const rows = await dbAll(
        `SELECT c.*, ucs.lastReadPage as userLastReadPage, ucs.totalPages as userTotalPages
         FROM comics c
         LEFT JOIN user_comic_status ucs ON c.id = ucs.comicId AND ucs.userId = ?
         WHERE (c.name LIKE ? OR c.series LIKE ? OR c.publisher LIKE ? OR c.metadata LIKE ?)`,
        [userId, searchPattern, searchPattern, searchPattern, searchPattern]
      );

      const prefMaps = await getReadingPrefMaps(userId);
      const directories = getComicsDirectories();

      const accessList = userRole === 'admin' ? [] : await dbAll(
        `SELECT accessType, accessValue, direct_access, child_access
         FROM user_library_access
         WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
        [userId]
      );

      const accessChecks = rows.map(async (r) => {
        const hasAccess = await checkComicAccess({
          userId,
          userRole,
          comicPath: r.path,
          publisher: r.publisher,
          series: r.series,
          rootFolders: directories,
          comicId: r.id,
          preFetchedAccessList: accessList
        });
        return hasAccess ? r : null;
      });
      const accessibleRows = (await Promise.all(accessChecks)).filter(r => r !== null);

      const results = [];
      for (const r of accessibleRows) {
        const meta = (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })();
        
        const { mangaMode, continuousMode } = resolveReadingModes({
          comicId: r.id,
          series: r.series,
          publisher: r.publisher,
          comicPath: r.path,
          prefMaps,
          comicsRoots: directories
        });

        const absoluteRootDir = directories.find(d => r.path.startsWith(d));
        const rootDirKey = getLibraryIdFromPath(absoluteRootDir) || 'Library';
        const redactedPath = path.join(rootDirKey, path.relative(absoluteRootDir || '/', r.path));

        results.push({
          id: r.id,
          name: r.name,
          path: redactedPath,
          thumbnailPath: r.thumbnailPath,
          progress: { 
            lastReadPage: r.userLastReadPage !== null ? r.userLastReadPage : (r.lastReadPage || 0),
            totalPages: r.userTotalPages !== null ? r.userTotalPages : (r.totalPages || 0)
          },
          metadata: meta,
          series: r.series,
          publisher: r.publisher,
          mangaMode: mangaMode,
          continuousMode: continuousMode ?? false,
          guidedViewStatus: r.guidedViewStatus || 'pending'
        });
      }
      res.json(results);
    } catch (e) {
      log('ERROR', 'LIST', `Search failed: ${e.message}`);
      res.json([]);
    }
  });
};
