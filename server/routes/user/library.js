const fs = require('fs');
const path = require('path');
const { isPathSafe: _isPathSafe } = require('../../utils');
const { rateLimiter } = require('../../middleware/rate-limiter');

module.exports = function attach(router, deps) {
  const libraryLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 1000
  });
  router.use(libraryLimiter);

  const {
    log,
    dbGet,
    dbAll,
    formatErrorMessage,
    buildLibrary,
    getComicsDirectories,
    getLibraryIdFromPath,
    resolvePath,
    generateVirtualMetadata,
    checkComicAccess,
    getReadingPrefMaps,
    resolveReadingModes,
    validateSearchQuery,
    requireAuth
  } = deps;

  const isPathSafe = (requestedPath) => _isPathSafe(log, getComicsDirectories, resolvePath(requestedPath));

  /**
   * Security: Check if a user has access to a specific file or folder path.
   * Handles hierarchical access: root_folder -> publisher -> series.
   * A folder is accessible if the user has direct or child access to it, 
   * or if it's an ancestor of a resource they have access to.
   */
  async function checkPathAccess(userId, userRole, targetPath, accessList) {
    if (userRole === 'admin') return true;

    const rootFolders = getComicsDirectories();
    const rootFolder = rootFolders.find(d => targetPath === d || targetPath.startsWith(d + path.sep));
    if (!rootFolder) return false;

    // Check Root access
    const rootAccess = accessList.find(a => a.accessType === 'root_folder' && a.accessValue === rootFolder);
    if (!rootAccess) return false;
    if (rootAccess.child_access) return true;
    if (!rootAccess.direct_access) return false;

    if (targetPath === rootFolder) return true;

    const relative = path.relative(rootFolder, targetPath);
    const parts = relative.split(path.sep);
    const publisher = parts[0];

    // Check Publisher access
    const pubAccess = accessList.find(a => a.accessType === 'publisher' && publisher && a.accessValue === publisher);
    if (!pubAccess) return false;
    if (pubAccess.child_access) return true;
    if (!pubAccess.direct_access) return false;

    if (parts.length === 1) return true; // It's the Publisher folder

    const series = parts[1];
    // Check Series access
    const serAccess = accessList.find(a => a.accessType === 'series' && series && a.accessValue === series);
    if (!serAccess) return false;
    
    return true;
  }

  router.get('/api/v1/comics', requireAuth, async (req, res) => {
    try {
      // Get userId from authenticated user (or default if auth disabled)
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

      // 1. Optimize: Filter in database using LIKE
      const searchPattern = `%${q}%`;
      const rows = await dbAll(
        'SELECT * FROM comics WHERE (name LIKE ? OR series LIKE ? OR publisher LIKE ? OR metadata LIKE ?)',
        [searchPattern, searchPattern, searchPattern, searchPattern]
      );

      // 2. Load per-user progress once
      const userProgress = await dbAll(
        'SELECT comicId, lastReadPage, totalPages FROM user_comic_status WHERE userId = ?',
        [userId]
      );

      const progressMap = {};
      for (const p of userProgress) {
        progressMap[p.comicId] = { lastReadPage: p.lastReadPage, totalPages: p.totalPages };
      }

      // 3. Load user reading preferences using helper
      const prefMaps = await getReadingPrefMaps(userId);
      const directories = getComicsDirectories();

      // 4. Load access list for checkComicAccess
      const accessList = userRole === 'admin' ? [] : await dbAll(
        `SELECT accessType, accessValue, direct_access, child_access
         FROM user_library_access
         WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
        [userId]
      );

      const results = [];
      for (const r of rows) {
        // Access control: Check if user has access to this comic
        const hasAccess = await checkComicAccess(
          userId,
          userRole,
          r.path,
          r.publisher,
          r.series,
          directories,
          r.id,
          accessList
        );

        if (!hasAccess) {
          continue;
        }

        const meta = (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })();
        
        // Resolve reading modes using hierarchical helper
        const { mangaMode, continuousMode } = resolveReadingModes(r.id, r.series, r.publisher, r.path, prefMaps, directories);

        const userProg = progressMap[r.id] || {};

        const absoluteRootDir = directories.find(d => r.path.startsWith(d));
        const rootDirKey = getLibraryIdFromPath(absoluteRootDir) || 'Library';

        // Redact absolute path
        const redactedPath = path.join(rootDirKey, path.relative(absoluteRootDir || '/', r.path));

        results.push({
          id: r.id,
          name: r.name,
          path: redactedPath,
          thumbnailPath: r.thumbnailPath,
          progress: { 
            lastReadPage: userProg.lastReadPage !== undefined ? userProg.lastReadPage : (r.lastReadPage || 0), 
            totalPages: userProg.totalPages !== undefined ? userProg.totalPages : (r.totalPages || 0)
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

  /**
   * GET /api/v1/folders/:path(*)?
   * Returns contents of a directory, including subdirectories and comics.
   * Path is base64 encoded. If missing or 'root', returns library root folders.
   */
  router.get('/api/v1/folders/:path(*)?', requireAuth, async (req, res) => {
    const { path: encodedPath } = req.params;
    let rawPath = '';
    let decodedPath = '';
    try {
      const userId = req.user.userId;
      const userRole = req.user.role;
      const directories = getComicsDirectories();

      // Pre-fetch user access list once for all checks in this request
      const userAccessList = userRole === 'admin' ? [] : await dbAll(
        `SELECT accessType, accessValue, direct_access, child_access
         FROM user_library_access
         WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
        [userId]
      );

      // Handle root case
      if (!encodedPath || encodedPath === 'root') {
        const allowedRoots = userRole === 'admin' 
          ? directories 
          : directories.filter(d => userAccessList.some(a => a.accessType === "root_folder" && a.accessValue === d));

        return res.json({
          ok: true,
          path: 'root',
          name: 'Root',
          folders: allowedRoots.map(dir => ({
            name: path.basename(dir),
            path: getLibraryIdFromPath(dir)
          })),
          comics: []
        });
      }

      // Decode path
      try {
        rawPath = Buffer.from(encodedPath, 'base64').toString('utf-8');
        decodedPath = resolvePath(rawPath);
        log('DEBUG', 'API', `Decoded folder path: ${decodedPath} (from raw: ${rawPath})`);
      } catch (e) {
        log('ERROR', 'API', `Invalid path encoding: ${encodedPath}`);
        return res.status(400).json({ ok: false, message: 'Invalid path encoding' });
      }

      if (!isPathSafe(decodedPath)) {
        log('WARN', 'SECURITY', `isPathSafe check failed for: ${decodedPath}`);
        return res.status(403).json({ ok: false, message: 'Access denied' });
      }

      // Security: Logical access check for the directory itself
      const isFolderAccessible = await checkPathAccess(userId, userRole, decodedPath, userAccessList);

      if (!isFolderAccessible) {
        log('WARN', 'SECURITY', `checkPathAccess check failed for user ${userId} on directory: ${decodedPath}`);
        return res.status(403).json({ ok: false, message: 'Access denied' });
      }

      if (!fs.existsSync(decodedPath)) {
        return res.status(404).json({ ok: false, message: 'Directory not found' });
      }

      const stats = await fs.promises.stat(decodedPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ ok: false, message: 'Path is not a directory' });
      }

      // Read directory contents
      const entries = await fs.promises.readdir(decodedPath, { withFileTypes: true });
      
      const rawFolders = [];
      const comicFiles = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(decodedPath, entry.name);
        if (entry.isDirectory()) {
          rawFolders.push({
            name: entry.name,
            path: fullPath
          });
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.cbz', '.cbr'].includes(ext)) {
            comicFiles.push({
              name: entry.name,
              path: fullPath
            });
          }
        }
      }

      // Parallelized subfolder access checks
      const folderChecks = rawFolders.map(async (f) => {
        const hasAccess = await checkPathAccess(userId, userRole, f.path, userAccessList);
        return hasAccess ? f : null;
      });

      const folderEntries = (await Promise.all(folderChecks)).filter(f => f !== null);

      // Sort folders alphabetically
      folderEntries.sort((a, b) => a.name.localeCompare(b.name));

      // Process comics with DB join for metadata and progress
      let comics = [];
      if (comicFiles.length > 0) {
        const paths = comicFiles.map(f => f.path);
        const placeholders = paths.map(() => '?').join(',');
        
        const prefMaps = await getReadingPrefMaps(userId);

        const dbComics = await dbAll(`
          SELECT c.id, c.name, c.path, c.thumbnailPath, c.publisher, c.series, c.totalPages as dbTotalPages,
                 ucs.lastReadPage, ucs.totalPages as userTotalPages
          FROM comics c
          LEFT JOIN user_comic_status ucs ON c.id = ucs.comicId AND ucs.userId = ?
          WHERE c.path IN (${placeholders})
        `, [userId, ...paths]);

        const dbComicsMap = new Map();
        dbComics.forEach(c => dbComicsMap.set(c.path, c));

        // Parallelized comic access checks
        const comicChecks = comicFiles.map(async (f) => {
          const dbComic = dbComicsMap.get(f.path);
          
          if (dbComic) {
            const hasAccess = await checkComicAccess(
              userId,
              userRole,
              dbComic.path,
              dbComic.publisher,
              dbComic.series,
              directories,
              dbComic.id,
              userAccessList
            );

            if (!hasAccess) return null;

            const { mangaMode, continuousMode } = resolveReadingModes(dbComic.id, dbComic.series, dbComic.publisher, dbComic.path, prefMaps, directories);

            return {
              id: dbComic.id,
              name: dbComic.name || f.name,
              path: dbComic.path,
              thumbnailPath: dbComic.thumbnailPath,
              mangaMode: mangaMode,
              continuousMode: continuousMode ?? false,
              progress: {
                lastReadPage: dbComic.lastReadPage !== null ? dbComic.lastReadPage : 0,
                totalPages: dbComic.userTotalPages || dbComic.dbTotalPages || 0
              },
              libraryMode: 'folder'
            };
          } else {
            // Unscanned comic: derive virtual metadata and check access
            const rootFolder = directories.find(d => f.path.startsWith(d));
            const vMeta = generateVirtualMetadata(f.path, rootFolder);
            const hasAccess = await checkComicAccess(
              userId,
              userRole,
              f.path,
              vMeta.Publisher,
              vMeta.Series,
              directories,
              null,
              userAccessList
            );

            if (!hasAccess) return null;

            return {
              id: null,
              name: f.name,
              path: f.path,
              thumbnailPath: null,
              progress: { lastReadPage: 0, totalPages: 0 },
              libraryMode: 'folder',
              status: 'not-scanned'
            };
          }
        });

        comics = (await Promise.all(comicChecks)).filter(c => c !== null);
      }

      // Sort comics alphabetically
      comics.sort((a, b) => a.name.localeCompare(b.name));

      const rootDirKey = getLibraryIdFromPath(decodedPath) || 'Library';
      const absoluteRootDir = directories.find(d => decodedPath === d || decodedPath.startsWith(d + path.sep));

      return res.json({
        ok: true,
        path: rawPath,
        name: path.basename(decodedPath),
        folders: folderEntries.map(f => ({
          name: f.name,
          path: path.join(rootDirKey, path.relative(absoluteRootDir, f.path))
        })),
        comics: comics.map(c => ({
          ...c,
          path: path.join(rootDirKey, path.relative(absoluteRootDir, c.path))
        }))
      });

    } catch (e) {
      log('ERROR', 'API', `Failed to read directory ${decodedPath || encodedPath}: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to read directory') });
    }
  });
};
