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
  });
}

module.exports = {
  db,
  dbGet,
  dbRun,
  dbAll,
  initializeDatabase
};
