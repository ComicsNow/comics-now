module.exports = function attach(router, deps) {
  const {
    dbGet, dbRun, log, formatErrorMessage,
    requireAuth, setMangaModePreference, getComicsDirectories
  } = deps;

  // Toggle / set guided mode for a single comic.
  router.post('/api/v1/comics/:id/guided-mode', requireAuth, async (req, res) => {
    try {
      const { guidedMode } = req.body || {};
      if (typeof guidedMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'guidedMode must be boolean' });
      }
      const row = await dbGet('SELECT id FROM comics WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ ok: false, message: 'Comic not found' });
      await dbRun('UPDATE comics SET guidedMode = ? WHERE id = ?', [guidedMode ? 1 : 0, req.params.id]);
      res.json({ ok: true, comicId: req.params.id, guidedMode });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to set guided mode') });
    }
  });

  // Toggle / set bubble zoom mode for a single comic.
  router.post('/api/v1/comics/:id/bubble-mode', requireAuth, async (req, res) => {
    try {
      const { bubbleMode } = req.body || {};
      if (typeof bubbleMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'bubbleMode must be boolean' });
      }
      const row = await dbGet('SELECT id FROM comics WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ ok: false, message: 'Comic not found' });
      await dbRun('UPDATE comics SET bubbleMode = ? WHERE id = ?', [bubbleMode ? 1 : 0, req.params.id]);
      res.json({ ok: true, comicId: req.params.id, bubbleMode });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to set bubble mode') });
    }
  });

  // Toggle / set hot-zoom mode for a single comic.
  router.post('/api/v1/comics/:id/hot-zoom-mode', requireAuth, async (req, res) => {
    try {
      const { hotZoomMode } = req.body || {};
      if (typeof hotZoomMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'hotZoomMode must be boolean' });
      }
      const row = await dbGet('SELECT id FROM comics WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ ok: false, message: 'Comic not found' });
      await dbRun('UPDATE comics SET hotZoomMode = ? WHERE id = ?', [hotZoomMode ? 1 : 0, req.params.id]);
      res.json({ ok: true, comicId: req.params.id, hotZoomMode });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to set hot zoom mode') });
    }
  });

  // Toggle / set manga bubble-hot mode for a single comic.
  router.post('/api/v1/comics/:id/manga-bubble-hot-mode', requireAuth, async (req, res) => {
    try {
      const { mangaBubbleHotMode } = req.body || {};
      if (typeof mangaBubbleHotMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'mangaBubbleHotMode must be boolean' });
      }
      const row = await dbGet('SELECT id FROM comics WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ ok: false, message: 'Comic not found' });
      await dbRun('UPDATE comics SET mangaBubbleHotMode = ? WHERE id = ?', [mangaBubbleHotMode ? 1 : 0, req.params.id]);
      res.json({ ok: true, comicId: req.params.id, mangaBubbleHotMode });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to set manga bubble-hot mode') });
    }
  });

  // Persist landscape orientation preference per comic so the next open
  // restores the user's last reading orientation for that issue.
  router.post('/api/v1/comics/:id/landscape-mode', requireAuth, async (req, res) => {
    try {
      const { landscapeMode } = req.body || {};
      if (typeof landscapeMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'landscapeMode must be boolean' });
      }
      const row = await dbGet('SELECT id FROM comics WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ ok: false, message: 'Comic not found' });
      await dbRun('UPDATE comics SET landscapeMode = ? WHERE id = ?', [landscapeMode ? 1 : 0, req.params.id]);
      res.json({ ok: true, comicId: req.params.id, landscapeMode });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to set landscape mode') });
    }
  });

  router.post('/api/v1/comics/:id/full-image-mode', requireAuth, async (req, res) => {
    try {
      const { fullImageMode } = req.body || {};
      if (typeof fullImageMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'fullImageMode must be boolean' });
      }
      const row = await dbGet('SELECT id FROM comics WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ ok: false, message: 'Comic not found' });
      await dbRun('UPDATE comics SET fullImageMode = ? WHERE id = ?', [fullImageMode ? 1 : 0, req.params.id]);
      res.json({ ok: true, comicId: req.params.id, fullImageMode });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to set full image mode') });
    }
  });

  // Toggle manga mode for a comic (PER-USER preference)
  router.post('/api/v1/comics/manga-mode', requireAuth, async (req, res) => {
    try {
      const { comicId, mangaMode } = req.body;
      if (!comicId || typeof mangaMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request' });
      }

      // Get userId from authenticated user
      const userId = req.user?.userId || 'default-user';

      const comic = await dbGet('SELECT id FROM comics WHERE id = ?', [comicId]);
      if (!comic) {
        return res.status(404).json({ ok: false, message: 'Comic not found' });
      }

      // Store manga mode preference per-user (not in comics table)
      await setMangaModePreference(userId, 'comic', comicId, mangaMode);

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

        await setMangaModePreference(userId, preferenceType, targetId, mangaMode);

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
          await setMangaModePreference(userId, 'library', dir, mangaMode);
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

  // Get user's default continuous mode preference
  router.get('/api/v1/continuous-mode-preference', requireAuth, async (req, res) => {
    try {
      const userId = req.user?.userId || 'default-user';

      // Check user_settings for continuousModeDefault
      const setting = await dbGet(
        `SELECT continuousModeDefault FROM user_settings WHERE userId = ? AND key = 'continuousMode'`,
        [userId]
      );

      const continuousMode = setting ? (setting.continuousModeDefault === 1) : false;

      res.json({ ok: true, continuousMode });
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
      await dbRun(
        `INSERT INTO user_settings (userId, key, continuousModeDefault)
         VALUES (?, 'continuousMode', ?)
         ON CONFLICT(userId, key) DO UPDATE SET continuousModeDefault = excluded.continuousModeDefault`,
        [userId, continuousMode ? 1 : 0]
      );
      res.json({ ok: true, continuousMode });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to save continuous mode preference: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to save continuous mode preference') });
    }
  });

  // Mirror of /api/v1/comics/set-all-manga-mode for continuous mode:
  // wipes any per-comic continuousMode overrides, then writes the new
  // default into user_settings. Library rebuild then applies the default
  // to every comic that has no explicit preference.
  router.post('/api/v1/comics/set-all-continuous-mode', requireAuth, async (req, res) => {
    try {
      const { continuousMode } = req.body || {};
      if (typeof continuousMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'continuousMode must be boolean' });
      }
      const userId = req.user?.userId || 'default-user';

      // Clear all per-comic continuousMode overrides so the new default wins.
      const clearResult = await dbRun(
        `UPDATE user_comic_status SET continuousMode = NULL WHERE userId = ?`,
        [userId]
      );
      const clearedCount = clearResult.changes || 0;

      // Persist the new default in user_settings.
      await dbRun(
        `INSERT INTO user_settings (userId, key, continuousModeDefault)
         VALUES (?, 'continuousMode', ?)
         ON CONFLICT(userId, key) DO UPDATE SET continuousModeDefault = excluded.continuousModeDefault`,
        [userId, continuousMode ? 1 : 0]
      );

      log('INFO', 'CONTINUOUS_MODE', `User ${userId} set all comics continuous mode to ${continuousMode} (cleared ${clearedCount} overrides)`);

      res.json({ ok: true, continuousMode, clearedCount });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to set all continuous modes: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update continuous modes') });
    }
  });

  // Toggle continuous mode for a specific comic (per-user)
  router.post('/api/v1/comics/continuous-mode', requireAuth, async (req, res) => {
    try {
      const { comicId, continuousMode } = req.body;
      if (!comicId || typeof continuousMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request: comicId and continuousMode (boolean) required' });
      }

      const userId = req.user?.userId || 'default-user';

      // Verify comic exists
      const comic = await dbGet('SELECT id FROM comics WHERE id = ?', [comicId]);
      if (!comic) {
        return res.status(404).json({ ok: false, message: 'Comic not found' });
      }

      // Update or insert continuous mode for this comic in user_comic_status
      await dbRun(
        `INSERT INTO user_comic_status (userId, comicId, continuousMode)
         VALUES (?, ?, ?)
         ON CONFLICT(userId, comicId) DO UPDATE SET
           continuousMode = excluded.continuousMode,
           updatedAt = (strftime('%s', 'now') * 1000)`,
        [userId, comicId, continuousMode ? 1 : null]
      );

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
