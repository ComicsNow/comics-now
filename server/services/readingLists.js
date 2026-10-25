const { createId } = require('../utils');

/**
 * Sync / clone default reading lists (from 'default-user') to a target user.
 * 
 * @param {Object} options - Sync options and dependencies
 * @param {string} options.targetUserId - The user ID to sync lists to
 * @param {Function} options.dbRun - Database run dependency
 * @param {Function} options.dbGet - Database get dependency
 * @param {Function} options.dbAll - Database all dependency
 * @param {Function} options.log - Log function dependency
 * @param {boolean} [options.overwrite=false] - If true, overwrite existing list items and sortOrder
 * @param {boolean} [options.prune=false] - If true, delete lists in target user that do not exist in default-user
 * @returns {Promise<{ created: number, updated: number, pruned: number, skipped: number, total: number }>}
 */
async function syncDefaultReadingLists(options = {}) {
  const { targetUserId, dbRun, dbGet, dbAll, log, overwrite = false, prune = false } = options;
  if (!targetUserId || targetUserId === 'default-user') {
    return { created: 0, updated: 0, pruned: 0, skipped: 0, total: 0 };
  }

  // Get template lists from default-user
  const templateLists = await dbAll(
    'SELECT * FROM reading_lists WHERE userId = ? ORDER BY sortOrder ASC, created ASC',
    ['default-user']
  );

  if (!templateLists || templateLists.length === 0) {
    return { created: 0, updated: 0, pruned: 0, skipped: 0, total: 0 };
  }

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let prunedCount = 0;

  const templateNames = new Set(templateLists.map(l => l.name));

  if (prune) {
    const userLists = await dbAll('SELECT id, name FROM reading_lists WHERE userId = ?', [targetUserId]);
    const idsToDelete = [];

    for (const uList of userLists) {
      if (!templateNames.has(uList.name)) {
        idsToDelete.push(uList.id);
      }
    }

    if (idsToDelete.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < idsToDelete.length; i += chunkSize) {
        const chunk = idsToDelete.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        await dbRun(`DELETE FROM reading_lists WHERE id IN (${placeholders})`, chunk);
      }
      prunedCount += idsToDelete.length;
    }
  }

  for (const list of templateLists) {
    // Check if target user already has a list with the same name
    const existing = await dbGet(
      'SELECT id FROM reading_lists WHERE userId = ? AND name = ?',
      [targetUserId, list.name]
    );

    const now = Date.now();

    if (existing) {
      if (overwrite) {
        try {
          // Update list metadata
          await dbRun(
            'UPDATE reading_lists SET description = ?, sortOrder = ?, updated = ? WHERE id = ?',
            [list.description || '', list.sortOrder || 0, now, existing.id]
          );

          // Replace items for this user's list
          await dbRun('DELETE FROM reading_list_items WHERE listId = ?', [existing.id]);

          await dbRun(`
            INSERT INTO reading_list_items (listId, comicId, addedAt, sortOrder)
            SELECT ?, comicId, COALESCE(addedAt, ?), COALESCE(sortOrder, 0)
            FROM reading_list_items
            WHERE listId = ?
          `, [existing.id, now, list.id]);
          updatedCount++;
        } catch (err) {
          if (log) log('ERROR', 'READING_LISTS', `Failed to update list "${list.name}" for user "${targetUserId}": ${err.message}`);
        }
      } else {
        skippedCount++;
      }
      continue;
    }

    const newListId = createId(`${targetUserId}:${list.name}:${list.created || now}`);

    try {
      await dbRun(
        'INSERT INTO reading_lists (id, userId, name, description, sortOrder, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [newListId, targetUserId, list.name, list.description || '', list.sortOrder || 0, list.created || now, list.updated || now]
      );

      await dbRun(`
        INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder)
        SELECT ?, comicId, COALESCE(addedAt, ?), COALESCE(sortOrder, 0)
        FROM reading_list_items
        WHERE listId = ?
      `, [newListId, now, list.id]);

      createdCount++;
    } catch (err) {
      if (log) log('ERROR', 'READING_LISTS', `Failed to sync list "${list.name}" to user "${targetUserId}": ${err.message}`);
    }
  }

  return { created: createdCount, updated: updatedCount, pruned: prunedCount, skipped: skippedCount, total: templateLists.length };
}

