/**
 * Admin Settings Routes
 * @param {object} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  const {
    getLibraries,
    addLibrary,
    removeLibrary,
    saveSetting,
    scheduleNextScan,
    formatErrorMessage,
    validateScanInterval,
    validateApiKey,
    requireAdmin,
    dbAll,
    dbRun,
    log
  } = deps;

  const fs = require('fs');
  const path = require('path');
  const { THUMBNAILS_DIRECTORY, GUIDED_VIEW_DIR } = require('../../constants');

  // Delete one comic's on-disk artifacts and every DB reference to it.
  async function purgeComicRow(c) {
    try {
      const thumb = c.thumbnailPath
        ? path.join(THUMBNAILS_DIRECTORY, path.basename(c.thumbnailPath))
        : path.join(THUMBNAILS_DIRECTORY, `${c.id}.jpg`);
      if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    } catch (_) {}
    try {
      const gv = path.join(GUIDED_VIEW_DIR, `${c.id}.json`);
      if (fs.existsSync(gv)) fs.unlinkSync(gv);
    } catch (_) {}

    const id = c.id;
    // Tables that may not exist in every deployment are ignored individually.
    try { await dbRun('DELETE FROM progress WHERE comicId = ?', [id]); } catch (_) {}
    try { await dbRun('DELETE FROM device_progress WHERE comicId = ?', [id]); } catch (_) {}
    try { await dbRun('DELETE FROM reading_list_items WHERE comicId = ?', [id]); } catch (_) {}
    try { await dbRun('DELETE FROM user_bookmarks WHERE comicId = ?', [id]); } catch (_) {}
    try { await dbRun("DELETE FROM reading_mode_preferences WHERE targetId = ? AND preferenceType = 'comic'", [id]); } catch (_) {}
    try { await dbRun("DELETE FROM user_library_access WHERE accessType = 'comic' AND accessValue = ?", [id]); } catch (_) {}
    try { await dbRun('DELETE FROM comics WHERE id = ?', [id]); } catch (_) {}
  }

  const normRoot = (p) => String(p || '').replace(/[/\\]+$/, '');
  const isUnder = (comicPath, root) =>
    comicPath === root || comicPath.startsWith(root + '/') || comicPath.startsWith(root + '\\');

  /**
   * Purge every comic (and all its references) that lives under a library path.
   * Called when a library is removed so nothing is left orphaned in the DB.
   */
  async function purgeLibraryFromDb(libPath) {
    if (!dbAll || !dbRun) return 0;
    const root = normRoot(libPath);
    // Match the folder itself and anything beneath it (avoids matching sibling
    // dirs that merely share a name prefix, e.g. "/media/New" vs "/media/NewX").
    const comics = await dbAll(
      'SELECT id, thumbnailPath, guidedViewPath FROM comics WHERE path = ? OR path LIKE ? OR path LIKE ?',
      [root, `${root}/%`, `${root}\\%`]
    );
    for (const c of comics) await purgeComicRow(c);

    try { await dbRun("DELETE FROM user_library_access WHERE accessType = 'root_folder' AND accessValue = ?", [root]); } catch (_) {}
    try { await dbRun("DELETE FROM user_library_access WHERE accessType = 'folder' AND (accessValue = ? OR accessValue LIKE ?)", [root, `${root}/%`]); } catch (_) {}

    if (log && comics.length) log('INFO', 'LIBRARY', `Removed library ${root}: purged ${comics.length} comic(s) from DB`);
    return comics.length;
  }

  /**
   * Sweep the DB for comics whose path is under no configured library and not the
   * inbox (comicsLocation) — including rows with a missing/empty path — and delete
   * them. Keeps the library free of orphans (which otherwise break listing).
   */
  async function purgeOrphanedComics() {
    if (!dbAll || !dbRun) return 0;
    const getDirs = deps.getComicsDirectories;
    const roots = ((getDirs ? getDirs() : getLibraries().map(l => l.path)) || [])
      .map(normRoot).filter(Boolean);
    const all = await dbAll('SELECT id, path, thumbnailPath, guidedViewPath FROM comics', []);
    let removed = 0;
    for (const c of all) {
      const p = c.path || '';
      const known = p && roots.some(r => isUnder(p, r));
      if (!known) { await purgeComicRow(c); removed++; }
    }
    if (log && removed) log('INFO', 'LIBRARY', `Purged ${removed} orphaned comic(s) from DB`);
    return removed;
  }

  router.get('/api/v1/admin/libraries', requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, libraries: getLibraries() });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to get libraries') });
    }
  });

  router.post('/api/v1/admin/libraries', requireAdmin, async (req, res) => {
    try {
      const { path, hierarchyMode } = req.body;
      if (!path) {
        return res.status(400).json({ ok: false, message: 'Path is required' });
      }
      const success = addLibrary(path, hierarchyMode || 'metadata');
      if (success) {
        res.json({ ok: true });
      } else {
        res.status(400).json({ ok: false, message: 'Failed to add library (invalid path or already exists)' });
      }
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to add library') });
    }
  });

  router.delete('/api/v1/admin/libraries', requireAdmin, async (req, res) => {
    try {
      const { path } = req.body;
      if (!path) {
        return res.status(400).json({ ok: false, message: 'Path is required' });
      }
      const removedFromConfig = removeLibrary(path);
      // Purge this library's comics, then sweep any remaining orphans (comics no
      // longer under any configured library/inbox, incl. null-path rows).
      const purgedForLibrary = await purgeLibraryFromDb(path);
      const purgedOrphans = await purgeOrphanedComics();
      const totalPurged = purgedForLibrary + purgedOrphans;

      if (removedFromConfig || totalPurged > 0) {
        res.json({ ok: true, removedFromConfig, deletedComics: totalPurged });
      } else {
        res.status(400).json({ ok: false, message: 'Failed to remove library (path not found)' });
      }
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to remove library') });
    }
  });

  router.post('/api/v1/settings', requireAdmin, async (req, res) => {
    try {
      const { interval = 5, apiKey = '', allowedFormats = 'cbz', metadataStorage = 'archive' } = req.body || {};

      // Validate scan interval
      const parsedInterval = parseInt(interval, 10);
      const intervalToValidate = isNaN(parsedInterval) ? 5 : parsedInterval;
      const intervalValidation = validateScanInterval(intervalToValidate);
      if (!intervalValidation.valid) {
        return res.status(400).json({ ok: false, message: intervalValidation.error });
      }

      // Validate API key
      const apiKeyValidation = validateApiKey(apiKey);
      if (!apiKeyValidation.valid) {
        return res.status(400).json({ ok: false, message: apiKeyValidation.error });
      }

      const minutes = intervalValidation.sanitized;
      const sanitizedApiKey = apiKeyValidation.sanitized;

      const effectiveStorage = metadataStorage === 'sidecar' ? 'sidecar' : 'archive';


      deps.setScanIntervalMinutes(minutes);
      deps.setComicVineApiKey(sanitizedApiKey);
      deps.setAllowedFormats(allowedFormats);
      deps.setMetadataStorage(effectiveStorage);

      await saveSetting('scanInterval', minutes);
      await saveSetting('comicVineApiKey', sanitizedApiKey);
      await saveSetting('allowed_formats', allowedFormats);
      await saveSetting('metadata_storage', effectiveStorage);

      scheduleNextScan();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: formatErrorMessage(e, req, 'Failed to save settings') });
    }
  });
};
