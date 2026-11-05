const fs = require('fs');
const path = require('path');
const { isPathSafe: _isPathSafe } = require('../../../utils');
const { isComicFormatAllowed } = require('../../../services/comic-formats');

/**
 * Security: Check if a user has access to a specific file or folder path.
 * Handles hierarchical access: root_folder -> publisher -> series.
 */
async function checkPathAccess(userId, userRole, targetPath, accessList, rootFolders) {
  if (userRole === 'admin') return true;

  const rootFolder = rootFolders.find(d => targetPath === d || targetPath.startsWith(d + path.sep));
  if (!rootFolder) return false;

  const rootAccess = accessList.find(a => a.accessType === 'root_folder' && a.accessValue === rootFolder);
  if (!rootAccess) return false;
  if (rootAccess.child_access) return true;
  if (!rootAccess.direct_access) return false;

  if (targetPath === rootFolder) return true;

  const relative = path.relative(rootFolder, targetPath);
  const parts = relative.split(path.sep);
  const publisher = parts[0];

  const pubAccess = accessList.find(a => a.accessType === 'publisher' && a.accessValue === publisher);
  if (!pubAccess) return false;
  if (pubAccess.child_access) return true;
  if (!pubAccess.direct_access) return false;

  if (parts.length === 1) return true;

  const series = parts[1];
  const serAccess = accessList.find(a => a.accessType === 'series' && a.accessValue === series);
  if (!serAccess) return false;
  
  return true;
}

/**
 * Attaches user library folder navigation and file listing routes.
 * @param {import('express').Router} router
 * @param {object} deps
 */
module.exports = function attachFoldersRoutes(router, deps) {
  const {
    log,
    dbAll,
    formatErrorMessage,
    getComicsDirectories,
    getLibraryIdFromPath,
    getAllowedFormats,
    resolvePath,
    generateVirtualMetadata,
    checkComicAccess,
    getReadingPrefMaps,
    resolveReadingModes,
    requireAuth
  } = deps;

  const isPathSafe = (requestedPath) => _isPathSafe(log, getComicsDirectories, resolvePath(requestedPath));

  router.get('/api/v1/folders/:path(*)?', requireAuth, async (req, res) => {
    const { path: encodedPath } = req.params;
    let rawPath = '';
    let decodedPath = '';
    try {
      const userId = req.user.userId;
      const userRole = req.user.role;
      const directories = getComicsDirectories();
      const allowedFormats = typeof getAllowedFormats === 'function' ? getAllowedFormats() : 'cbz';

      const userAccessList = userRole === 'admin' ? [] : await dbAll(
        `SELECT accessType, accessValue, direct_access, child_access
         FROM user_library_access
         WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
        [userId]
      );

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

      try {
        rawPath = Buffer.from(encodedPath, 'base64').toString('utf-8');
        decodedPath = resolvePath(rawPath);
      } catch (e) {
        log('ERROR', 'API', `Invalid path encoding: ${encodedPath}`);
        return res.status(400).json({ ok: false, message: 'Invalid path encoding' });
      }

      if (!isPathSafe(decodedPath)) {
        log('WARN', 'SECURITY', `isPathSafe check failed for: ${decodedPath}`);
        return res.status(403).json({ ok: false, message: 'Access denied' });
      }

      const isFolderAccessible = await checkPathAccess(userId, userRole, decodedPath, userAccessList, directories);
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

      const entries = await fs.promises.readdir(decodedPath, { withFileTypes: true });
      const rawFolders = [];
      const comicFiles = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(decodedPath, entry.name);
        if (entry.isDirectory()) {
          rawFolders.push({ name: entry.name, path: fullPath });
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.cbz', '.cbr'].includes(ext) && isComicFormatAllowed(entry.name, allowedFormats)) {
            comicFiles.push({ name: entry.name, path: fullPath });
          }
        }
      }

      const folderChecks = rawFolders.map(async (f) => {
        const hasAccess = await checkPathAccess(userId, userRole, f.path, userAccessList, directories);
        return hasAccess ? f : null;
      });
      const folderEntries = (await Promise.all(folderChecks)).filter(f => f !== null);
      folderEntries.sort((a, b) => a.name.localeCompare(b.name));

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

        const comicChecks = comicFiles.map(async (f) => {
          const dbComic = dbComicsMap.get(f.path);
          if (dbComic) {
            const hasAccess = await checkComicAccess({
              userId,
              userRole,
              comicPath: dbComic.path,
              publisher: dbComic.publisher,
              series: dbComic.series,
              rootFolders: directories,
              comicId: dbComic.id,
              preFetchedAccessList: userAccessList
            });

            if (!hasAccess) return null;

            const { mangaMode, continuousMode } = resolveReadingModes({
              comicId: dbComic.id,
              series: dbComic.series,
              publisher: dbComic.publisher,
              comicPath: dbComic.path,
              prefMaps,
              comicsRoots: directories
            });

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
            const rootFolder = directories.find(d => f.path.startsWith(d));
            const vMeta = generateVirtualMetadata(f.path, rootFolder);
            const hasAccess = await checkComicAccess({
              userId,
              userRole,
              comicPath: f.path,
              publisher: vMeta.Publisher,
              series: vMeta.Series,
              rootFolders: directories,
              comicId: null,
              preFetchedAccessList: userAccessList
            });

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
