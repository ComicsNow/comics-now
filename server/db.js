const {
  db,
  getDb,
  dbGet,
  dbAll,
  dbRun,
  closeDb,
  getPreparedStatement,
  statementCache
} = require('./db/connection');

const { initializeDatabase } = require('./db/schema');

const {
  setReadingPreference,
  getAllReadingPreferences,
  getReadingPrefMaps,
  resolveReadingModes
} = require('./db/preferences');

const { checkComicAccess } = require('./db/access');

module.exports = {
  db,
  getDb,
  dbGet,
  dbRun,
  dbAll,
  initializeDatabase,
  closeDb,
  checkComicAccess,
  setReadingPreference,
  getAllReadingPreferences,
  getReadingPrefMaps,
  resolveReadingModes,
  getPreparedStatement,
  statementCache
};
