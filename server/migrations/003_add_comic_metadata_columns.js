module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const cols = await dbAll('PRAGMA table_info(comics)');
    if (!cols.some(c => c.name === 'thumbnailPath')) await dbRun('ALTER TABLE comics ADD COLUMN thumbnailPath TEXT');
    if (!cols.some(c => c.name === 'convertedAt')) await dbRun('ALTER TABLE comics ADD COLUMN convertedAt INTEGER');
    if (!cols.some(c => c.name === 'guidedViewStatus')) await dbRun("ALTER TABLE comics ADD COLUMN guidedViewStatus TEXT DEFAULT 'pending'");
    if (!cols.some(c => c.name === 'guidedViewError')) await dbRun('ALTER TABLE comics ADD COLUMN guidedViewError TEXT');
    if (!cols.some(c => c.name === 'guidedViewPath')) await dbRun('ALTER TABLE comics ADD COLUMN guidedViewPath TEXT');
    if (!cols.some(c => c.name === 'libraryMode')) await dbRun("ALTER TABLE comics ADD COLUMN libraryMode TEXT DEFAULT 'metadata'");
  }
};
