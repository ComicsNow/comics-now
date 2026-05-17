module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const accessCols = await dbAll('PRAGMA table_info(user_library_access)');
    if (accessCols && accessCols.length > 0) {
      const hasGranted = accessCols.some(c => c.name === 'granted');
      const hasDirectAccess = accessCols.some(c => c.name === 'direct_access');
      const hasRecursiveAccess = accessCols.some(c => c.name === 'recursive_access');
      const hasChildAccess = accessCols.some(c => c.name === 'child_access');

      if (hasGranted && !hasDirectAccess && !hasRecursiveAccess) {
        await dbRun(`ALTER TABLE user_library_access ADD COLUMN direct_access INTEGER DEFAULT 0`);
        await dbRun(`ALTER TABLE user_library_access ADD COLUMN recursive_access INTEGER DEFAULT 0`);
        await dbRun(`UPDATE user_library_access SET recursive_access = granted, direct_access = granted WHERE granted = 1`);
      }

      if (hasRecursiveAccess && !hasChildAccess) {
        await dbRun(`ALTER TABLE user_library_access ADD COLUMN child_access INTEGER DEFAULT 0`);
        await dbRun(`UPDATE user_library_access SET child_access = recursive_access`);
      }
    }
  }
};
