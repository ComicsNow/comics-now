const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { DB_FILE } = require('./constants');
const { log } = require('./logger');

const db = new sqlite3.Database(DB_FILE);
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));

// Custom wrapper for db.run that returns the execution context with changes property
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        // 'this' contains lastID, changes, etc.
        resolve({
          lastID: this.lastID,
          changes: this.changes
        });
      }
    });
  });
}

// Helper function to drop mangaMode column from comics table
async function dropMangaModeColumn() {
  log('INFO', 'DB', 'Dropping mangaMode column from comics table...');

  try {
    // Get all current columns
    const cols = await dbAll('PRAGMA table_info(comics)');
    const colNames = cols
      .map(c => c.name)
      .filter(name => name !== 'mangaMode');
    
    // Build column definitions for CREATE TABLE
    const colDefs = cols
      .filter(c => c.name !== 'mangaMode')
      .map(c => {
        let def = `${c.name} ${c.type}`;
        if (c.pk) def += ' PRIMARY KEY';
        if (c.notnull) def += ' NOT NULL';
        if (c.dflt_value !== null) def += ` DEFAULT ${c.dflt_value}`;
        // Explicitly handle UNIQUE constraint for path column
        if (c.name === 'path') def += ' UNIQUE';
        return def;
      })
      .join(', ');

    const colList = colNames.join(', ');

    await dbRun('BEGIN TRANSACTION');
    
    // Step 1: Create new table without mangaMode column
    await dbRun(`CREATE TABLE comics_new (${colDefs})`);

    // Step 2: Copy data from old table to new table (excluding mangaMode)
    await dbRun(`INSERT INTO comics_new (${colList}) SELECT ${colList} FROM comics`);

    // Step 3: Drop old table
    await dbRun(`DROP TABLE comics`);

    // Step 4: Rename new table to original name
    await dbRun(`ALTER TABLE comics_new RENAME TO comics`);

    await dbRun('COMMIT');
    log('INFO', 'DB', 'Successfully dropped mangaMode column from comics table');
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    log('ERROR', 'DB', `Failed to drop mangaMode column: ${err.message}`);
    throw err;
  }
}

