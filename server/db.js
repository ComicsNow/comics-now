const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { DB_FILE } = require('./constants');
const { log } = require('./logger');

const db = new sqlite3.Database(DB_FILE);
const dbGet = promisify(db.get.bind(db));
const dbRun = promisify(db.run.bind(db));
const dbAll = promisify(db.all.bind(db));

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

    // User library access control
    // Supports hierarchical access: root_folder -> publisher -> series -> comic
    // Two access modes per level:
    //   - direct_access: items directly at this level only
    //   - recursive_access: all descendants under this level
    db.run(`CREATE TABLE IF NOT EXISTS user_library_access (
      userId TEXT NOT NULL,
      accessType TEXT NOT NULL,
      accessValue TEXT NOT NULL,
      direct_access INTEGER DEFAULT 0,
      recursive_access INTEGER DEFAULT 0,
      created INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY (userId, accessType, accessValue),
      FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE
    )`);

    // Create index for faster access queries
    db.run(`CREATE INDEX IF NOT EXISTS idx_user_library_access_lookup
      ON user_library_access(userId, accessType)`);


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
      if (!cols.some(c => c.name === 'mangaMode')) {
        db.run('ALTER TABLE comics ADD COLUMN mangaMode INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) {
            log('ERROR', 'DB', `Failed to add mangaMode column: ${alterErr.message}`);
          } else {
            log('INFO', 'DB', 'Added mangaMode column to comics table');
          }
        });
      }
      // Old sync columns (lastSyncTimestamp, lastSyncDeviceId, lastSyncDeviceName) are deprecated
      // in favor of per-device progress tracking via device_progress table
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

      // Check if old 'granted' column exists
      const hasGranted = cols.some(c => c.name === 'granted');
      const hasDirectAccess = cols.some(c => c.name === 'direct_access');
      const hasRecursiveAccess = cols.some(c => c.name === 'recursive_access');

      if (hasGranted && !hasDirectAccess && !hasRecursiveAccess) {
        // Migrate from old schema to new schema
        log('INFO', 'DB', 'Migrating user_library_access table to new schema...');

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

            // Migrate old 'granted' values to 'recursive_access' (old system gave full access)
            db.run(`UPDATE user_library_access SET recursive_access = granted, direct_access = granted WHERE granted = 1`, (err) => {
              if (err) {
                log('ERROR', 'DB', `Failed to migrate granted values: ${err.message}`);
              } else {
                log('INFO', 'DB', 'Successfully migrated access control schema');
              }
            });
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

            const stmt = db.prepare(`INSERT OR IGNORE INTO user_library_access (userId, accessType, accessValue, direct_access, recursive_access) VALUES (?, ?, ?, 1, 1)`);

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
// Uses hierarchical access control: root_folder -> publisher -> series -> comic
async function checkComicAccess(userId, userRole, comicPath, publisher, series, rootFolders) {
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
    `SELECT accessType, accessValue, direct_access, recursive_access
     FROM user_library_access
     WHERE userId = ? AND (direct_access = 1 OR recursive_access = 1)`,
    [userId]
  );

  // Check if user has recursive access at any parent level
  for (const access of accessList) {
    if (access.recursive_access === 1) {
      // Check root folder recursive access
      if (access.accessType === 'root_folder' && access.accessValue === rootFolder) {
        return true;
      }
      // Check publisher recursive access
      if (access.accessType === 'publisher' && access.accessValue === publisher) {
        return true;
      }
      // Check series recursive access
      if (access.accessType === 'series' && access.accessValue === series) {
        return true;
      }
    }

    // For series level, direct access also grants access to comics in that series
    if (access.direct_access === 1 || access.recursive_access === 1) {
      if (access.accessType === 'series' && access.accessValue === series) {
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  db,
  dbGet,
  dbRun,
  dbAll,
  initializeDatabase,
  checkUserAccess,
  getUserAccessibleResources,
  checkComicAccess
};
