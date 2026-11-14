/**
 * Shared database helpers for user reading list routes.
 */

function createBatchInserter(dbRun, deps = {}) {
  const { dbGet, checkComicAccess, getComicsDirectories, isAuthEnabled } = deps || {};

  async function filterAccessibleItems(items, reqUser) {
    if (!items || items.length === 0) return [];
    const authOn = typeof isAuthEnabled === 'function' ? isAuthEnabled() : false;
    if (!authOn || !reqUser || reqUser.role === 'admin') return items;
    if (typeof dbGet !== 'function' || typeof checkComicAccess !== 'function') return items;

    const rootFolders = typeof getComicsDirectories === 'function' ? getComicsDirectories() : [];
    const accessible = [];
    for (const item of items) {
      const comic = await dbGet('SELECT id, path, publisher, series FROM comics WHERE id = ?', [item.comicId]);
      if (!comic) continue;
      const allowed = await checkComicAccess({
        userId: reqUser.userId,
        userRole: reqUser.role,
        comicPath: comic.path,
        publisher: comic.publisher,
        series: comic.series,
        rootFolders,
        comicId: comic.id
      });
      if (allowed) accessible.push(item);
    }
    return accessible;
  }

  return async function batchInsertReadingListItems(listId, items, ignoreDuplicates = true, reqUser = null) {
    const filteredItems = await filterAccessibleItems(items, reqUser);
    if (filteredItems.length === 0) return 0;

    const chunkSize = 125; // Safe limit for SQLite placeholders
    const insertType = ignoreDuplicates ? 'INSERT OR IGNORE' : 'INSERT';

    for (let i = 0; i < filteredItems.length; i += chunkSize) {
      const chunk = filteredItems.slice(i, i + chunkSize);
      const placeholders = [];
      const values = [];

      for (const item of chunk) {
        placeholders.push('(?, ?, ?, ?)');
        values.push(listId, item.comicId, item.addedAt, item.sortOrder);
      }

      if (placeholders.length > 0) {
        await dbRun(
          `${insertType} INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES ${placeholders.join(', ')}`,
          values
        );
      }
    }

    return filteredItems.length;
  };
}

module.exports = {
  createBatchInserter
};
