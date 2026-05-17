module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const userSettingsCols = await dbAll('PRAGMA table_info(user_settings)');
    if (!userSettingsCols.some(c => c.name === 'continuousModeDefault')) {
      await dbRun('ALTER TABLE user_settings ADD COLUMN continuousModeDefault INTEGER DEFAULT 0');
    }

    const userComicStatusCols = await dbAll('PRAGMA table_info(user_comic_status)');
    if (!userComicStatusCols.some(c => c.name === 'continuousMode')) {
      await dbRun('ALTER TABLE user_comic_status ADD COLUMN continuousMode INTEGER');
    }
  }
};
