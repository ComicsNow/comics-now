module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const readingListCols = await dbAll('PRAGMA table_info(reading_lists)');
    if (!readingListCols.some(c => c.name === 'sortOrder')) {
      await dbRun('ALTER TABLE reading_lists ADD COLUMN sortOrder INTEGER DEFAULT 0');
    }
  }
};
