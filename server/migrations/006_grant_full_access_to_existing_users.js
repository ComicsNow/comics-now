const { getComicsDirectories } = require('../config');

module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const accessMigrationCheck = await dbGet(`SELECT value FROM settings WHERE key = 'access_migration_v2'`);
    if (!accessMigrationCheck) {
      const users = await dbAll(`SELECT userId, role FROM users`);
      if (users && users.length > 0) {
        const rootFolders = getComicsDirectories();
        if (rootFolders.length > 0) {
          for (const user of users) {
            if (user.role === 'admin') continue;
            for (const folder of rootFolders) {
              await dbRun(`INSERT OR IGNORE INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, 1, 1)`, [user.userId, 'root_folder', folder]);
            }
          }
          await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('access_migration_v2', 'completed')`);
        }
      }
    }
  }
};