/**
 * Sync default reading lists to ALL non-default users in the database.
 * 
 * @param {Object} options - Sync options and dependencies
 * @param {Function} options.dbRun - Database run dependency
 * @param {Function} options.dbGet - Database get dependency
 * @param {Function} options.dbAll - Database all dependency
 * @param {Function} options.log - Log function dependency
 * @param {boolean} [options.overwrite=false] - If true, overwrite existing list items and sortOrder
 * @param {boolean} [options.prune=false] - If true, delete lists in target user that do not exist in default-user
 * @returns {Promise<{ usersCount: number, totalCreated: number, totalUpdated: number, totalPruned: number }>}
 */
async function syncDefaultReadingListsToAllUsers(options = {}) {
  const { dbRun, dbGet, dbAll, log, overwrite = false, prune = false } = options;
  const users = await dbAll('SELECT userId, email FROM users WHERE userId != ?', ['default-user']);
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalPruned = 0;

  for (const user of users) {
    const res = await syncDefaultReadingLists({ targetUserId: user.userId, dbRun, dbGet, dbAll, log, overwrite, prune });
    totalCreated += res.created;
    totalUpdated += (res.updated || 0);
    totalPruned += (res.pruned || 0);
  }

  return { usersCount: users.length, totalCreated, totalUpdated, totalPruned };
}

/**
 * Delete a reading list globally across all users by list name or list ID.
 * 
 * @param {Object} options - Options and dependencies
 * @param {string} options.identifier - List name or list ID
 * @param {Function} options.dbRun - Database run dependency
 * @param {Function} options.dbGet - Database get dependency
 * @param {Function} options.dbAll - Database all dependency
 * @param {Function} options.log - Log function dependency
 * @returns {Promise<{ deletedCount: number, name: string }>}
 */
async function deleteReadingListGlobally(options = {}) {
  const { identifier, dbRun, dbGet, dbAll, log } = options;
  if (!identifier || !identifier.trim()) {
    return { deletedCount: 0, name: '' };
  }

  const clean = identifier.trim();
  let name = clean;
  const list = await dbGet('SELECT name FROM reading_lists WHERE id = ? LIMIT 1', [clean]);
  if (list && list.name) {
    name = list.name;
  }

  const listsToDelete = await dbAll('SELECT id, userId FROM reading_lists WHERE name = ? OR id = ?', [name, clean]);
  if (listsToDelete.length > 0) {
    await dbRun('DELETE FROM reading_lists WHERE name = ? OR id = ?', [name, clean]);
  }

  return { deletedCount: listsToDelete.length, name };
}

/**
 * Auto-seed reading lists for a new user if they have zero lists.
 * 
 * @param {Object} options - Options and dependencies
 * @param {string} options.userId - User ID
 * @param {Function} options.dbRun - Database run dependency
 * @param {Function} options.dbGet - Database get dependency
 * @param {Function} options.dbAll - Database all dependency
 * @param {Function} options.log - Log function dependency
 */
async function autoSeedNewUserReadingLists(options = {}) {
  const { userId, dbRun, dbGet, dbAll, log } = options;
  if (!userId || userId === 'default-user') return;

  try {
    const row = await dbGet('SELECT COUNT(*) as count FROM reading_lists WHERE userId = ?', [userId]);
    if (!row || row.count === 0) {
      if (log) log('INFO', 'AUTH', `Auto-seeding default reading lists for user: ${userId}`);
      await syncDefaultReadingLists({ targetUserId: userId, dbRun, dbGet, dbAll, log });
    }
  } catch (err) {
    if (log) log('ERROR', 'AUTH', `Failed to auto-seed reading lists for user "${userId}": ${err.message}`);
  }
}

module.exports = {
  syncDefaultReadingLists,
  syncDefaultReadingListsToAllUsers,
  deleteReadingListGlobally,
  autoSeedNewUserReadingLists
};
