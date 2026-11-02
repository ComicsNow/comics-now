const { createBatchInserter } = require('./helpers');

module.exports = function attachItemsRoutes(router, deps) {
  const {
    requireAuth,
    dbRun,
    dbGet,
    formatErrorMessage,
    validateComicId
  } = deps;

  const batchInsertReadingListItems = createBatchInserter(dbRun);

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

        const itemsToInsert = [];
        for (const comicId of comicIds) {
          const v = validateComicId(comicId);
          if (v.valid) {
            itemsToInsert.push({ comicId: v.sanitized, addedAt: now, sortOrder: nextOrder });
            nextOrder++;
          }
        }

        if (itemsToInsert.length > 0) {
          addedCount = await batchInsertReadingListItems(listId, itemsToInsert, true);
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

        const readParam = read ? 1 : 0;

        const info = await dbRun(
          `INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages, updatedAt)
           SELECT
             ?,
             rli.comicId,
             CASE WHEN ? = 1 THEN (CASE WHEN c.totalPages > 0 THEN c.totalPages - 1 ELSE 1 END) ELSE 0 END,
             COALESCE(c.totalPages, 0),
             ?
           FROM reading_list_items rli
           LEFT JOIN comics c ON rli.comicId = c.id
           WHERE rli.listId = ?
           ON CONFLICT(userId, comicId) DO UPDATE SET
             lastReadPage = excluded.lastReadPage,
             totalPages = excluded.totalPages,
             updatedAt = excluded.updatedAt`,
          [req.user.userId, readParam, now, listId]
        );

        results.push({ listId, ok: true, comicsUpdated: info.changes });
      }

      res.json({ ok: true, results });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to update reading status in bulk')
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
      const itemsToInsert = [];
      for (const [index, comicId] of comicIds.entries()) {
        const v = validateComicId(comicId);
        if (!v.valid) return res.status(400).json({ message: `Invalid comic ID at index ${index}: ${v.error}` });

        itemsToInsert.push({ comicId: v.sanitized, addedAt: now, sortOrder: nextOrder });
        nextOrder++;
      }

      if (itemsToInsert.length > 0) {
        await batchInsertReadingListItems(req.params.id, itemsToInsert, true);
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

      const now = Date.now();
      const readParam = read ? 1 : 0;

      // Update status for all comics in this list via a single INSERT ... SELECT query
      await dbRun(
        `INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages, updatedAt)
         SELECT
           ?,
           rli.comicId,
           CASE WHEN ? = 1 THEN (CASE WHEN c.totalPages > 0 THEN c.totalPages - 1 ELSE 1 END) ELSE 0 END,
           COALESCE(c.totalPages, 0),
           ?
         FROM reading_list_items rli
         LEFT JOIN comics c ON rli.comicId = c.id
         WHERE rli.listId = ?
         ON CONFLICT(userId, comicId) DO UPDATE SET
           lastReadPage = excluded.lastReadPage,
           totalPages = excluded.totalPages,
           updatedAt = excluded.updatedAt`,
        [req.user.userId, readParam, now, req.params.id]
      );

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to update reading status')
      });
    }
  });
};
