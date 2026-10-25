const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { initializeDatabase, dbAll, dbGet } = require('../server/db');

describe('Database Initialization & Schema Integrity', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  test('no legacy migrations directory exists', () => {
    const migrationsDir = path.join(__dirname, '..', 'server', 'migrations');
    expect(fs.existsSync(migrationsDir)).toBe(false);
  });

  test('all core tables are created with proper schemas', async () => {
    const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.map(t => t.name);

    const requiredTables = [
      'settings',
      'comics',
      'scan_dirs',
      'devices',
      'device_progress',
      'users',
      'progress',
      'user_settings',
      'user_comic_status',
      'user_reading_preferences',
      'user_library_access',
      'reading_lists',
      'reading_list_items',
      'impersonation_audit'
    ];

    for (const table of requiredTables) {
      expect(tableNames).toContain(table);
    }
  });

  test('comics table contains all required columns natively without migrations', async () => {
    const cols = await dbAll("PRAGMA table_info('comics')");
    const colNames = cols.map(c => c.name);

    const expectedCols = [
      'id', 'publisher', 'series', 'name', 'path', 'metadata',
      'lastReadPage', 'totalPages', 'updatedAt', 'thumbnailPath',
      'convertedAt', 'guidedViewStatus', 'guidedViewError', 'guidedViewPath',
      'guidedMode', 'bubbleMode', 'libraryMode', 'tagStatus'
    ];

    for (const col of expectedCols) {
      expect(colNames).toContain(col);
    }
  });

  test('devices table contains userId column natively', async () => {
    const cols = await dbAll("PRAGMA table_info('devices')");
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('userId');
  });

  test('reading_lists table contains sortOrder column natively', async () => {
    const cols = await dbAll("PRAGMA table_info('reading_lists')");
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('sortOrder');
  });

  test('user_reading_preferences table contains mangaMode and continuousMode', async () => {
    const cols = await dbAll("PRAGMA table_info('user_reading_preferences')");
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('mangaMode');
    expect(colNames).toContain('continuousMode');
  });

  test('user_library_access table contains direct_access and child_access', async () => {
    const cols = await dbAll("PRAGMA table_info('user_library_access')");
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('direct_access');
    expect(colNames).toContain('child_access');
  });

  test('default system user and default settings are seeded on initialization', async () => {
    const defaultUser = await dbGet("SELECT * FROM users WHERE userId = 'default-user'");
    expect(defaultUser).toBeDefined();
    expect(defaultUser.role).toBe('admin');

    const allowedFormats = await dbGet("SELECT value FROM settings WHERE key = 'allowed_formats'");
    expect(allowedFormats).toBeDefined();
    expect(JSON.parse(allowedFormats.value)).toBe('cbz');
  });

  test('all performance and lookup indexes exist', async () => {
    const indexes = await dbAll("SELECT name FROM sqlite_master WHERE type='index'");
    const indexNames = indexes.map(i => i.name);

    const expectedIndexes = [
      'idx_user_library_access_lookup',
      'idx_comics_publisher',
      'idx_comics_series',
      'idx_comics_updatedAt',
      'idx_reading_list_items_comic'
    ];

    for (const idx of expectedIndexes) {
      expect(indexNames).toContain(idx);
    }
  });

  test('initializeDatabase is idempotent and safe to run repeatedly', async () => {
    await expect(initializeDatabase()).resolves.not.toThrow();
    await expect(initializeDatabase()).resolves.not.toThrow();

    // Verify system user was not duplicated or modified
    const users = await dbAll("SELECT * FROM users WHERE userId = 'default-user'");
    expect(users).toHaveLength(1);
  });
});