async function initializeDatabase() {
  log('INFO', 'DB', 'Initializing database...');
  try {
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
      libraryMode TEXT DEFAULT 'metadata'
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

    // Migration: Add sortOrder column to reading_lists table
    const readingListCols = await dbAll('PRAGMA table_info(reading_lists)');
    if (!readingListCols.some(c => c.name === 'sortOrder')) {
      await dbRun('ALTER TABLE reading_lists ADD COLUMN sortOrder INTEGER DEFAULT 0');
      log('INFO', 'DB', 'Added sortOrder column to reading_lists table');
    }

    // Add userId column to devices table (nullable for backward compatibility)
    const deviceCols = await dbAll('PRAGMA table_info(devices)');
    if (!deviceCols.some(c => c.name === 'userId')) {
      await dbRun('ALTER TABLE devices ADD COLUMN userId TEXT');
      log('INFO', 'DB', 'Added userId column to devices table');
    }

    // Check for missing columns in comics table
    const cols = await dbAll('PRAGMA table_info(comics)');
    if (!cols.some(c => c.name === 'thumbnailPath')) await dbRun('ALTER TABLE comics ADD COLUMN thumbnailPath TEXT');
    if (!cols.some(c => c.name === 'convertedAt')) await dbRun('ALTER TABLE comics ADD COLUMN convertedAt INTEGER');
    if (!cols.some(c => c.name === 'guidedViewStatus')) await dbRun("ALTER TABLE comics ADD COLUMN guidedViewStatus TEXT DEFAULT 'pending'");
    if (!cols.some(c => c.name === 'guidedViewError')) await dbRun('ALTER TABLE comics ADD COLUMN guidedViewError TEXT');
    if (!cols.some(c => c.name === 'guidedViewPath')) await dbRun('ALTER TABLE comics ADD COLUMN guidedViewPath TEXT');
    if (!cols.some(c => c.name === 'guidedMode')) await dbRun('ALTER TABLE comics ADD COLUMN guidedMode INTEGER DEFAULT 0');
    if (!cols.some(c => c.name === 'bubbleMode')) await dbRun('ALTER TABLE comics ADD COLUMN bubbleMode INTEGER DEFAULT 0');
    if (!cols.some(c => c.name === 'hotZoomMode')) await dbRun('ALTER TABLE comics ADD COLUMN hotZoomMode INTEGER DEFAULT 0');
    if (!cols.some(c => c.name === 'mangaBubbleHotMode')) await dbRun('ALTER TABLE comics ADD COLUMN mangaBubbleHotMode INTEGER DEFAULT 0');
    if (!cols.some(c => c.name === 'landscapeMode')) await dbRun('ALTER TABLE comics ADD COLUMN landscapeMode INTEGER DEFAULT 0');
    if (!cols.some(c => c.name === 'fullImageMode')) await dbRun('ALTER TABLE comics ADD COLUMN fullImageMode INTEGER DEFAULT 0');
    if (!cols.some(c => c.name === 'libraryMode')) await dbRun("ALTER TABLE comics ADD COLUMN libraryMode TEXT DEFAULT 'metadata'");

    // Migration: Move mangaMode from comics table to user_reading_preferences
    if (cols.some(c => c.name === 'mangaMode')) {
      const migrationCheck = await dbGet(`SELECT value FROM settings WHERE key = 'manga_mode_migration_v1'`);
      if (!migrationCheck) {
        log('INFO', 'DB', 'Detected mangaMode column in comics table - starting migration...');
        
        const now = Date.now();
        // Optimized migration: single SQL statement to cross-join users and comics with mangaMode=1
        await dbRun(`
          INSERT INTO user_reading_preferences (userId, preferenceType, targetId, mangaMode, createdAt, updatedAt)
          SELECT u.userId, 'comic', c.id, 1, ?, ?
          FROM users u, comics c
          WHERE c.mangaMode = 1
          ON CONFLICT(userId, preferenceType, targetId) DO UPDATE SET
            mangaMode = 1,
            updatedAt = excluded.updatedAt
        `, [now, now]);

        await dropMangaModeColumn();
        await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('manga_mode_migration_v1', 'completed')`);
      }
    }

    // Migration: Add new access columns to existing table
    const accessCols = await dbAll('PRAGMA table_info(user_library_access)');
    if (accessCols && accessCols.length > 0) {
      const hasGranted = accessCols.some(c => c.name === 'granted');
      const hasDirectAccess = accessCols.some(c => c.name === 'direct_access');
      const hasRecursiveAccess = accessCols.some(c => c.name === 'recursive_access');
      const hasChildAccess = accessCols.some(c => c.name === 'child_access');

      if (hasGranted && !hasDirectAccess && !hasRecursiveAccess) {
        log('INFO', 'DB', 'Migrating user_library_access from granted to direct_access/recursive_access...');
        await dbRun(`ALTER TABLE user_library_access ADD COLUMN direct_access INTEGER DEFAULT 0`);
        await dbRun(`ALTER TABLE user_library_access ADD COLUMN recursive_access INTEGER DEFAULT 0`);
        await dbRun(`UPDATE user_library_access SET recursive_access = granted, direct_access = granted WHERE granted = 1`);
      }

      if (hasRecursiveAccess && !hasChildAccess) {
        log('INFO', 'DB', 'Migrating user_library_access from recursive_access to child_access...');
        await dbRun(`ALTER TABLE user_library_access ADD COLUMN child_access INTEGER DEFAULT 0`);
        await dbRun(`UPDATE user_library_access SET child_access = recursive_access`);
      }
    }

    // Migration: Grant full access to existing users (one-time)
    const accessMigrationCheck = await dbGet(`SELECT value FROM settings WHERE key = 'access_migration_v2'`);
    if (!accessMigrationCheck) {
      const users = await dbAll(`SELECT userId, role FROM users`);
      if (users && users.length > 0) {
        const { getComicsDirectories } = require('./config');
        const rootFolders = getComicsDirectories();
        if (rootFolders.length > 0) {
          const stmt = db.prepare(`INSERT OR IGNORE INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, 1, 1)`);
          for (const user of users) {
            if (user.role === 'admin') continue;
            for (const folder of rootFolders) {
              await new Promise((resolve, reject) => {
                stmt.run(user.userId, 'root_folder', folder, (err) => err ? reject(err) : resolve());
              });
            }
          }
          await new Promise((resolve) => stmt.finalize(resolve));
          await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('access_migration_v2', 'completed')`);
          log('INFO', 'DB', 'Completed user access migration v2 for existing users');
        }
      }
    }

    // Migration: Add continuous mode columns
    const userSettingsCols = await dbAll('PRAGMA table_info(user_settings)');
    if (!userSettingsCols.some(c => c.name === 'continuousModeDefault')) {
      await dbRun('ALTER TABLE user_settings ADD COLUMN continuousModeDefault INTEGER DEFAULT 0');
      log('INFO', 'DB', 'Added continuousModeDefault column to user_settings table');
    }

    const userComicStatusCols = await dbAll('PRAGMA table_info(user_comic_status)');
    if (!userComicStatusCols.some(c => c.name === 'continuousMode')) {
      await dbRun('ALTER TABLE user_comic_status ADD COLUMN continuousMode INTEGER');
      log('INFO', 'DB', 'Added continuousMode column to user_comic_status table');
    }

    // Migration: Populate libraryMode for existing comics based on folder structure
    const folderMigrationCheck = await dbGet(`SELECT value FROM settings WHERE key = 'folder_mode_migration_v1'`);
    if (!folderMigrationCheck) {
      log('INFO', 'DB', 'Starting folder mode migration (populating libraryMode)...');
      const { getLibraries } = require('./config');
      const libraries = getLibraries();
      const comics = await dbAll(`SELECT id, path FROM comics`);
      if (comics && comics.length > 0) {
        log('INFO', 'DB', `Migrating libraryMode for ${comics.length} comics...`);
        const stmt = db.prepare(`UPDATE comics SET libraryMode = ? WHERE id = ?`);
        for (const comic of comics) {
          const library = libraries.find(lib => comic.path.startsWith(lib.path));
          const mode = library ? library.hierarchyMode : 'metadata';
          await new Promise((resolve, reject) => {
            stmt.run(mode, comic.id, (err) => err ? reject(err) : resolve());
          });
        }
        await new Promise((resolve) => stmt.finalize(resolve));
      }
      await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('folder_mode_migration_v1', 'completed')`);
      log('INFO', 'DB', 'Completed folder mode migration');
    }

    // Final step: Create/ensure all indexes exist
    // This is done last to ensure any table reconstructions (migrations) have finished
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_user_library_access_lookup ON user_library_access(userId, accessType)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_publisher ON comics(publisher)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_series ON comics(series)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_updatedAt ON comics(updatedAt)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_reading_list_items_comic ON reading_list_items(comicId)`);

    log('INFO', 'DB', 'Database initialization complete');
  } catch (err) {
    log('ERROR', 'DB', `Database initialization failed: ${err.message}`);
    throw err;
  }
}


