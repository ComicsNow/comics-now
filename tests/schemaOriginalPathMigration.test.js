const Database = require('better-sqlite3');
const { ensureComicOriginalPathColumn } = require('../server/db/schema');

function makeRunners(db) {
  const calls = [];
  return {
    calls,
    all: (sql, params = []) => db.prepare(sql).all(...params),
    run: (sql, params = []) => {
      calls.push(sql);
      return db.prepare(sql).run(...params);
    }
  };
}

describe('comics.originalPath schema upgrader', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE comics (id TEXT PRIMARY KEY, path TEXT, convertedAt INTEGER)');
    db.prepare('INSERT INTO comics (id, path) VALUES (?, ?)').run('legacy-id', '/inbox/Legacy.cbz');
  });

  afterEach(() => {
    db.close();
  });

  test('adds originalPath to a legacy comics table without touching existing rows', async () => {
    const runners = makeRunners(db);

    await ensureComicOriginalPathColumn(runners);

    const cols = db.prepare("PRAGMA table_info('comics')").all().map(c => c.name);
    expect(cols).toContain('originalPath');

    const row = db.prepare('SELECT id, path, originalPath FROM comics WHERE id = ?').get('legacy-id');
    expect(row).toEqual({ id: 'legacy-id', path: '/inbox/Legacy.cbz', originalPath: null });
  });

  test('is idempotent: a second run performs no ALTER TABLE', async () => {
    const runners = makeRunners(db);

    await ensureComicOriginalPathColumn(runners);
    const altersAfterFirst = runners.calls.filter(sql => /ALTER TABLE/i.test(sql)).length;
    expect(altersAfterFirst).toBe(1);

    await ensureComicOriginalPathColumn(runners);
    const altersAfterSecond = runners.calls.filter(sql => /ALTER TABLE/i.test(sql)).length;
    expect(altersAfterSecond).toBe(1);

    const cols = db.prepare("PRAGMA table_info('comics')").all().map(c => c.name);
    expect(cols.filter(c => c === 'originalPath')).toHaveLength(1);
  });

  test('no-ops when the column already exists (new install path)', async () => {
    db.exec('ALTER TABLE comics ADD COLUMN originalPath TEXT');
    const runners = makeRunners(db);

    await ensureComicOriginalPathColumn(runners);

    expect(runners.calls.filter(sql => /ALTER TABLE/i.test(sql))).toHaveLength(0);
  });
});
