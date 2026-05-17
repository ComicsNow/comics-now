const { getLibraries } = require('../config');

module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const folderMigrationCheck = await dbGet(`SELECT value FROM settings WHERE key = 'folder_mode_migration_v1'`);
    if (!folderMigrationCheck) {
      const libraries = getLibraries();
      const comics = await dbAll(`SELECT id, path FROM comics`);
      if (comics && comics.length > 0) {
        for (const comic of comics) {
          const library = libraries.find(lib => comic.path.startsWith(lib.path));
          const mode = library ? library.hierarchyMode : 'metadata';
          await dbRun(`UPDATE comics SET libraryMode = ? WHERE id = ?`, [mode, comic.id]);
        }
      }
      await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('folder_mode_migration_v1', 'completed')`);
    }
  }
};
