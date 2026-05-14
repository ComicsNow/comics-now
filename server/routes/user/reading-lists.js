
module.exports = function attach(router, deps) {
  const {
    requireAuth,
    dbAll,
    dbRun,
    dbGet,
    createId,
    formatErrorMessage,
    log
  } = deps;

  // ============================================================================
  // READING LISTS API
  // ============================================================================

  // Get all reading lists for current user with progress stats
  router.get('/api/v1/reading-lists', requireAuth, async (req, res) => {
    try {
      const lists = await dbAll(
        'SELECT * FROM reading_lists WHERE userId = ? ORDER BY sortOrder ASC, created DESC',
        [req.user.userId]
      );

      // Get stats for each list
      const listsWithStats = await Promise.all(lists.map(async (list) => {
        // Get all comic IDs in this list
        const items = await dbAll(
          'SELECT comicId FROM reading_list_items WHERE listId = ? ORDER BY sortOrder ASC',
          [list.id]
        );

        const comicIds = items.map(item => item.comicId);
        const totalComics = comicIds.length;

        if (totalComics === 0) {
          return {
            ...list,
            totalComics: 0,
            readComics: 0,
            inProgressComics: 0,
            unreadComics: 0,
            progressPercent: 0
          };
        }

        // Get progress for these comics
        const placeholders = comicIds.map(() => '?').join(',');
        const progressRows = await dbAll(
          `SELECT comicId, lastReadPage, totalPages FROM user_comic_status
           WHERE userId = ? AND comicId IN (${placeholders})`,
          [req.user.userId, ...comicIds]
        );

        // Calculate status for each comic
        let readComics = 0;
        let inProgressComics = 0;
        let unreadComics = 0;

        comicIds.forEach(comicId => {
          const progress = progressRows.find(p => p.comicId === comicId);
          if (!progress || !progress.totalPages || progress.lastReadPage === 0) {
            unreadComics++;
          } else if (progress.lastReadPage >= progress.totalPages - 1) {
            readComics++;
          } else {
            inProgressComics++;
          }
        });

        const progressPercent = Math.round((readComics / totalComics) * 100);

        return {
          ...list,
          totalComics,
          readComics,
          inProgressComics,
          unreadComics,
          progressPercent
        };
      }));

      res.json({ ok: true, lists: listsWithStats });
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
        const stmt = await Promise.all(comicIds.map((comicId, index) =>
          dbRun(
            'INSERT INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
            [listId, comicId, now, index]
          )
        ));
      }

      res.json({ ok: true, listId });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to create reading list')
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
      for (const comicId of comicIds) {
        try {
          await dbRun(
            'INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
            [req.params.id, comicId, now, nextOrder]
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

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      const placeholders = comicIds.map(() => '?').join(',');
      await dbRun(
        `DELETE FROM reading_list_items WHERE listId = ? AND comicId IN (${placeholders})`,
        [req.params.id, ...comicIds]
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
      for (let i = 0; i < comicOrder.length; i++) {
        await dbRun(
          'UPDATE reading_list_items SET sortOrder = ? WHERE listId = ? AND comicId = ?',
          [i, req.params.id, comicOrder[i]]
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
};