// Helper function to check if user has access to a specific comic
// Uses hierarchical access control: root_folder -> publisher -> series
// Series is the lowest level - having series access grants access to all comics in that series
async function checkComicAccess(userId, userRole, comicPath, publisher, series, rootFolders, comicId = null, preFetchedAccessList = null) {
  // Admins have access to everything
  if (userRole === 'admin') {
    return true;
  }

  // Determine which root folder this comic belongs to
  let rootFolder = 'Unknown';
  for (const folder of rootFolders) {
    if (comicPath.startsWith(folder)) {
      rootFolder = folder;
      break;
    }
  }

  // Get user's access permissions (all at once for efficiency)
  const accessList = preFetchedAccessList || await dbAll(
    `SELECT accessType, accessValue, direct_access, child_access
     FROM user_library_access
     WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
    [userId]
  );

  // Hierarchical access control: Check from top to bottom
  // User MUST have access at root folder level first, then publisher, then series
  // Child access at any parent level grants access to all descendants

  // Check if any parent has child_access that would grant access to this comic
  // Check root folder child_access
  const rootChildAccess = accessList.find(a =>
    a.accessType === 'root_folder' &&
    a.accessValue === rootFolder &&
    a.child_access === 1
  );

  if (rootChildAccess) {
    return true; // Root folder child_access grants access to everything under it
  }

  // Check publisher child_access
  const publisherChildAccess = accessList.find(a =>
    a.accessType === 'publisher' &&
    a.accessValue === publisher &&
    a.child_access === 1
  );
  if (publisherChildAccess) {
    // Publisher has child_access, but we still need root folder access
    const rootAccess = accessList.find(a =>
      a.accessType === 'root_folder' &&
      a.accessValue === rootFolder &&
      (a.direct_access === 1 || a.child_access === 1)
    );
    if (rootAccess) {
      return true; // Publisher child_access + root access grants access to all series/comics
    }
  }

  // Check series child_access
  const seriesChildAccess = accessList.find(a =>
    a.accessType === 'series' &&
    a.accessValue === series &&
    a.child_access === 1
  );
  if (seriesChildAccess) {
    // Series has child_access, check if we have publisher and root access
    const rootAccess = accessList.find(a =>
      a.accessType === 'root_folder' &&
      a.accessValue === rootFolder &&
      (a.direct_access === 1 || a.child_access === 1)
    );
    const publisherAccess = accessList.find(a =>
      a.accessType === 'publisher' &&
      a.accessValue === publisher &&
      (a.direct_access === 1 || a.child_access === 1)
    );
    if (rootAccess && publisherAccess) {
      return true; // Series child_access + publisher + root access grants access to all comics
    }
  }

  // No child_access found, check for direct_access at each level
  // Step 1: Check ROOT FOLDER direct access (mandatory)
  const rootDirectAccess = accessList.find(a =>
    a.accessType === 'root_folder' &&
    a.accessValue === rootFolder &&
    a.direct_access === 1
  );
  if (!rootDirectAccess) {
    return false; // No root folder access at all
  }

  // Step 2: Check PUBLISHER direct access
  const publisherDirectAccess = accessList.find(a =>
    a.accessType === 'publisher' &&
    a.accessValue === publisher &&
    a.direct_access === 1
  );
  if (!publisherDirectAccess) {
    return false; // No publisher access
  }

  // Step 3: Check SERIES access
  // Series is the lowest level - having series access grants access to all comics in that series
  const seriesDirectAccess = accessList.find(a =>
    a.accessType === 'series' &&
    a.accessValue === series &&
    a.direct_access === 1
  );
  if (!seriesDirectAccess) {
    return false; // No series access
  }

  // Series access granted - user has access to all comics in this series
  return true;
}

// ============================================================================
// PER-USER MANGA MODE PREFERENCES (HIERARCHICAL)
// ============================================================================

/**
 * Set manga mode preference for a user at a specific level
 * @param {string} userId - User ID
 * @param {string} preferenceType - 'comic', 'series', 'publisher', or 'library'
 * @param {string} targetId - The ID/name of the target (comic ID, series name, etc.)
 * @param {boolean} mangaMode - The manga mode value
 */
async function setMangaModePreference(userId, preferenceType, targetId, mangaMode) {
  try {
    const now = Date.now();
    await dbRun(
      `INSERT INTO user_reading_preferences (userId, preferenceType, targetId, mangaMode, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, preferenceType, targetId) DO UPDATE SET
         mangaMode = excluded.mangaMode,
         updatedAt = excluded.updatedAt`,
      [userId, preferenceType, targetId, mangaMode ? 1 : 0, now, now]
    );
    log('INFO', 'MANGA_PREFS', `Set ${preferenceType} '${targetId}' manga mode to ${mangaMode} for user ${userId}`);
    return true;
  } catch (error) {
    log('ERROR', 'MANGA_PREFS', `Failed to set manga mode preference: ${error.message}`);
    return false;
  }
}

/**
 * Get all manga mode preferences for a user (bulk query for efficiency)
 */
async function getAllMangaModePreferences(userId) {
  try {
    const prefs = await dbAll(
      `SELECT preferenceType, targetId, mangaMode FROM user_reading_preferences
       WHERE userId = ?`,
      [userId]
    );
    return prefs;
  } catch (error) {
    log('ERROR', 'MANGA_PREFS', `Failed to get all manga mode preferences: ${error.message}`);
    return [];
  }
}

/**
 * Get unified manga preference maps
 * @param {number|null} userId - If provided, gets preferences for a specific user. If null, gets global positive preferences.
 */
async function getMangaPrefMaps(userId = null) {
  let query = `SELECT preferenceType, targetId, mangaMode FROM user_reading_preferences`;
  let params = [];
  if (userId) {
    query += ` WHERE userId = ?`;
    params.push(userId);
  } else {
    query += ` WHERE mangaMode = 1`;
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
      // If user-specific, respect the 0 or 1. If global, it's always 1.
      prefMaps[pref.preferenceType].set(pref.targetId, pref.mangaMode === 1);
    }
  }
  
  return prefMaps;
}

/**
 * Resolve manga mode hierarchically
 */
function resolveMangaMode(comicId, series, publisher, comicPath, prefMaps, comicsRoots) {
  if (prefMaps.comic.has(comicId)) return prefMaps.comic.get(comicId);
  if (series && prefMaps.series.has(series)) return prefMaps.series.get(series);
  if (publisher && prefMaps.publisher.has(publisher)) return prefMaps.publisher.get(publisher);
  if (comicPath && comicsRoots) {
    const root = comicsRoots.find(d => comicPath.startsWith(d));
    if (root && prefMaps.library.has(root)) return prefMaps.library.get(root);
  }
  return false;
}

module.exports = {
  db,
  dbGet,
  dbRun,
  dbAll,
  initializeDatabase,
  checkComicAccess,
  setMangaModePreference,
  getAllMangaModePreferences,
  getMangaPrefMaps,
  resolveMangaMode
};
