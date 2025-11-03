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
function dropMangaModeColumn() {
  log('INFO', 'DB', 'Dropping mangaMode column from comics table...');

  db.serialize(() => {
    // Step 1: Create new table without mangaMode column
    db.run(`CREATE TABLE IF NOT EXISTS comics_new (
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
      convertedAt INTEGER
    )`, (err) => {
      if (err) {
        log('ERROR', 'DB', `Failed to create comics_new table: ${err.message}`);
        return;
      }

      // Step 2: Copy data from old table to new table (excluding mangaMode)
      db.run(`INSERT INTO comics_new (id, publisher, series, name, path, metadata, lastReadPage, totalPages, updatedAt, thumbnailPath, convertedAt)
              SELECT id, publisher, series, name, path, metadata, lastReadPage, totalPages, updatedAt, thumbnailPath, convertedAt
              FROM comics`, (err) => {
        if (err) {
          log('ERROR', 'DB', `Failed to copy data to comics_new: ${err.message}`);
          return;
        }

        // Step 3: Drop old table
        db.run(`DROP TABLE comics`, (err) => {
          if (err) {
            log('ERROR', 'DB', `Failed to drop old comics table: ${err.message}`);
            return;
          }

          // Step 4: Rename new table to original name
          db.run(`ALTER TABLE comics_new RENAME TO comics`, (err) => {
            if (err) {
              log('ERROR', 'DB', `Failed to rename comics_new to comics: ${err.message}`);
              return;
            }

            log('INFO', 'DB', 'Successfully dropped mangaMode column from comics table');
          });
        });
      });
    });
  });
}

