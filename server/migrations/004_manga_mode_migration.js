module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const cols = await dbAll('PRAGMA table_info(comics)');
    if (cols.some(c => c.name === 'mangaMode')) {
      const migrationCheck = await dbGet(`SELECT value FROM settings WHERE key = 'manga_mode_migration_v1'`);
      if (!migrationCheck) {
        const now = Date.now();
        await dbRun(`
          INSERT INTO user_reading_preferences (userId, preferenceType, targetId, mangaMode, createdAt, updatedAt)
          SELECT u.userId, 'comic', c.id, 1, ?, ?
          FROM users u, comics c
          WHERE c.mangaMode = 1
          ON CONFLICT(userId, preferenceType, targetId) DO UPDATE SET
            mangaMode = 1,
            updatedAt = excluded.updatedAt
        `, [now, now]);

        await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('manga_mode_migration_v1', 'completed')`);
      }
    }
  }
};
