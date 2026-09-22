
const {
  syncDefaultReadingLists,
  syncDefaultReadingListsToAllUsers,
  deleteReadingListGlobally
} = require('../../services/readingLists');

module.exports = function attach(router, deps) {
  const {
    requireAuth,
    dbAll,
    dbRun,
    dbGet,
    createId,
    formatErrorMessage, validateComicId,
    log
  } = deps;

  // ============================================================================
  // READING LISTS API
  // ============================================================================

  // Get all reading lists for current user with progress stats
  router.get('/api/v1/reading-lists', requireAuth, async (req, res) => {
    try {
      const listsWithStats = await dbAll(
        `SELECT 
            rl.*,
            COUNT(rli.comicId) as totalComics,
            GROUP_CONCAT(DISTINCT c.publisher) as publishers,
            SUM(CASE WHEN ucs.lastReadPage >= ucs.totalPages - 1 AND ucs.totalPages > 0 THEN 1 ELSE 0 END) as readComics,
            SUM(CASE WHEN ucs.lastReadPage > 0 AND ucs.lastReadPage < ucs.totalPages - 1 THEN 1 ELSE 0 END) as inProgressComics,
            SUM(CASE WHEN rli.comicId IS NOT NULL AND (ucs.comicId IS NULL OR (ucs.lastReadPage = 0)) THEN 1 ELSE 0 END) as unreadComics
         FROM reading_lists rl
         LEFT JOIN reading_list_items rli ON rl.id = rli.listId
         LEFT JOIN comics c ON rli.comicId = c.id
         LEFT JOIN user_comic_status ucs ON rli.comicId = ucs.comicId AND ucs.userId = rl.userId
         WHERE rl.userId = ?
         GROUP BY rl.id
         ORDER BY rl.sortOrder ASC, rl.created DESC`,
        [req.user.userId]
      );

      const processedLists = listsWithStats.map(list => ({
        ...list,
        publishers: list.publishers ? list.publishers.split(',').filter(Boolean) : [],
        progressPercent: list.totalComics > 0 ? Math.round((list.readComics / list.totalComics) * 100) : 0
      }));

      res.json({ ok: true, lists: processedLists });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to load reading lists')
      });
    }
  });

  // Reorder reading lists
  router.put('/api/v1/reading-lists/reorder', requireAuth, async (req, res) => {
    try {
      const { listOrder } = req.body; // Array of listIds in new order

      if (!listOrder || !Array.isArray(listOrder)) {
        return res.status(400).json({ message: 'List order array is required' });
      }

      // Update sort order for each list belonging to the user
      for (let i = 0; i < listOrder.length; i++) {
        await dbRun(
          'UPDATE reading_lists SET sortOrder = ? WHERE id = ? AND userId = ?',
          [i, listOrder[i], req.user.userId]
        );
      }

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to reorder reading lists')
      });
    }
  });

  // Create a new reading list
  router.post('/api/v1/reading-lists', requireAuth, async (req, res) => {
    try {
      const { name, description, comicIds } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'List name is required' });
      }

      const now = Date.now();
      const listId = createId(`${req.user.userId}:${name}:${now}`);

      // Create the list
      await dbRun(
        'INSERT INTO reading_lists (id, userId, name, description, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
        [listId, req.user.userId, name.trim(), description || '', now, now]
      );

      // Add comics to the list if provided
      if (comicIds && Array.isArray(comicIds) && comicIds.length > 0) {
        for (const [index, comicId] of comicIds.entries()) {
          const v = validateComicId(comicId);
          if (!v.valid) return res.status(400).json({ message: `Invalid comic ID at index ${index}: ${v.error}` });
          
          await dbRun(
            'INSERT INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
            [listId, v.sanitized, now, index]
          );
        }
      }

      // If requested or if created by default-user (e.g. MCP / server seed), propagate to all other users
      const canSyncAll = req.user?.role === 'admin' || req.user?.userId === 'default-user';
      if (req.body.syncToAll && !canSyncAll) {
        return res.status(403).json({ message: 'Forbidden: Admin access required to sync reading lists to all users' });
      }

      if (req.body.syncToAll || req.user.userId === 'default-user') {
        const otherUsers = await dbAll('SELECT userId FROM users WHERE userId != ?', [req.user.userId]);
        for (const u of otherUsers) {
          const userListId = createId(`${u.userId}:${name.trim()}:${now}`);
          await dbRun(
            'INSERT OR IGNORE INTO reading_lists (id, userId, name, description, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
            [userListId, u.userId, name.trim(), description || '', now, now]
          );
          if (comicIds && Array.isArray(comicIds) && comicIds.length > 0) {
            for (const [index, comicId] of comicIds.entries()) {
              const v = validateComicId(comicId);
              if (v.valid) {
                await dbRun(
                  'INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
                  [userListId, v.sanitized, now, index]
                );
              }
            }
          }
        }
      }

      res.json({ ok: true, listId });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to create reading list')
      });
    }
  });

  // Bulk create reading lists
  router.post('/api/v1/reading-lists/bulk', requireAuth, async (req, res) => {
    try {
      const { lists, syncToAll } = req.body;
      if (!lists || !Array.isArray(lists) || lists.length === 0) {
        return res.status(400).json({ message: 'lists array is required' });
      }

      const canSyncAll = req.user?.role === 'admin' || req.user?.userId === 'default-user';
      if (syncToAll && !canSyncAll) {
        return res.status(403).json({ message: 'Forbidden: Admin access required to sync reading lists to all users' });
      }

      const now = Date.now();
      const created = [];
      const errors = [];
      const shouldSync = (syncToAll && canSyncAll) || req.user.userId === 'default-user';
      const otherUsers = shouldSync
        ? await dbAll('SELECT userId FROM users WHERE userId != ?', [req.user.userId])
        : [];

      for (const [idx, listData] of lists.entries()) {
        const name = listData.name ? listData.name.trim() : '';
        if (!name) {
          errors.push({ index: idx, message: 'List name is required' });
          continue;
        }

        try {
          const listId = createId(`${req.user.userId}:${name}:${now}:${idx}`);
          await dbRun(
            'INSERT INTO reading_lists (id, userId, name, description, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
            [listId, req.user.userId, name, listData.description || '', now, now]
          );

          let comicsAdded = 0;
          if (listData.comicIds && Array.isArray(listData.comicIds) && listData.comicIds.length > 0) {
            for (const [cIdx, comicId] of listData.comicIds.entries()) {
              const v = validateComicId(comicId);
              if (v.valid) {
                await dbRun(
                  'INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
                  [listId, v.sanitized, now, cIdx]
                );
                comicsAdded++;
              }
            }
          }

          if (shouldSync) {
            for (const u of otherUsers) {
              const userListId = createId(`${u.userId}:${name}:${now}:${idx}`);
              await dbRun(
                'INSERT OR IGNORE INTO reading_lists (id, userId, name, description, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
                [userListId, u.userId, name, listData.description || '', now, now]
              );
              if (listData.comicIds && Array.isArray(listData.comicIds)) {
                for (const [cIdx, comicId] of listData.comicIds.entries()) {
                  const v = validateComicId(comicId);
                  if (v.valid) {
                    await dbRun(
                      'INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
                      [userListId, v.sanitized, now, cIdx]
                    );
                  }
                }
              }
            }
          }

          created.push({ name, listId, comicsAdded });
        } catch (err) {
          errors.push({ index: idx, name, message: err.message });
        }
      }

      res.json({ ok: errors.length === 0, created, errors });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to create reading lists in bulk')
      });
    }
  });

  // Bulk delete reading lists (by list IDs or names; supports optional globally=true for admin)
  router.post('/api/v1/reading-lists/delete-bulk', requireAuth, async (req, res) => {
    try {
      const { listIds, names, globally } = req.body || {};
      const targets = [
        ...(Array.isArray(listIds) ? listIds : []),
        ...(Array.isArray(names) ? names : [])
      ];

      if (targets.length === 0) {
        return res.status(400).json({ message: 'listIds or names array is required' });
      }

      if (globally) {
        if (req.user.role !== 'admin') {
          return res.status(403).json({ message: 'Forbidden: Admin access required for global deletion' });
        }
        const results = [];
        for (const target of targets) {
          const resGlob = await deleteReadingListGlobally(target, { dbRun, dbGet, dbAll, log });
          results.push({ target, ...resGlob });
        }
        return res.json({ ok: true, globally: true, results });
      }

      const deleted = [];
      const notFound = [];
      for (const target of targets) {
        const list = await dbGet(
          'SELECT id FROM reading_lists WHERE (id = ? OR name = ?) AND userId = ?',
          [target, target, req.user.userId]
        );
        if (list) {
          await dbRun('DELETE FROM reading_lists WHERE id = ?', [list.id]);
          deleted.push(list.id);
        } else {
          notFound.push(target);
        }
      }

      res.json({ ok: true, deleted, notFound });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to bulk delete reading lists')
      });
    }
  });

  // Bulk add comics across reading lists
  // Body: { listIds: string[], comicIds: string[] } or { operations: [{ listId, comicIds }] }
  router.post('/api/v1/reading-lists/bulk-add-comics', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      let operations = [];
      if (Array.isArray(body.operations) && body.operations.length > 0) {
        operations = body.operations;
      } else if (Array.isArray(body.listIds) && Array.isArray(body.comicIds)) {
        operations = body.listIds.map(listId => ({ listId, comicIds: body.comicIds }));
      } else {
        return res.status(400).json({ message: 'Either operations array or (listIds + comicIds) is required' });
      }

      const results = [];
      const now = Date.now();

      for (const op of operations) {
        const { listId, comicIds } = op;
        if (!listId || !Array.isArray(comicIds) || comicIds.length === 0) {
          results.push({ listId, ok: false, message: 'Invalid listId or comicIds' });
          continue;
        }

        const list = await dbGet(
          'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
          [listId, req.user.userId]
        );
        if (!list) {
          results.push({ listId, ok: false, message: 'Reading list not found' });
          continue;
        }

        const maxSort = await dbGet(
          'SELECT MAX(sortOrder) as maxOrder FROM reading_list_items WHERE listId = ?',
          [listId]
        );
        let nextOrder = (maxSort?.maxOrder ?? -1) + 1;
        let addedCount = 0;

        for (const comicId of comicIds) {
          const v = validateComicId(comicId);
          if (v.valid) {
            try {
              await dbRun(
                'INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
                [listId, v.sanitized, now, nextOrder]
              );
              nextOrder++;
              addedCount++;
            } catch {}
          }
        }

        await dbRun('UPDATE reading_lists SET updated = ? WHERE id = ?', [now, listId]);
        results.push({ listId, ok: true, addedCount });
      }

      res.json({ ok: true, results });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to add comics in bulk')
      });
    }
  });

  // Bulk remove comics across reading lists
  // Body: { listIds: string[], comicIds: string[] } or { operations: [{ listId, comicIds }] }
  router.post('/api/v1/reading-lists/bulk-remove-comics', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      let operations = [];
      if (Array.isArray(body.operations) && body.operations.length > 0) {
        operations = body.operations;
      } else if (Array.isArray(body.listIds) && Array.isArray(body.comicIds)) {
        operations = body.listIds.map(listId => ({ listId, comicIds: body.comicIds }));
      } else {
        return res.status(400).json({ message: 'Either operations array or (listIds + comicIds) is required' });
      }

      const results = [];
      const now = Date.now();

      for (const op of operations) {
        const { listId, comicIds } = op;
        if (!listId || !Array.isArray(comicIds) || comicIds.length === 0) {
          results.push({ listId, ok: false, message: 'Invalid listId or comicIds' });
          continue;
        }

        const list = await dbGet(
          'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
          [listId, req.user.userId]
        );
        if (!list) {
          results.push({ listId, ok: false, message: 'Reading list not found' });
          continue;
        }

        const cleanIds = [];
        for (const comicId of comicIds) {
          const v = validateComicId(comicId);
          if (v.valid) cleanIds.push(v.sanitized);
        }

        if (cleanIds.length > 0) {
          const placeholders = cleanIds.map(() => '?').join(',');
          await dbRun(
            `DELETE FROM reading_list_items WHERE listId = ? AND comicId IN (${placeholders})`,
            [listId, ...cleanIds]
          );
        }

        await dbRun('UPDATE reading_lists SET updated = ? WHERE id = ?', [now, listId]);
        results.push({ listId, ok: true, removedCount: cleanIds.length });
      }

      res.json({ ok: true, results });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to remove comics in bulk')
      });
    }
  });

  // Bulk mark multiple reading lists as read/unread
  // Body: { listIds: string[], read: boolean }
  router.post('/api/v1/reading-lists/mark-read-bulk', requireAuth, async (req, res) => {
    try {
      const { listIds, read = true } = req.body || {};
      if (!listIds || !Array.isArray(listIds) || listIds.length === 0) {
        return res.status(400).json({ message: 'listIds array is required' });
      }

      const results = [];
      const now = Date.now();

      for (const listId of listIds) {
        const list = await dbGet(
          'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
          [listId, req.user.userId]
        );
        if (!list) {
          results.push({ listId, ok: false, message: 'Reading list not found' });
          continue;
        }

        const items = await dbAll(
          'SELECT comicId FROM reading_list_items WHERE listId = ?',
          [listId]
        );

        for (const item of items) {
          const comic = await dbGet('SELECT totalPages FROM comics WHERE id = ?', [item.comicId]);
          const totalPages = comic?.totalPages || 0;
          const lastReadPage = read ? (totalPages > 0 ? totalPages - 1 : 1) : 0;

          await dbRun(
            `INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages, updatedAt)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(userId, comicId) DO UPDATE SET
               lastReadPage = excluded.lastReadPage,
               totalPages = excluded.totalPages,
               updatedAt = excluded.updatedAt`,
            [req.user.userId, item.comicId, lastReadPage, totalPages, now]
          );
        }

        results.push({ listId, ok: true, comicsUpdated: items.length });
      }

      res.json({ ok: true, results });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to update reading status in bulk')
      });
    }
  });

  // Get reading list details with all comics
  router.get('/api/v1/reading-lists/:id', requireAuth, async (req, res) => {
    try {
      const list = await dbGet(
        'SELECT * FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Get comics in this list with their progress
      const items = await dbAll(
        `SELECT rli.comicId, rli.addedAt, rli.sortOrder,
                ucs.lastReadPage, ucs.totalPages
         FROM reading_list_items rli
         LEFT JOIN user_comic_status ucs ON rli.comicId = ucs.comicId AND ucs.userId = ?
         WHERE rli.listId = ?
         ORDER BY rli.sortOrder ASC`,
        [req.user.userId, req.params.id]
      );

      res.json({ ok: true, list, items });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to load reading list')
      });
    }
  });

  // Update reading list (name, description)
  router.put('/api/v1/reading-lists/:id', requireAuth, async (req, res) => {
    try {
      const { name, description } = req.body;

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'List name is required' });
      }

      await dbRun(
        'UPDATE reading_lists SET name = ?, description = ?, updated = ? WHERE id = ?',
        [name.trim(), description || '', Date.now(), req.params.id]
      );

      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to update reading list')
      });
    }
  });

  // Delete reading list
  router.delete('/api/v1/reading-lists/:id', requireAuth, async (req, res) => {
    try {
      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Foreign key cascade will delete items
      await dbRun('DELETE FROM reading_lists WHERE id = ?', [req.params.id]);

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to delete reading list')
      });
    }
  });

  // Add comics to reading list
  router.post('/api/v1/reading-lists/:id/comics', requireAuth, async (req, res) => {
    try {
      const { comicIds } = req.body;

      if (!comicIds || !Array.isArray(comicIds) || comicIds.length === 0) {
        return res.status(400).json({ message: 'Comic IDs are required' });
      }

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Get current max sort order
      const maxSort = await dbGet(
        'SELECT MAX(sortOrder) as maxOrder FROM reading_list_items WHERE listId = ?',
        [req.params.id]
      );

      let nextOrder = (maxSort?.maxOrder ?? -1) + 1;
      const now = Date.now();

      // Add comics (ignore duplicates)
      for (const [index, comicId] of comicIds.entries()) {
        const v = validateComicId(comicId);
        if (!v.valid) return res.status(400).json({ message: `Invalid comic ID at index ${index}: ${v.error}` });
        const cleanId = v.sanitized;

        try {
          await dbRun(
            'INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
            [req.params.id, cleanId, now, nextOrder]
          );
          nextOrder++;
        } catch (err) {
          // Skip if already exists
        }
      }

      // Update list timestamp
      await dbRun('UPDATE reading_lists SET updated = ? WHERE id = ?', [now, req.params.id]);

      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to add comics to reading list')
      });
    }
  });

  // Remove comics from reading list
  router.delete('/api/v1/reading-lists/:id/comics', requireAuth, async (req, res) => {
    try {
      const { comicIds } = req.body;

      if (!comicIds || !Array.isArray(comicIds) || comicIds.length === 0) {
        return res.status(400).json({ message: 'Comic IDs are required' });
      }

      const cleanIds = [];
      for (const [index, comicId] of comicIds.entries()) {
        const v = validateComicId(comicId);
        if (!v.valid) return res.status(400).json({ message: `Invalid comic ID at index ${index}: ${v.error}` });
        cleanIds.push(v.sanitized);
      }

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      const placeholders = cleanIds.map(() => '?').join(',');
      await dbRun(
        `DELETE FROM reading_list_items WHERE listId = ? AND comicId IN (${placeholders})`,
        [req.params.id, ...cleanIds]
      );

      // Update list timestamp
      await dbRun('UPDATE reading_lists SET updated = ? WHERE id = ?', [Date.now(), req.params.id]);

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to remove comics from reading list')
      });
    }
  });

  // Reorder comics in reading list
  router.put('/api/v1/reading-lists/:id/reorder', requireAuth, async (req, res) => {
    try {
      const { comicOrder } = req.body; // Array of comicIds in new order

      if (!comicOrder || !Array.isArray(comicOrder)) {
        return res.status(400).json({ message: 'Comic order array is required' });
      }

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Update sort order for each comic
      for (const [i, comicId] of comicOrder.entries()) {
        const v = validateComicId(comicId);
        if (!v.valid) return res.status(400).json({ message: `Invalid comic ID at index ${i}: ${v.error}` });
        
        await dbRun(
          'UPDATE reading_list_items SET sortOrder = ? WHERE listId = ? AND comicId = ?',
          [i, req.params.id, v.sanitized]
        );
      }

      // Update list timestamp
      await dbRun('UPDATE reading_lists SET updated = ? WHERE id = ?', [Date.now(), req.params.id]);

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to reorder comics')
      });
    }
  });

  // Mark all comics in reading list as read/unread
  router.post('/api/v1/reading-lists/:id/mark-read', requireAuth, async (req, res) => {
    try {
      const { read } = req.body; // boolean: true = mark read, false = mark unread

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Get all comics in this list
      const items = await dbAll(
        'SELECT comicId FROM reading_list_items WHERE listId = ?',
        [req.params.id]
      );

      const now = Date.now();

      // Update status for each comic
      for (const item of items) {
        const comic = await dbGet('SELECT totalPages FROM comics WHERE id = ?', [item.comicId]);
        const totalPages = comic?.totalPages || 0;
        const lastReadPage = read ? (totalPages > 0 ? totalPages - 1 : 1) : 0;

        await dbRun(
          `INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages, updatedAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(userId, comicId) DO UPDATE SET
             lastReadPage = excluded.lastReadPage,
             totalPages = excluded.totalPages,
             updatedAt = excluded.updatedAt`,
          [req.user.userId, item.comicId, lastReadPage, totalPages, now]
        );
      }

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to update reading status')
      });
    }
  });

  // Export reading lists as JSON
  router.post('/api/v1/reading-lists/export', requireAuth, async (req, res) => {
    try {
      const { listIds } = req.body; // Optional: specific list IDs to export, or all if not provided

      let lists;
      if (listIds && Array.isArray(listIds) && listIds.length > 0) {
        const placeholders = listIds.map(() => '?').join(',');
        lists = await dbAll(
          `SELECT * FROM reading_lists WHERE userId = ? AND id IN (${placeholders})`,
          [req.user.userId, ...listIds]
        );
      } else {
        lists = await dbAll(
          'SELECT * FROM reading_lists WHERE userId = ?',
          [req.user.userId]
        );
      }

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        lists: await Promise.all(lists.map(async (list) => {
          const items = await dbAll(
            'SELECT comicId, sortOrder FROM reading_list_items WHERE listId = ? ORDER BY sortOrder ASC',
            [list.id]
          );

          return {
            name: list.name,
            description: list.description,
            comics: items.map(item => ({
              id: item.comicId,
              sortOrder: item.sortOrder
            }))
          };
        }))
      };

      res.json({ ok: true, ...exportData });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to export reading lists')
      });
    }
  });

  // Import reading lists from JSON
  router.post('/api/v1/reading-lists/import', requireAuth, async (req, res) => {
    try {
      const { lists } = req.body;

      if (!lists || !Array.isArray(lists)) {
        return res.status(400).json({ message: 'Invalid import data format' });
      }

      const now = Date.now();
      const imported = [];
      const skipped = [];

      for (const listData of lists) {
        try {
          const listId = createId(`${req.user.userId}:${listData.name}:${now}:${Math.random()}`);

          // Create list
          await dbRun(
            'INSERT INTO reading_lists (id, userId, name, description, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
            [listId, req.user.userId, listData.name, listData.description || '', now, now]
          );

          // Add comics (skip if comic doesn't exist)
          if (listData.comics && Array.isArray(listData.comics)) {
            for (const comic of listData.comics) {
              const exists = await dbGet('SELECT id FROM comics WHERE id = ?', [comic.id]);
              if (exists) {
                await dbRun(
                  'INSERT INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
                  [listId, comic.id, now, comic.sortOrder || 0]
                );
              }
            }
          }

          imported.push(listData.name);
        } catch (err) {
          log('ERROR', 'API', `Failed to import list ${listData.name}: ${err.message}`);
          skipped.push(listData.name);
        }
      }

      res.json({ ok: true, imported, skipped });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to import reading lists')
      });
    }
  });

  // Sync default reading lists to the current user's account
  router.post('/api/v1/reading-lists/sync-defaults', requireAuth, async (req, res) => {
    try {
      const result = await syncDefaultReadingLists(req.user.userId, { dbRun, dbGet, dbAll, log });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to sync default reading lists')
      });
    }
  });

  // Admin endpoint: Sync default reading lists to ALL registered users (supports overwrite and prune)
  router.post('/api/v1/admin/reading-lists/sync-to-all', requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden: Admin access required' });
      }
      const { overwrite = false, prune = false } = req.body || {};
      const result = await syncDefaultReadingListsToAllUsers({ dbRun, dbGet, dbAll, log }, { overwrite, prune });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to sync default reading lists to all users')
      });
    }
  });

  // Admin endpoint: Delete a reading list globally across ALL users by name or ID
  router.post('/api/v1/admin/reading-lists/delete-globally', requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden: Admin access required' });
      }
      const { name, listId } = req.body || {};
      const identifier = name || listId;
      if (!identifier) {
        return res.status(400).json({ message: 'List name or listId is required' });
      }
      const result = await deleteReadingListGlobally(identifier, { dbRun, dbGet, dbAll, log });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to delete reading list globally')
      });
    }
  });
};