function initializeDatabase() {
  log('INFO', 'DB', 'Initializing database...');
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS comics (
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
      convertedAt INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS scan_dirs (
      dir TEXT PRIMARY KEY,
      mtimeMs REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS devices (
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
    db.run(`CREATE TABLE IF NOT EXISTS device_progress (
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
    db.run(`CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      role TEXT DEFAULT 'user',
      created INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      lastSeen INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS progress (
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

    db.run(`CREATE TABLE IF NOT EXISTS user_settings (
      userId TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (userId, key),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Per-user comic progress/status (for read/unread badges, independent of device)
    db.run(`CREATE TABLE IF NOT EXISTS user_comic_status (
      userId TEXT NOT NULL,
      comicId TEXT NOT NULL,
      lastReadPage INTEGER DEFAULT 0,
      totalPages INTEGER DEFAULT 0,
      updatedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY (userId, comicId),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Per-user reading preferences (manga mode, continuous mode, etc.)
    // Supports hierarchical preferences: comic -> series -> publisher -> library
    db.run(`CREATE TABLE IF NOT EXISTS user_reading_preferences (
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
    // Supports hierarchical access: root_folder -> publisher -> series
    // Series is the lowest level - having series access grants access to all comics in that series
    // Two access modes per level:
    //   - direct_access: items directly at this level only
    //   - child_access: all descendants under this level (children, grandchildren, etc.)
    db.run(`CREATE TABLE IF NOT EXISTS user_library_access (
      userId TEXT NOT NULL,
      accessType TEXT NOT NULL,
      accessValue TEXT NOT NULL,
      direct_access INTEGER DEFAULT 0,
      child_access INTEGER DEFAULT 0,
      created INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY (userId, accessType, accessValue),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Create index for faster access queries
    db.run(`CREATE INDEX IF NOT EXISTS idx_user_library_access_lookup
      ON user_library_access(userId, accessType)`);

    // Reading lists table
    db.run(`CREATE TABLE IF NOT EXISTS reading_lists (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Reading list items (comics in lists) with sort order
    db.run(`CREATE TABLE IF NOT EXISTS reading_list_items (
      listId TEXT NOT NULL,
      comicId TEXT NOT NULL,
      addedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      sortOrder INTEGER DEFAULT 0,
      PRIMARY KEY (listId, comicId),
      FOREIGN KEY (listId) REFERENCES reading_lists(id) ON DELETE CASCADE
    )`);

    // Create index for faster comic lookups in reading lists
    db.run(`CREATE INDEX IF NOT EXISTS idx_reading_list_items_comic
      ON reading_list_items(comicId)`);


    db.all('PRAGMA table_info(comics)', (err, cols) => {
      if (err) {
        log('ERROR', 'DB', `PRAGMA error: ${err.message}`);
        return;
      }
      if (!cols.some(c => c.name === 'thumbnailPath')) {
        db.run('ALTER TABLE comics ADD COLUMN thumbnailPath TEXT');
      }
      if (!cols.some(c => c.name === 'convertedAt')) {
        db.run('ALTER TABLE comics ADD COLUMN convertedAt INTEGER');
      }

      // Migration: Move mangaMode from comics table to user_reading_preferences
      if (cols.some(c => c.name === 'mangaMode')) {
        log('INFO', 'DB', 'Detected mangaMode column in comics table - starting migration...');

        // Check if migration has already been done
        db.get(`SELECT value FROM settings WHERE key = 'manga_mode_migration_v1'`, (err, row) => {
          if (err || row) {
            log('INFO', 'DB', 'Manga mode migration already completed or error checking');
            return;
          }

          // Get all comics with mangaMode = 1
          db.all(`SELECT id FROM comics WHERE mangaMode = 1`, (err, comics) => {
            if (err || !comics || comics.length === 0) {
              log('INFO', 'DB', 'No comics with manga mode enabled, skipping migration');
              db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('manga_mode_migration_v1', 'completed')`);
              dropMangaModeColumn();
              return;
            }

            // Get all users
            db.all(`SELECT userId FROM users`, (err, users) => {
              if (err || !users || users.length === 0) {
                log('INFO', 'DB', 'No users found, skipping manga mode data migration');
                db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('manga_mode_migration_v1', 'completed')`);
                dropMangaModeColumn();
                return;
              }

              log('INFO', 'DB', `Migrating manga mode for ${comics.length} comics to ${users.length} users...`);

              const stmt = db.prepare(`
                INSERT INTO user_reading_preferences (userId, preferenceType, targetId, mangaMode, createdAt, updatedAt)
                VALUES (?, 'comic', ?, 1, ?, ?)
                ON CONFLICT(userId, preferenceType, targetId) DO UPDATE SET
                  mangaMode = 1,
                  updatedAt = excluded.updatedAt
              `);

              const now = Date.now();
              let migrated = 0;

              users.forEach(user => {
                comics.forEach(comic => {
                  stmt.run(user.userId, comic.id, now, now);
                  migrated++;
                });
              });

              stmt.finalize(() => {
                log('INFO', 'DB', `Migrated ${migrated} manga mode preferences`);
                db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('manga_mode_migration_v1', 'completed')`, () => {
                  dropMangaModeColumn();
                });
              });
            });
          });
        });
      }
    });

    // Add userId column to devices table (nullable for backward compatibility)
    db.all('PRAGMA table_info(devices)', (err, cols) => {
      if (err) {
        log('ERROR', 'DB', `PRAGMA error on devices: ${err.message}`);
        return;
      }
      if (!cols.some(c => c.name === 'userId')) {
        db.run('ALTER TABLE devices ADD COLUMN userId TEXT', (alterErr) => {
          if (alterErr) {
            log('ERROR', 'DB', `Failed to add userId to devices: ${alterErr.message}`);
          } else {
            log('INFO', 'DB', 'Added userId column to devices table');
          }
        });
      }
    });

    // Migration: Add new access columns to existing table
    db.all('PRAGMA table_info(user_library_access)', (err, cols) => {
      if (err || !cols) return;

      // Check what columns exist
      const hasGranted = cols.some(c => c.name === 'granted');
      const hasDirectAccess = cols.some(c => c.name === 'direct_access');
      const hasRecursiveAccess = cols.some(c => c.name === 'recursive_access');
      const hasChildAccess = cols.some(c => c.name === 'child_access');

      // Migration 1: From granted to direct_access/recursive_access
      if (hasGranted && !hasDirectAccess && !hasRecursiveAccess) {
        log('INFO', 'DB', 'Migrating user_library_access from granted to direct_access/recursive_access...');

        db.run(`ALTER TABLE user_library_access ADD COLUMN direct_access INTEGER DEFAULT 0`, (err) => {
          if (err) {
            log('ERROR', 'DB', `Failed to add direct_access column: ${err.message}`);
            return;
          }

          db.run(`ALTER TABLE user_library_access ADD COLUMN recursive_access INTEGER DEFAULT 0`, (err) => {
            if (err) {
              log('ERROR', 'DB', `Failed to add recursive_access column: ${err.message}`);
              return;
            }

            db.run(`UPDATE user_library_access SET recursive_access = granted, direct_access = granted WHERE granted = 1`, (err) => {
              if (err) {
                log('ERROR', 'DB', `Failed to migrate granted values: ${err.message}`);
              } else {
                log('INFO', 'DB', 'Successfully migrated from granted to direct_access/recursive_access');
              }
            });
          });
        });
      }

      // Migration 2: From recursive_access to child_access
      if (hasRecursiveAccess && !hasChildAccess) {
        log('INFO', 'DB', 'Migrating user_library_access from recursive_access to child_access...');

        db.run(`ALTER TABLE user_library_access ADD COLUMN child_access INTEGER DEFAULT 0`, (err) => {
          if (err) {
            log('ERROR', 'DB', `Failed to add child_access column: ${err.message}`);
            return;
          }

          // Copy recursive_access data to child_access
          db.run(`UPDATE user_library_access SET child_access = recursive_access`, (err) => {
            if (err) {
              log('ERROR', 'DB', `Failed to migrate recursive_access to child_access: ${err.message}`);
            } else {
              log('INFO', 'DB', 'Successfully migrated from recursive_access to child_access');
            }
          });
        });
      }
    });

    // Migration: Grant full access to existing users (one-time)
    // New users will have no access by default
    db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_library_access'`, (err, table) => {
      if (err) {
        log('ERROR', 'DB', `Migration check error: ${err.message}`);
        return;
      }
      if (table) {
        // Check if migration has been run (marked by a special setting)
        db.get(`SELECT value FROM settings WHERE key = 'access_migration_v2'`, (err, row) => {
          if (err || row) return; // Already migrated or error

          // Get all existing users and grant them full access to all root folders
          db.all(`SELECT userId, role FROM users`, (err, users) => {
            if (err || !users || users.length === 0) return;

            // Get root folders from config (this will be loaded at runtime)
            const { getComicsDirectories } = require('./config');
            const rootFolders = getComicsDirectories();

            if (rootFolders.length === 0) return;

            const stmt = db.prepare(`INSERT OR IGNORE INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, 1, 1)`);

            users.forEach(user => {
              // Skip admins (they always have full access)
              if (user.role === 'admin') return;

              // Grant full access to each root folder for existing non-admin users
              rootFolders.forEach(folder => {
                stmt.run(user.userId, 'root_folder', folder);
              });
            });

            stmt.finalize(() => {
              db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('access_migration_v2', 'completed')`);
              log('INFO', 'DB', 'Completed user access migration v2 for existing users');
            });
          });
        });
      }
    });

    // Migration: Add continuous mode columns
    db.all('PRAGMA table_info(user_settings)', (err, cols) => {
      if (err) {
        log('ERROR', 'DB', `PRAGMA error on user_settings: ${err.message}`);
        return;
      }
      if (!cols.some(c => c.name === 'continuousModeDefault')) {
        db.run('ALTER TABLE user_settings ADD COLUMN continuousModeDefault INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) {
            log('ERROR', 'DB', `Failed to add continuousModeDefault to user_settings: ${alterErr.message}`);
          } else {
            log('INFO', 'DB', 'Added continuousModeDefault column to user_settings table');
          }
        });
      }
    });

    db.all('PRAGMA table_info(user_comic_status)', (err, cols) => {
      if (err) {
        log('ERROR', 'DB', `PRAGMA error on user_comic_status: ${err.message}`);
        return;
      }
      if (!cols.some(c => c.name === 'continuousMode')) {
        db.run('ALTER TABLE user_comic_status ADD COLUMN continuousMode INTEGER', (alterErr) => {
          if (alterErr) {
            log('ERROR', 'DB', `Failed to add continuousMode to user_comic_status: ${alterErr.message}`);
          } else {
            log('INFO', 'DB', 'Added continuousMode column to user_comic_status table');
          }
        });
      }
    });
  });
}

// Helper function to check if a user has access to a resource
// Admin users always have access
async function checkUserAccess(userId, userRole, accessType, accessValue) {
  // Admins have access to everything
  if (userRole === 'admin') {
    return true;
  }

  // Check if user has explicit access
  const access = await dbGet(
    `SELECT granted FROM user_library_access
     WHERE userId = ? AND accessType = ? AND accessValue = ?`,
    [userId, accessType, accessValue]
  );

  return access && access.granted === 1;
}

// Helper function to get all accessible resources for a user with access mode info
async function getUserAccessibleResources(userId, userRole, accessType) {
  // Admins have access to everything
  if (userRole === 'admin') {
    return null; // null means "all resources"
  }

  const resources = await dbAll(
    `SELECT accessValue, direct_access, recursive_access FROM user_library_access
     WHERE userId = ? AND accessType = ? AND (direct_access = 1 OR recursive_access = 1)`,
    [userId, accessType]
  );

  return resources.map(r => ({
    value: r.accessValue,
    direct: r.direct_access === 1,
    recursive: r.recursive_access === 1
  }));
}

// Helper function to check if user has access to a specific comic
// Uses hierarchical access control: root_folder -> publisher -> series
// Series is the lowest level - having series access grants access to all comics in that series
async function checkComicAccess(userId, userRole, comicPath, publisher, series, rootFolders, comicId = null) {
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
  const accessList = await dbAll(
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
 * Get manga mode preference for a specific comic with hierarchical fallback
 * Hierarchy: comic -> series -> publisher -> library (root folder)
 * Returns the most specific preference found, or false if none set
 */
async function getMangaModePreference(userId, comicId, series, publisher, rootFolder) {
  try {
    // 1. Check comic-level preference (most specific)
    const comicPref = await dbGet(
      `SELECT mangaMode FROM user_reading_preferences
       WHERE userId = ? AND preferenceType = 'comic' AND targetId = ?`,
      [userId, comicId]
    );
    if (comicPref !== undefined && comicPref !== null) {
      return comicPref.mangaMode === 1;
    }

    // 2. Check series-level preference
    const seriesPref = await dbGet(
      `SELECT mangaMode FROM user_reading_preferences
       WHERE userId = ? AND preferenceType = 'series' AND targetId = ?`,
      [userId, series]
    );
    if (seriesPref !== undefined && seriesPref !== null) {
      return seriesPref.mangaMode === 1;
    }

    // 3. Check publisher-level preference
    const publisherPref = await dbGet(
      `SELECT mangaMode FROM user_reading_preferences
       WHERE userId = ? AND preferenceType = 'publisher' AND targetId = ?`,
      [userId, publisher]
    );
    if (publisherPref !== undefined && publisherPref !== null) {
      return publisherPref.mangaMode === 1;
    }

    // 4. Check library-level preference (root folder)
    const libraryPref = await dbGet(
      `SELECT mangaMode FROM user_reading_preferences
       WHERE userId = ? AND preferenceType = 'library' AND targetId = ?`,
      [userId, rootFolder]
    );
    if (libraryPref !== undefined && libraryPref !== null) {
      return libraryPref.mangaMode === 1;
    }

    // No preference found - default to false (not manga mode)
    return false;
  } catch (error) {
    log('ERROR', 'MANGA_PREFS', `Failed to get manga mode preference: ${error.message}`);
    return false;
  }
}

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

module.exports = {
  db,
  dbGet,
  dbRun,
  dbAll,
  initializeDatabase,
  checkUserAccess,
  getUserAccessibleResources,
  checkComicAccess,
  getMangaModePreference,
  setMangaModePreference,
  getAllMangaModePreferences
};
