module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const cols = await dbAll('PRAGMA table_info(comics)');
    if (!cols.some(c => c.name === 'tagStatus')) {
      await dbRun("ALTER TABLE comics ADD COLUMN tagStatus TEXT DEFAULT 'pending'");
    }
  }
};
