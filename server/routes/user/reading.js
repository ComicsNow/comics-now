module.exports = function attach(router, deps) {
  const {
    dbGet, dbRun, log, formatErrorMessage, validateComicId,
    requireAuth, setReadingPreference, getComicsDirectories
  } = deps;

  // Toggle manga mode for a comic (PER-USER preference)
  router.post('/api/v1/comics/manga-mode', requireAuth, async (req, res) => {
    try {
      const { comicId: rawId, mangaMode } = req.body;
      const v = validateComicId(rawId);
      if (!v.valid) return res.status(400).json({ ok: false, message: v.error });
      const comicId = v.sanitized;

      if (!comicId || typeof mangaMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request' });
      }

      // Get userId from authenticated user
      const userId = req.user?.userId || 'default-user';

      const comic = await dbGet('SELECT id FROM comics WHERE id = ?', [comicId]);
      if (!comic) {
        return res.status(404).json({ ok: false, message: 'Comic not found' });
      }

      // Store manga mode preference per-user
      await setReadingPreference(userId, 'comic', comicId, mangaMode, undefined);

      log('INFO', 'MANGA_MODE', `User ${userId} set comic ${comicId} manga mode to ${mangaMode}`);

      res.json({
        ok: true,
        mangaMode
      });
    } catch (e) {
      log('ERROR', 'MANGA_MODE', `Failed to update manga mode: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update manga mode') });
    }
  });

  // Get current library-level manga mode preference for the user
  router.get('/api/v1/manga-mode-preference', requireAuth, async (req, res) => {
    try {
      const userId = req.user?.userId || 'default-user';
      const directories = getComicsDirectories();

      // Check if any library has manga mode enabled
      // If at least one library has it, return true
      let hasAnyMangaMode = false;

      for (const dir of directories) {
        const pref = await dbGet(
          `SELECT mangaMode FROM user_reading_preferences
           WHERE userId = ? AND preferenceType = 'library' AND targetId = ?`,
          [userId, dir]
        );

        if (pref && pref.mangaMode === 1) {
          hasAnyMangaMode = true;
          break;
        }
      }

      res.json({ ok: true, mangaMode: hasAnyMangaMode });
    } catch (e) {
      log('ERROR', 'MANGA_MODE', `Failed to get manga mode preference: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to get manga mode preference') });
    }
  });

  // Set manga mode for all comics or at hierarchy level (PER-USER preference)
  router.post('/api/v1/comics/set-all-manga-mode', requireAuth, async (req, res) => {
    try {
      const { mangaMode, preferenceType, targetId } = req.body;
      if (typeof mangaMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request: mangaMode must be boolean' });
      }

      const userId = req.user?.userId || 'default-user';

      // If preferenceType and targetId are provided, set at that level
      // Otherwise, set at library level for all root folders
      if (preferenceType && targetId) {
        // Validate preferenceType
        if (!['comic', 'series', 'publisher', 'library'].includes(preferenceType)) {
          return res.status(400).json({ ok: false, message: 'Invalid preferenceType' });
        }

        await setReadingPreference(userId, preferenceType, targetId, mangaMode, undefined);

        log('INFO', 'MANGA_MODE', `User ${userId} set ${preferenceType} '${targetId}' manga mode to ${mangaMode}`);

        res.json({
          ok: true,
          preferenceType,
          targetId,
          mangaMode
        });
      } else {
        // Set at library level for all root folders (user wants ALL comics in manga mode)
        // IMPORTANT: Clear all more specific preferences first to avoid hierarchy conflicts
        const deleteResult = await dbRun(
          `DELETE FROM user_reading_preferences
           WHERE userId = ? AND preferenceType IN ('comic', 'series', 'publisher')`,
          [userId]
        );
        const deletedCount = deleteResult.changes || 0;

        log('INFO', 'MANGA_MODE', `Cleared ${deletedCount} specific manga preferences for user ${userId}`);

        // Now set library-level preferences
        const directories = getComicsDirectories();
        for (const dir of directories) {
          await setReadingPreference(userId, 'library', dir, mangaMode, undefined);
        }

        log('INFO', 'MANGA_MODE', `User ${userId} set all libraries (${directories.length} root folders) manga mode to ${mangaMode}`);

        res.json({
          ok: true,
          updatedCount: directories.length,
          clearedCount: deletedCount,
          mangaMode
        });
      }
    } catch (e) {
      log('ERROR', 'MANGA_MODE', `Failed to set manga modes: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update manga modes') });
    }
  });

  // === CONTINUOUS MODE ENDPOINTS ===

  // Get user's default continuous mode preference (hierarchical library level)
  router.get('/api/v1/continuous-mode-preference', requireAuth, async (req, res) => {
    try {
      const userId = req.user?.userId || 'default-user';
      const directories = getComicsDirectories();

      // Check if any library has continuous mode enabled
      let hasAnyContinuousMode = false;

      for (const dir of directories) {
        const pref = await dbGet(
          `SELECT continuousMode FROM user_reading_preferences
           WHERE userId = ? AND preferenceType = 'library' AND targetId = ?`,
          [userId, dir]
        );

        if (pref && pref.continuousMode === 1) {
          hasAnyContinuousMode = true;
          break;
        }
      }

      res.json({ ok: true, continuousMode: hasAnyContinuousMode });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to get continuous mode preference: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to get continuous mode preference') });
    }
  });

  router.post('/api/v1/continuous-mode-preference', requireAuth, async (req, res) => {
    try {
      const { continuousMode } = req.body || {};
      if (typeof continuousMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'continuousMode must be boolean' });
      }
      const userId = req.user?.userId || 'default-user';
      const directories = getComicsDirectories();

      // Set library-level preferences for all root folders
      for (const dir of directories) {
        await setReadingPreference(userId, 'library', dir, undefined, continuousMode);
      }

      res.json({ ok: true, continuousMode });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to save continuous mode preference: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to save continuous mode preference') });
    }
  });

  // Mirror of /api/v1/comics/set-all-manga-mode for continuous mode:
  // wipes any per-comic continuousMode overrides, then writes the new
  // library-level preference.
  router.post('/api/v1/comics/set-all-continuous-mode', requireAuth, async (req, res) => {
    try {
      const { continuousMode } = req.body || {};
      if (typeof continuousMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'continuousMode must be boolean' });
      }
      const userId = req.user?.userId || 'default-user';

      // Clear all more specific continuous mode overrides
      const clearResult = await dbRun(
        `UPDATE user_reading_preferences SET continuousMode = NULL
         WHERE userId = ? AND preferenceType IN ('comic', 'series', 'publisher')`,
        [userId]
      );
      const clearedCount = clearResult.changes || 0;

      // Set library-level preferences for all root folders
      const directories = getComicsDirectories();
      for (const dir of directories) {
        await setReadingPreference(userId, 'library', dir, undefined, continuousMode);
      }

      log('INFO', 'CONTINUOUS_MODE', `User ${userId} set all comics continuous mode to ${continuousMode} (cleared ${clearedCount} specific preferences)`);

      res.json({ ok: true, continuousMode, clearedCount });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to set all continuous modes: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update continuous modes') });
    }
  });

  // GET /api/v1/user/library-preferences
  router.get('/api/v1/user/library-preferences', requireAuth, async (req, res) => {
    try {
      const userId = req.user?.userId || 'default-user';
      const directories = getComicsDirectories();
      const results = [];

      for (const dir of directories) {
        const pref = await dbGet(
          `SELECT mangaMode, continuousMode FROM user_reading_preferences
           WHERE userId = ? AND preferenceType = 'library' AND targetId = ?`,
          [userId, dir]
        );

        results.push({
          path: dir,
          mangaMode: pref ? (pref.mangaMode === 1) : false,
          continuousMode: pref ? (pref.continuousMode === 1) : false
        });
      }

      res.json({ ok: true, preferences: results });
    } catch (e) {
      log('ERROR', 'READING_PREFS', `Failed to get library preferences: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to get library preferences') });
    }
  });

  // POST /api/v1/user/library-preferences
  router.post('/api/v1/user/library-preferences', requireAuth, async (req, res) => {
    try {
      const { path, mangaMode, continuousMode } = req.body;
      if (!path) {
        return res.status(400).json({ ok: false, message: 'Bad request: path is required' });
      }

      const userId = req.user?.userId || 'default-user';
      
      // Update the library preference
      await setReadingPreference(userId, 'library', path, mangaMode, continuousMode);

      // Clear specific overrides within that library path using subqueries for efficiency
      // Clear comic overrides
      await dbRun(
        `DELETE FROM user_reading_preferences 
         WHERE userId = ? AND preferenceType = 'comic' 
         AND targetId IN (SELECT id FROM comics WHERE path LIKE ? || '%')`,
        [userId, path]
      );

      // Clear series overrides
      await dbRun(
        `DELETE FROM user_reading_preferences 
         WHERE userId = ? AND preferenceType = 'series' 
         AND targetId IN (SELECT DISTINCT series FROM comics WHERE path LIKE ? || '%' AND series IS NOT NULL)`,
        [userId, path]
      );

      // Clear publisher overrides
      await dbRun(
        `DELETE FROM user_reading_preferences 
         WHERE userId = ? AND preferenceType = 'publisher' 
         AND targetId IN (SELECT DISTINCT publisher FROM comics WHERE path LIKE ? || '%' AND publisher IS NOT NULL)`,
        [userId, path]
      );

      log('INFO', 'READING_PREFS', `User ${userId} set library ${path} preferences (m:${mangaMode}, c:${continuousMode}) and cleared overrides`);

      res.json({ ok: true });
    } catch (e) {
      log('ERROR', 'READING_PREFS', `Failed to set library preferences: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to set library preferences') });
    }
  });

  // Toggle continuous mode for a specific comic (per-user)
  router.post('/api/v1/comics/continuous-mode', requireAuth, async (req, res) => {
    try {
      const { comicId: rawId, continuousMode } = req.body;
      const v = validateComicId(rawId);
      if (!v.valid) return res.status(400).json({ ok: false, message: v.error });
      const comicId = v.sanitized;

      if (!comicId || typeof continuousMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request: comicId and continuousMode (boolean) required' });
      }

      const userId = req.user?.userId || 'default-user';

      // Verify comic exists
      const comic = await dbGet('SELECT id FROM comics WHERE id = ?', [comicId]);
      if (!comic) {
        return res.status(404).json({ ok: false, message: 'Comic not found' });
      }

      // Update or insert continuous mode for this comic
      await setReadingPreference(userId, 'comic', comicId, undefined, continuousMode);

      log('INFO', 'CONTINUOUS_MODE', `User ${userId} set comic ${comicId} continuous mode to ${continuousMode}`);

      res.json({
        ok: true,
        continuousMode
      });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to update continuous mode: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update continuous mode') });
    }
  });
};
