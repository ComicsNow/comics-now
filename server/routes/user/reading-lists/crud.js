const { deleteReadingListGlobally } = require('../../../services/readingLists');
const { createBatchInserter } = require('./helpers');

module.exports = function attachCrudRoutes(router, deps) {
  const {
    requireAuth,
    dbAll,
    dbRun,
    dbGet,
    createId,
    formatErrorMessage,
    validateComicId,
    log
  } = deps;

  const batchInsertReadingListItems = createBatchInserter(dbRun);

  // Get all reading lists for current user with progress stats
  router.get('/api/v1/reading-lists', requireAuth, async (req, res) => {
    try {
      const listsWithStats = await dbAll(
        `SELECT 
            rl.*,
            (SELECT c2.thumbnailPath 
             FROM reading_list_items rli2 
             JOIN comics c2 ON rli2.comicId = c2.id 
             WHERE rli2.listId = rl.id AND c2.thumbnailPath IS NOT NULL AND c2.thumbnailPath != '' 
             ORDER BY rli2.sortOrder ASC LIMIT 1) AS thumbnailPath,
            COUNT(DISTINCT c.series) as seriesCount,
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
        progressPercent: list.totalComics > 0 ? Math.round((list.readComics / list.totalComics) * 100) : 0,
        seriesCount: list.seriesCount || 0,
        thumbnailPath: list.thumbnailPath || null
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
      const itemsToInsert = [];
      if (comicIds && Array.isArray(comicIds) && comicIds.length > 0) {
        for (const [index, comicId] of comicIds.entries()) {
          const v = validateComicId(comicId);
          if (!v.valid) return res.status(400).json({ message: `Invalid comic ID at index ${index}: ${v.error}` });
          itemsToInsert.push({ comicId: v.sanitized, addedAt: now, sortOrder: index });
        }
        await batchInsertReadingListItems(listId, itemsToInsert, false);
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
          if (itemsToInsert.length > 0) {
            await batchInsertReadingListItems(userListId, itemsToInsert, true);
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
          const itemsToInsert = [];
          if (listData.comicIds && Array.isArray(listData.comicIds) && listData.comicIds.length > 0) {
            for (const [cIdx, comicId] of listData.comicIds.entries()) {
              const v = validateComicId(comicId);
              if (v.valid) {
                itemsToInsert.push({ comicId: v.sanitized, addedAt: now, sortOrder: cIdx });
              }
            }
            if (itemsToInsert.length > 0) {
              comicsAdded = await batchInsertReadingListItems(listId, itemsToInsert, true);
            }
          }

          if (shouldSync) {
            for (const u of otherUsers) {
              const userListId = createId(`${u.userId}:${name}:${now}:${idx}`);
              await dbRun(
                'INSERT OR IGNORE INTO reading_lists (id, userId, name, description, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
                [userListId, u.userId, name, listData.description || '', now, now]
              );
              if (itemsToInsert.length > 0) {
                await batchInsertReadingListItems(userListId, itemsToInsert, true);
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
          const resGlob = await deleteReadingListGlobally({ identifier: target, dbRun, dbGet, dbAll, log });
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
};
