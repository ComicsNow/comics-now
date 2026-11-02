/**
 * Shared database helpers for user reading list routes.
 */

function createBatchInserter(dbRun) {
  return async function batchInsertReadingListItems(listId, items, ignoreDuplicates = true) {
    if (!items || items.length === 0) return 0;

    const chunkSize = 125; // Safe limit for SQLite placeholders
    const insertType = ignoreDuplicates ? 'INSERT OR IGNORE' : 'INSERT';

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
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

    return items.length;
  };
}

module.exports = {
  createBatchInserter
};
