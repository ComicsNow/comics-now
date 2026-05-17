const { getLibraries } = require('../config');

module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    // 1. Add continuousMode column to user_reading_preferences
    const prefsCols = await dbAll('PRAGMA table_info(user_reading_preferences)');
    if (!prefsCols.some(c => c.name === 'continuousMode')) {
      await dbRun('ALTER TABLE user_reading_preferences ADD COLUMN continuousMode INTEGER DEFAULT NULL');
    }

    const now = Date.now();

    // 2. Migrate global continuous mode preferences to library-level
    // For each user who has continuousModeDefault set in user_settings, and for each library root folder
    const userSettings = await dbAll("SELECT userId, continuousModeDefault FROM user_settings WHERE key = 'continuousMode' AND continuousModeDefault IS NOT NULL");
    const libraries = getLibraries();
    
    if (userSettings && userSettings.length > 0 && libraries && libraries.length > 0) {
      for (const setting of userSettings) {
        for (const library of libraries) {
          await dbRun(`
            INSERT INTO user_reading_preferences (userId, preferenceType, targetId, continuousMode, createdAt, updatedAt)
            VALUES (?, 'library', ?, ?, ?, ?)
            ON CONFLICT(userId, preferenceType, targetId) DO UPDATE SET
              continuousMode = excluded.continuousMode,
              updatedAt = excluded.updatedAt
          `, [setting.userId, library.path, setting.continuousModeDefault, now, now]);
        }
      }
    }

    // 3. Migrate per-comic continuous mode preferences
    const comicStatusCols = await dbAll('PRAGMA table_info(user_comic_status)');
    if (comicStatusCols.some(c => c.name === 'continuousMode')) {
      await dbRun(`
        INSERT INTO user_reading_preferences (userId, preferenceType, targetId, continuousMode, createdAt, updatedAt)
        SELECT userId, 'comic', comicId, continuousMode, ?, ?
        FROM user_comic_status
        WHERE continuousMode IS NOT NULL
        ON CONFLICT(userId, preferenceType, targetId) DO UPDATE SET
          continuousMode = excluded.continuousMode,
          updatedAt = excluded.updatedAt
      `, [now, now]);
    }
  }
};
