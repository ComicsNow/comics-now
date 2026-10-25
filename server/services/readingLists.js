const { createId } = require('../utils');

/**
 * Sync / clone default reading lists (from 'default-user') to a target user.
 * 
 * @param {string} targetUserId - The user ID to sync lists to
 * @param {Object} deps - Database dependencies { dbRun, dbGet, dbAll, log }
 * @param {Object} [options] - Sync options
 * @param {boolean} [options.overwrite=false] - If true, overwrite existing list items and sortOrder
 * @param {boolean} [options.prune=false] - If true, delete lists in target user that do not exist in default-user
 * @returns {Promise<{ created: number, updated: number, pruned: number, skipped: number, total: number }>}
 */
async function syncDefaultReadingLists(targetUserId, { dbRun, dbGet, dbAll, log }, options = {}) {
  const { overwrite = false, prune = false } = options;
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
    for (const uList of userLists) {
      if (!templateNames.has(uList.name)) {
        await dbRun('DELETE FROM reading_lists WHERE id = ?', [uList.id]);
        prunedCount++;
      }
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

          // Get template items
          const items = await dbAll(
            'SELECT comicId, addedAt, sortOrder FROM reading_list_items WHERE listId = ? ORDER BY sortOrder ASC',
            [list.id]
          );

          // Replace items for this user's list
          await dbRun('DELETE FROM reading_list_items WHERE listId = ?', [existing.id]);
          for (const item of items) {
            await dbRun(
              'INSERT INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
              [existing.id, item.comicId, item.addedAt || now, item.sortOrder || 0]
            );
          }
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

      // Get comics for this list
      const items = await dbAll(
        'SELECT comicId, addedAt, sortOrder FROM reading_list_items WHERE listId = ? ORDER BY sortOrder ASC',
        [list.id]
      );

      for (const item of items) {
        await dbRun(
          'INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
          [newListId, item.comicId, item.addedAt || now, item.sortOrder || 0]
        );
      }

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
 * @param {Object} deps - Database dependencies { dbRun, dbGet, dbAll, log }
 * @param {Object} [options] - Sync options (overwrite, prune)
 * @returns {Promise<{ usersCount: number, totalCreated: number, totalUpdated: number, totalPruned: number }>}
 */
async function syncDefaultReadingListsToAllUsers({ dbRun, dbGet, dbAll, log }, options = {}) {
  const users = await dbAll('SELECT userId, email FROM users WHERE userId != ?', ['default-user']);
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalPruned = 0;

  for (const user of users) {
    const res = await syncDefaultReadingLists(user.userId, { dbRun, dbGet, dbAll, log }, options);
    totalCreated += res.created;
    totalUpdated += (res.updated || 0);
    totalPruned += (res.pruned || 0);
  }

  return { usersCount: users.length, totalCreated, totalUpdated, totalPruned };
}

/**
 * Delete a reading list globally across all users by list name or list ID.
 * 
 * @param {string} identifier - List name or list ID
 * @param {Object} deps - Database dependencies { dbRun, dbGet, dbAll, log }
 * @returns {Promise<{ deletedCount: number, name: string }>}
 */
async function deleteReadingListGlobally(identifier, { dbRun, dbGet, dbAll, log }) {
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
  for (const l of listsToDelete) {
    await dbRun('DELETE FROM reading_lists WHERE id = ?', [l.id]);
  }

  return { deletedCount: listsToDelete.length, name };
}

/**
 * Auto-seed reading lists for a new user if they have zero lists.
 * 
 * @param {string} userId - User ID
 * @param {Object} deps - Database dependencies { dbRun, dbGet, dbAll, log }
 */
async function autoSeedNewUserReadingLists(userId, { dbRun, dbGet, dbAll, log }) {
  if (!userId || userId === 'default-user') return;

  try {
    const row = await dbGet('SELECT COUNT(*) as count FROM reading_lists WHERE userId = ?', [userId]);
    if (!row || row.count === 0) {
      if (log) log('INFO', 'AUTH', `Auto-seeding default reading lists for user: ${userId}`);
      await syncDefaultReadingLists(userId, { dbRun, dbGet, dbAll, log });
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
