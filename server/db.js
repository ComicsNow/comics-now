const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { DB_FILE } = require('./constants');
const { log } = require('./logger');

const db = new Database(DB_FILE);

// Enable performance pragmas (WAL mode, busy timeout, foreign keys)
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Custom async wrapper for db.get
async function dbGet(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (Array.isArray(params)) {
      return stmt.get(...params);
    }
    return stmt.get(params);
  } catch (err) {
    log('ERROR', 'DB', `dbGet failed: ${err.message} (SQL: ${sql})`);
    throw err;
  }
}

// Custom async wrapper for db.all
async function dbAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (Array.isArray(params)) {
      return stmt.all(...params);
    }
    return stmt.all(params);
  } catch (err) {
    log('ERROR', 'DB', `dbAll failed: ${err.message} (SQL: ${sql})`);
    throw err;
  }
}

// Custom async wrapper for db.run
async function dbRun(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    let info;
    if (Array.isArray(params)) {
      info = stmt.run(...params);
    } else {
      info = stmt.run(params);
    }
    return {
      lastID: info.lastInsertRowid,
      changes: info.changes
    };
  } catch (err) {
    log('ERROR', 'DB', `dbRun failed: ${err.message} (SQL: ${sql})`);
    throw err;
  }
}

async function runMigrations() {
  await dbRun(`CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at INTEGER)`);
  
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js')).sort();
  
  for (const file of files) {
    const migrationName = file;
    const alreadyApplied = await dbGet(`SELECT 1 FROM migrations WHERE name = ?`, [migrationName]);
    
    if (!alreadyApplied) {
      log('INFO', 'DB', `Applying migration: ${migrationName}`);
      const migration = require(path.join(migrationsDir, file));
      await migration.up(dbRun, dbGet, dbAll);
      await dbRun(`INSERT INTO migrations (name, applied_at) VALUES (?, ?)`, [migrationName, Date.now()]);
    }
  }
}

