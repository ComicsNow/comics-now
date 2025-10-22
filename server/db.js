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

  // Step 3: Check SERIES direct access
  const seriesDirectAccess = accessList.find(a =>
    a.accessType === 'series' &&
    a.accessValue === series &&
    a.direct_access === 1
  );

  return !!seriesDirectAccess; // Must have series access to access the comic
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
