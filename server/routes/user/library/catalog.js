const path = require('path');
const { isComicFormatAllowed } = require('../../../services/comic-formats');

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
    getAllowedFormats,
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
      const { query = '', field = 'all' } = req.query;
      const v = validateSearchQuery(query);
      if (!v.valid) {
        return res.status(400).json({ message: v.error });
      }
      const q = v.sanitized;
      const qLower = q.toLowerCase();
      const normalizedField = String(field || 'all').toLowerCase().trim();
      const userId = req.user?.userId || 'default-user';
      const user = await dbGet('SELECT role FROM users WHERE userId = ?', [userId]);
      const userRole = user?.role || 'user';

      if (!q) {
        return res.json([]);
      }

      const searchPattern = `%${q}%`;
      const allowedFormats = typeof getAllowedFormats === 'function' ? getAllowedFormats() : 'cbz';
      const rawRows = await dbAll(
        `SELECT c.*, ucs.lastReadPage as userLastReadPage, ucs.totalPages as userTotalPages
         FROM comics c
         LEFT JOIN user_comic_status ucs ON c.id = ucs.comicId AND ucs.userId = ?
         WHERE (c.name LIKE ? OR c.series LIKE ? OR c.publisher LIKE ? OR c.metadata LIKE ?)`,
        [userId, searchPattern, searchPattern, searchPattern, searchPattern]
      );
      const rows = rawRows.filter(r => isComicFormatAllowed(r.path || r.name, allowedFormats));

      const fieldFilteredRows = rows.filter((r) => {
        const meta = (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })();
        r._parsedMeta = meta;
        const nameVal = String(r.name || '');
        const titleVal = String(meta.Title || meta.title || '');
        const seriesVal = String(r.series || meta.Series || meta.series || '');
        const pubVal = String(r.publisher || meta.Publisher || meta.publisher || '');
        const charVal = String(meta.Characters || meta.characters || '');
        const writerVal = String(meta.Writer || meta.writer || meta.Penciller || meta.penciller || '');
        const summaryVal = String(meta.Summary || meta.summary || meta.description || '');

        if (normalizedField === 'title') {
          return `${nameVal} ${titleVal}`.toLowerCase().includes(qLower);
        }
        if (normalizedField === 'series') {
          return seriesVal.toLowerCase().includes(qLower);
        }
        if (normalizedField === 'publisher') {
          return pubVal.toLowerCase().includes(qLower);
        }
        if (normalizedField === 'character') {
          return charVal.toLowerCase().includes(qLower);
        }
        return `${nameVal} ${titleVal} ${seriesVal} ${pubVal} ${charVal} ${writerVal} ${summaryVal}`.toLowerCase().includes(qLower);
      });

      const prefMaps = await getReadingPrefMaps(userId);
      const directories = getComicsDirectories();

      const accessList = userRole === 'admin' ? [] : await dbAll(
        `SELECT accessType, accessValue, direct_access, child_access
         FROM user_library_access
         WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
        [userId]
      );

      const accessChecks = fieldFilteredRows.map(async (r) => {
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
        const meta = r._parsedMeta || (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })();
        
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

      const escapedQ = qLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = new RegExp(`(?:^|[^a-z0-9])${escapedQ}(?:$|[^a-z0-9])`, 'i');

      const scoreComic = (c) => {
        const meta = c.metadata || {};
        const series = String(c.series || meta.Series || meta.series || '').trim().toLowerCase();
        const title = String(meta.Title || meta.title || '').trim().toLowerCase();
        const rawName = String(c.name || '').trim().toLowerCase().replace(/\.(cbz|cbr|cb7|cbt|zip|rar|pdf)$/i, '');
        const characters = String(meta.Characters || meta.characters || '').toLowerCase();
        const publisher = String(c.publisher || meta.Publisher || meta.publisher || '').toLowerCase();
        const writer = String(meta.Writer || meta.writer || '').toLowerCase();

        let score = 0;
        if (series === qLower || title === qLower || rawName === qLower) {
          score += 1000;
        } else if (series.startsWith(qLower) || title.startsWith(qLower) || rawName.startsWith(qLower)) {
          score += 700;
        } else if (wordRegex.test(series) || wordRegex.test(title) || wordRegex.test(rawName)) {
          score += 500;
        } else if (series.includes(qLower) || title.includes(qLower) || rawName.includes(qLower)) {
          score += 300;
        }
        if (characters.includes(qLower)) score += 150;
        if (publisher.includes(qLower) || writer.includes(qLower)) score += 80;
        return score || 20;
      };

      results.sort((a, b) => {
        const diff = scoreComic(b) - scoreComic(a);
        if (diff !== 0) return diff;
        const sA = String(a.series || a.metadata?.Series || '');
        const sB = String(b.series || b.metadata?.Series || '');
        const sCmp = sA.localeCompare(sB, undefined, { sensitivity: 'base' });
        if (sCmp !== 0) return sCmp;
        const nA = parseFloat(a.metadata?.Number ?? a.metadata?.number);
        const nB = parseFloat(b.metadata?.Number ?? b.metadata?.number);
        if (!Number.isNaN(nA) && !Number.isNaN(nB) && nA !== nB) return nA - nB;
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
      });

      res.json(results);
    } catch (e) {
      log('ERROR', 'LIST', `Search failed: ${e.message}`);
      res.json([]);
    }
  });
};
