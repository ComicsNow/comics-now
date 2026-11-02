const {
  syncDefaultReadingLists,
  syncDefaultReadingListsToAllUsers,
  deleteReadingListGlobally
} = require('../../../services/readingLists');

module.exports = function attachOrderRoutes(router, deps) {
  const {
    requireAuth,
    dbAll,
    dbRun,
    dbGet,
    createId,
    formatErrorMessage,
    validateComicId,
    log,
    checkComicAccess,
    getComicsDirectories
  } = deps;

  // Get reading list DAG graph data (nodes, edges, lanes, reading order)
  router.get('/api/v1/reading-lists/:id/dag', requireAuth, async (req, res) => {
    try {
      const list = await dbGet(
        'SELECT * FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ ok: false, message: 'Reading list not found' });
      }

      // Fetch items joined with comic details and user status
      const items = await dbAll(
        `SELECT rli.comicId, rli.addedAt, rli.sortOrder,
                c.name, c.series, c.publisher, c.path, c.thumbnailPath, c.metadata,
                COALESCE(ucs.totalPages, c.totalPages, 0) as totalPages,
                COALESCE(ucs.lastReadPage, 0) as lastReadPage
         FROM reading_list_items rli
         LEFT JOIN comics c ON rli.comicId = c.id
         LEFT JOIN user_comic_status ucs ON rli.comicId = ucs.comicId AND ucs.userId = ?
         WHERE rli.listId = ?
         ORDER BY rli.sortOrder ASC, rli.addedAt ASC`,
        [req.user.userId, req.params.id]
      );

      // Verify access control for each item
      const userRole = req.user.role || 'user';
      const dirs = typeof getComicsDirectories === 'function' ? getComicsDirectories() : [];

      const accessibleItems = [];
      for (const item of items) {
        if (!item.comicId) continue;
        if (typeof checkComicAccess === 'function' && item.path) {
          const hasAccess = await checkComicAccess({
            userId: req.user.userId,
            userRole: userRole,
            comicPath: item.path,
            publisher: item.publisher,
            series: item.series,
            rootFolders: dirs,
            comicId: item.comicId
          });
          if (!hasAccess) continue;
        }
        accessibleItems.push(item);
      }

      // Build DAG nodes
      const seriesCounts = new Map();
      const nodes = accessibleItems.map((item, index) => {
        let meta = {};
        try { if (item.metadata) meta = JSON.parse(item.metadata); } catch {}

        const total = item.totalPages || 0;
        const last = item.lastReadPage || 0;
        const isComplete = total > 0 && last >= total - 1;
        const isInProgress = last > 0 && !isComplete;
        const readStatus = isComplete ? 'read' : isInProgress ? 'in-progress' : 'unread';
        const progressPercent = total > 0 ? Math.round((last / total) * 100) : (last > 0 ? 50 : 0);

        const seriesName = item.series || meta.Series || 'Single Issue';
        seriesCounts.set(seriesName, (seriesCounts.get(seriesName) || 0) + 1);

        const issueNum = meta.Number || meta.issue_number || '';
        const year = meta.Year ? parseInt(meta.Year, 10) : null;

        return {
          id: item.comicId,
          step: index + 1,
          sortOrder: item.sortOrder ?? index,
          name: item.name || meta.Title || seriesName,
          series: seriesName,
          number: issueNum,
          publisher: item.publisher || meta.Publisher || '',
          thumbnailPath: item.thumbnailPath || '',
          summary: meta.Summary || meta.Description || '',
          year,
          totalPages: total,
          lastReadPage: last,
          readStatus,
          progressPercent
        };
      });

      // Calculate distinct series and assign lanes
      const sortedSeries = Array.from(seriesCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([s]) => s);

      const LANE_COLORS = [
        '#f59e0b', // amber (spine)
        '#3b82f6', // blue
        '#ec4899', // pink
        '#10b981', // emerald
        '#8b5cf6', // purple
        '#06b6d4', // cyan
        '#f97316', // orange
        '#14b8a6'  // teal
      ];

      const seriesLanes = sortedSeries.map((series, idx) => ({
        series,
        lane: idx,
        count: seriesCounts.get(series) || 0,
        color: LANE_COLORS[idx % LANE_COLORS.length]
      }));

      const seriesLaneMap = new Map(seriesLanes.map(l => [l.series, l.lane]));

      nodes.forEach(node => {
        node.lane = seriesLaneMap.get(node.series) ?? 0;
        node.isCore = node.lane === 0;
      });

      // Construct Edges:
      // 1. Reading-order sequence edges: step i -> step i+1
      const edges = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({
          id: `edge-step-${i}`,
          from: nodes[i].id,
          to: nodes[i + 1].id,
          type: 'reading-order'
        });
      }

      // 2. Series continuity edges: link consecutive issues of the SAME series if not already directly adjacent
      const seriesGroups = new Map();
      nodes.forEach(n => {
        if (!seriesGroups.has(n.series)) seriesGroups.set(n.series, []);
        seriesGroups.get(n.series).push(n);
      });

      seriesGroups.forEach((groupNodes, series) => {
        if (groupNodes.length > 1) {
          for (let i = 0; i < groupNodes.length - 1; i++) {
            const curr = groupNodes[i];
            const next = groupNodes[i + 1];
            if (next.step !== curr.step + 1) {
              edges.push({
                id: `edge-series-${curr.id}-${next.id}`,
                from: curr.id,
                to: next.id,
                type: 'series-track',
                series
              });
            }
          }
        }
      });

      res.json({
        ok: true,
        list: {
          id: list.id,
          name: list.name,
          description: list.description,
          created: list.created,
          updated: list.updated
        },
        totalIssues: nodes.length,
        readCount: nodes.filter(n => n.readStatus === 'read').length,
        inProgressCount: nodes.filter(n => n.readStatus === 'in-progress').length,
        nodes,
        edges,
        seriesLanes
      });
    } catch (error) {
      log('ERROR', 'READING_LISTS', `Failed to generate DAG for list ${req.params.id}: ${error.message}`);
      res.status(500).json({
        ok: false,
        message: formatErrorMessage(error, req, 'Failed to generate reading list DAG')
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
              const v = validateComicId(comic?.id);
              if (!v.valid) continue;
              const exists = await dbGet('SELECT id FROM comics WHERE id = ?', [v.sanitized]);
              if (exists) {
                const sortOrder = Math.max(0, parseInt(comic.sortOrder, 10) || 0);
                await dbRun(
                  'INSERT INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
                  [listId, v.sanitized, now, sortOrder]
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
      const result = await syncDefaultReadingLists({ targetUserId: req.user.userId, dbRun, dbGet, dbAll, log });
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
      const result = await syncDefaultReadingListsToAllUsers({ dbRun, dbGet, dbAll, log, overwrite, prune });
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
      const result = await deleteReadingListGlobally({ identifier, dbRun, dbGet, dbAll, log });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to delete reading list globally')
      });
    }
  });
};
