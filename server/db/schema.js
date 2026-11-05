const { db, dbRun, dbAll, dbGet } = require('./connection');
const { log } = require('../logger');
const { isTitleSameAsSeries, resolveCreatorRoles } = require('../services/metadata');
const { migratePlaintextSecrets } = require('../services/secrets-migrator');

/**
 * Adds comics.originalPath to databases created before the column existed.
 * New installs already have it via CREATE TABLE, so this is a no-op for them.
 */
async function ensureComicOriginalPathColumn(runners = {}) {
  const all = typeof runners.all === 'function' ? runners.all : dbAll;
  const run = typeof runners.run === 'function' ? runners.run : dbRun;

  const cols = await all("PRAGMA table_info('comics')");
  if (cols.some(c => c.name === 'originalPath')) return false;

  try {
    await run('ALTER TABLE comics ADD COLUMN originalPath TEXT');
    log('INFO', 'DB', 'Added comics.originalPath column');
    return true;
  } catch (e) {
    // Defensive: another startup won the race and added it first.
    if (!/duplicate column name/i.test(e.message || '')) throw e;
    return false;
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
      originalPath TEXT,
      guidedViewStatus TEXT DEFAULT 'pending',
      guidedViewError TEXT,
      guidedViewPath TEXT,
      guidedMode INTEGER DEFAULT 0, 
      bubbleMode INTEGER DEFAULT 0,
      libraryMode TEXT DEFAULT 'metadata',
      tagStatus TEXT DEFAULT 'pending'
    )`);
    await ensureComicOriginalPathColumn();
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

    // Seed default system user
    await dbRun(`INSERT OR IGNORE INTO users (userId, email, role) VALUES ('default-user', 'local@localhost', 'admin')`);

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

    // Admin impersonation audit trail ("login as user")
    await dbRun(`CREATE TABLE IF NOT EXISTS impersonation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adminUserId TEXT,
      adminEmail TEXT,
      targetUserId TEXT,
      targetEmail TEXT,
      action TEXT,
      ts INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )`);

    // Final step: Create/ensure all indexes exist
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_user_library_access_lookup ON user_library_access(userId, accessType)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_publisher ON comics(publisher)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_series ON comics(series)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_name ON comics(name COLLATE NOCASE)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_updatedAt ON comics(updatedAt)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_originalPath ON comics(originalPath)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_comics_publisher_series ON comics(publisher, series)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_reading_list_items_comic ON reading_list_items(comicId)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_reading_list_items_list_sort ON reading_list_items(listId, sortOrder)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_reading_lists_user_sort ON reading_lists(userId, sortOrder)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_user_comic_status_comic ON user_comic_status(comicId)`);

    await dbRun('COMMIT');
    log('INFO', 'DB', 'Database initialization complete');

    // Title vs Series cleanup migration: If Title matches Series (including issue numbers, #3, etc.), set Title to '' in comics.metadata
    const titleMigrationFlag = await dbGet("SELECT value FROM settings WHERE key = 'migration_title_cleanup_v1'");
    if (!titleMigrationFlag) {
      try {
        const rows = db.prepare("SELECT id, series, metadata FROM comics WHERE metadata LIKE '%\"Title\":%'").all();
        const updateStmt = db.prepare("UPDATE comics SET metadata = ? WHERE id = ?");
        let cleanedCount = 0;
        for (const row of rows) {
          if (!row.metadata) continue;
          try {
            const m = JSON.parse(row.metadata);
            if (m.Title && (isTitleSameAsSeries(m.Title, m.Series || row.series) || (!m.Series && !row.series && isTitleSameAsSeries(m.Title, '')))) {
              m.Title = '';
              updateStmt.run(JSON.stringify(m), row.id);
              cleanedCount++;
            }
          } catch {}
        }
        await dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_title_cleanup_v1', '1')");
        if (cleanedCount > 0) {
          log('INFO', 'DB', `Cleaned redundant Title from metadata for ${cleanedCount} comic(s)`);
        }
      } catch (e) {
        log('WARN', 'DB', `Title cleanup migration error: ${e.message}`);
      }
    }

    // Creator role disambiguation migration:
    const creatorRolesFlag = await dbGet("SELECT value FROM settings WHERE key = 'migration_creator_roles_v1'");
    if (!creatorRolesFlag) {
      try {
        const rows = db.prepare("SELECT id, series, metadata FROM comics WHERE metadata LIKE '%\"Writer\":%' OR metadata LIKE '%\"writer\":%'").all();
        const updateStmt = db.prepare("UPDATE comics SET metadata = ? WHERE id = ?");
        let disambiguatedCount = 0;

        const seriesArtistMap = new Map();
        const allSeriesRows = db.prepare("SELECT series, metadata FROM comics WHERE series IS NOT NULL AND (metadata LIKE '%\"Penciller\":%' OR metadata LIKE '%\"penciller\":%' OR metadata LIKE '%\"Inker\":%' OR metadata LIKE '%\"Colorist\":%')").all();
        for (const sr of allSeriesRows) {
          if (!sr.metadata || !sr.series) continue;
          try {
            const sm = JSON.parse(sr.metadata);
            const artists = [
              sm.Penciller, sm.penciller,
              sm.Inker, sm.inker,
              sm.Colorist, sm.colorist,
              sm.Letterer, sm.letterer,
              sm.CoverArtist, sm.cover_artist
            ].filter(Boolean);
            if (artists.length) {
              const list = seriesArtistMap.get(sr.series) || [];
              for (const a of artists) {
                const parts = String(a).split(/[,;&]|\s+and\s+/i);
                for (const p of parts) {
                  const trimmed = p.trim();
                  if (trimmed && !list.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) {
                    list.push(trimmed);
                  }
                }
              }
              seriesArtistMap.set(sr.series, list);
            }
          } catch {}
        }

        for (const row of rows) {
          if (!row.metadata) continue;
          try {
            const m = JSON.parse(row.metadata);
            const origWriter = m.Writer || m.writer || '';
            const origPenciller = m.Penciller || m.penciller || '';
            const origColorist = m.Colorist || m.colorist || '';

            const seriesArtists = (row.series && seriesArtistMap.get(row.series)) || [];
            resolveCreatorRoles(m, seriesArtists);

            const newWriter = m.Writer || m.writer || '';
            const newPenciller = m.Penciller || m.penciller || '';
            const newColorist = m.Colorist || m.colorist || '';

            if (newWriter !== origWriter || newPenciller !== origPenciller || newColorist !== origColorist) {
              updateStmt.run(JSON.stringify(m), row.id);
              disambiguatedCount++;
            }
          } catch {}
        }

        await dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_creator_roles_v1', '1')");
        if (disambiguatedCount > 0) {
          log('INFO', 'DB', `Disambiguated creator roles for ${disambiguatedCount} comic(s)`);
        }
      } catch (e) {
        log('WARN', 'DB', `Creator role disambiguation migration error: ${e.message}`);
      }
    }

    // Secrets encryption migration v1
    const secretsMigrationFlag = await dbGet("SELECT value FROM settings WHERE key = 'migration_secrets_encryption_v1'");
    if (!secretsMigrationFlag) {
      try {
        const stats = await migratePlaintextSecrets({ all: dbAll, run: dbRun });
        await dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('migration_secrets_encryption_v1', '1')");
        if (stats.migratedCount > 0) {
          log('INFO', 'DB', `Encrypted ${stats.migratedCount} legacy plaintext secret(s) at rest with AES-256-GCM`);
        }
      } catch (e) {
        log('WARN', 'DB', `Secrets encryption migration error: ${e.message}`);
      }
    }
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    log('ERROR', 'DB', `Database initialization failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  initializeDatabase,
  ensureComicOriginalPathColumn
};