async function initializeDatabase() {
  log('INFO', 'DB', 'Initializing database...');
  try {
    await dbRun('BEGIN TRANSACTION');

    // Core schema
    await dbRun(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

    await dbRun(`CREATE TABLE IF NOT EXISTS comics (
      id TEXT PRIMARY KEY,
      publisher TEXT,
      series TEXT,
      name TEXT,
      path TEXT UNIQUE,
      metadata TEXT,
      lastReadPage INTEGER DEFAULT 0,
      totalPages INTEGER DEFAULT 0,
      updatedAt INTEGER,
      thumbnailPath TEXT,
      convertedAt INTEGER,
      guidedViewStatus TEXT DEFAULT 'pending',
      guidedViewError TEXT,
      guidedViewPath TEXT,
      guidedMode INTEGER DEFAULT 0, 
      bubbleMode INTEGER DEFAULT 0,
      libraryMode TEXT DEFAULT 'metadata',
      tagStatus TEXT DEFAULT 'pending'
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS scan_dirs (
      dir TEXT PRIMARY KEY,
      mtimeMs REAL
    )`);

    // Seed default settings
    await dbRun(`INSERT OR IGNORE INTO settings (key, value) VALUES ('allowed_formats', '"cbz"')`);
    await dbRun(`INSERT OR IGNORE INTO settings (key, value) VALUES ('metadata_storage', '"archive"')`);

    await dbRun(`CREATE TABLE IF NOT EXISTS devices (
      deviceId TEXT PRIMARY KEY,
      deviceName TEXT,
      fingerprint TEXT,
      userId TEXT,
      lastSeen INTEGER,
      userAgent TEXT,
      created INTEGER,
      UNIQUE(userId, fingerprint),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Per-device progress tracking (kept for backward compatibility)
    await dbRun(`CREATE TABLE IF NOT EXISTS device_progress (
      comicId TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      lastReadPage INTEGER DEFAULT 0,
      totalPages INTEGER DEFAULT 0,
      lastSyncTimestamp INTEGER DEFAULT 0,
      PRIMARY KEY (comicId, deviceId),
      FOREIGN KEY (comicId) REFERENCES comics(id) ON DELETE CASCADE,
      FOREIGN KEY (deviceId) REFERENCES devices(deviceId) ON DELETE CASCADE
    )`);

    // New auth tables
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      role TEXT DEFAULT 'user',
      created INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      lastSeen INTEGER
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS progress (
      comicId TEXT NOT NULL,
      userId TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      lastReadPage INTEGER DEFAULT 0,
      totalPages INTEGER DEFAULT 0,
      updatedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY (comicId, userId, deviceId),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE,
      FOREIGN KEY (deviceId) REFERENCES devices(deviceId) ON DELETE CASCADE
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS user_settings (
      userId TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (userId, key),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Per-user comic progress/status (for read/unread badges, independent of device)
    await dbRun(`CREATE TABLE IF NOT EXISTS user_comic_status (
      userId TEXT NOT NULL,
      comicId TEXT NOT NULL,
      lastReadPage INTEGER DEFAULT 0,
      totalPages INTEGER DEFAULT 0,
      updatedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY (userId, comicId),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Per-user reading preferences (manga mode, continuous mode, etc.)
    await dbRun(`CREATE TABLE IF NOT EXISTS user_reading_preferences (
      userId TEXT NOT NULL,
      preferenceType TEXT NOT NULL,
      targetId TEXT NOT NULL,
      mangaMode INTEGER DEFAULT 0,
      continuousMode INTEGER DEFAULT NULL,
      createdAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updatedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY (userId, preferenceType, targetId),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // User library access control
    await dbRun(`CREATE TABLE IF NOT EXISTS user_library_access (
      userId TEXT NOT NULL,
      accessType TEXT NOT NULL,
      accessValue TEXT NOT NULL,
      direct_access INTEGER DEFAULT 0,
      child_access INTEGER DEFAULT 0,
      created INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY (userId, accessType, accessValue),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Reading lists table
    await dbRun(`CREATE TABLE IF NOT EXISTS reading_lists (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sortOrder INTEGER DEFAULT 0,
      created INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Reading list items (comics in lists) with sort order
    await dbRun(`CREATE TABLE IF NOT EXISTS reading_list_items (
      listId TEXT NOT NULL,
      comicId TEXT NOT NULL,
      addedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      sortOrder INTEGER DEFAULT 0,
      PRIMARY KEY (listId, comicId),
      FOREIGN KEY (listId) REFERENCES reading_lists(id) ON DELETE CASCADE
    )`);

    // Run incremental migrations
    await runMigrations();

    // Final step: Create/ensure all indexes exist
    // This is done last to ensure any table reconstructions (migrations) have finished
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_user_library_access_lookup ON user_library_access(userId, accessType)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_publisher ON comics(publisher)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_series ON comics(series)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_updatedAt ON comics(updatedAt)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_reading_list_items_comic ON reading_list_items(comicId)`);

    await dbRun('COMMIT');
    log('INFO', 'DB', 'Database initialization complete');
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    log('ERROR', 'DB', `Database initialization failed: ${err.message}`);
    throw err;
  }
}


// Helper function to check if user has access to a specific comic
// Uses hierarchical access control: root_folder -> publisher -> series
// Series is the lowest level - having series access grants access to all comics in that series
const { checkComicAccess: checkAccessLogic } = require('./access-control');

// Helper function to check if user has access to a specific comic
// Uses hierarchical access control: root_folder -> publisher -> series
async function checkComicAccess(userId, userRole, comicPath, publisher, series, rootFolders, comicId = null, preFetchedAccessList = null) {
  return checkAccessLogic(userId, userRole, comicPath, publisher, series, rootFolders, comicId, preFetchedAccessList, dbAll);
}

// ============================================================================
// PER-USER READING PREFERENCES (HIERARCHICAL)
// ============================================================================

/**
 * Set reading preference (manga mode, continuous mode) for a user at a specific level
 * @param {string} userId - User ID
 * @param {string} preferenceType - 'comic', 'series', 'publisher', or 'library'
 * @param {string} targetId - The ID/name of the target (comic ID, series name, etc.)
 * @param {boolean|null} mangaMode - The manga mode value (optional)
 * @param {boolean|null} continuousMode - The continuous mode value (optional)
 */
async function setReadingPreference(userId, preferenceType, targetId, mangaMode, continuousMode) {
  try {
    const now = Date.now();
    let sets = ['updatedAt = excluded.updatedAt'];
    let params = [userId, preferenceType, targetId, now, now];
    let columns = ['userId', 'preferenceType', 'targetId', 'updatedAt', 'createdAt'];
    let placeholders = ['?', '?', '?', '?', '?'];

    if (mangaMode !== undefined) {
      columns.push('mangaMode');
      placeholders.push('?');
      params.push(mangaMode === null ? null : (mangaMode ? 1 : 0));
      sets.push('mangaMode = excluded.mangaMode');
    }
    if (continuousMode !== undefined) {
      columns.push('continuousMode');
      placeholders.push('?');
      params.push(continuousMode === null ? null : (continuousMode ? 1 : 0));
      sets.push('continuousMode = excluded.continuousMode');
    }

    const sql = `
      INSERT INTO user_reading_preferences (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT(userId, preferenceType, targetId) DO UPDATE SET
        ${sets.join(', ')}
    `;

    await dbRun(sql, params);
    log('INFO', 'READING_PREFS', `Set ${preferenceType} '${targetId}' preferences (manga: ${mangaMode}, continuous: ${continuousMode}) for user ${userId}`);
    return true;
  } catch (error) {
    log('ERROR', 'READING_PREFS', `Failed to set reading preference: ${error.message}`);
    return false;
  }
}

/**
 * Get all reading preferences for a user
 */
async function getAllReadingPreferences(userId) {
  try {
    const prefs = await dbAll(
      `SELECT preferenceType, targetId, mangaMode, continuousMode FROM user_reading_preferences
       WHERE userId = ?`,
      [userId]
    );
    return prefs;
  } catch (error) {
    log('ERROR', 'READING_PREFS', `Failed to get all reading preferences: ${error.message}`);
    return [];
  }
}

/**
 * Get unified reading preference maps
 * @param {number|null} userId - If provided, gets preferences for a specific user.
 */
async function getReadingPrefMaps(userId = null) {
  let query = `SELECT preferenceType, targetId, mangaMode, continuousMode FROM user_reading_preferences`;
  let params = [];
  if (userId) {
    query += ` WHERE userId = ?`;
    params.push(userId);
  } else {
    // If no userId, get all rows where at least one preference is explicitly set
    query += ` WHERE mangaMode IS NOT NULL OR continuousMode IS NOT NULL`;
  }
  
  const rows = await dbAll(query, params);
  
  const prefMaps = {
    comic: new Map(),
    series: new Map(),
    publisher: new Map(),
    library: new Map()
  };

  for (const pref of rows) {
    if (prefMaps[pref.preferenceType]) {
      prefMaps[pref.preferenceType].set(pref.targetId, {
        mangaMode: pref.mangaMode === 1 ? true : (pref.mangaMode === 0 ? false : null),
        continuousMode: pref.continuousMode === 1 ? true : (pref.continuousMode === 0 ? false : null)
      });
    }
  }
  
  return prefMaps;
}

/**
 * Resolve reading modes hierarchically
 */
function resolveReadingModes(comicId, series, publisher, comicPath, prefMaps, comicsRoots) {
  const levels = [];
  if (prefMaps.comic.has(comicId)) levels.push(prefMaps.comic.get(comicId));
  if (series && prefMaps.series.has(series)) levels.push(prefMaps.series.get(series));
  if (publisher && prefMaps.publisher.has(publisher)) levels.push(prefMaps.publisher.get(publisher));
  if (comicPath && comicsRoots) {
    const root = comicsRoots.find(d => comicPath.startsWith(d));
    if (root && prefMaps.library.has(root)) levels.push(prefMaps.library.get(root));
  }

  let mangaMode = false;
  let continuousMode = false;

  // Find first non-null mangaMode
  for (const level of levels) {
    if (level.mangaMode !== null && level.mangaMode !== undefined) {
      mangaMode = level.mangaMode;
      break;
    }
  }

  // Find first non-null continuousMode
  for (const level of levels) {
    if (level.continuousMode !== null && level.continuousMode !== undefined) {
      continuousMode = level.continuousMode;
      break;
    }
  }

  return { mangaMode, continuousMode };
}

async function closeDb() {
  if (db && typeof db.close === 'function') {
    db.close();
  }
}

module.exports = {
  db,
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
  // Aliases for backward compatibility during transition
  setMangaModePreference: setReadingPreference,
  getMangaPrefMaps: getReadingPrefMaps,
  resolveMangaMode: (c, s, p, path, maps, roots) => {
    const res = resolveReadingModes(c, s, p, path, maps, roots);
    return res.mangaMode;
  }
};
