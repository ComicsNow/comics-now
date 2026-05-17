module.exports = {
  up: async (dbRun, dbGet, dbAll) => {
    const deviceCols = await dbAll('PRAGMA table_info(devices)');
    if (!deviceCols.some(c => c.name === 'userId')) {
      await dbRun('ALTER TABLE devices ADD COLUMN userId TEXT');
    }
  }
};
