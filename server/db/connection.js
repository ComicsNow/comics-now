const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { DB_FILE } = require('../constants');
const { log } = require('../logger');

const dbDir = path.dirname(DB_FILE);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_FILE);

// Enable performance pragmas (WAL mode, busy timeout, foreign keys, memory cache, memory-mapped I/O)
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -64000');
db.pragma('mmap_size = 268435456');
db.pragma('temp_store = MEMORY');
db.pragma('journal_size_limit = 16777216');

// Periodically run an online checkpoint every hour to keep WAL size small on disk
const walCheckpointTimer = setInterval(() => {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    log('ERROR', 'DB', `Automated WAL checkpoint failed: ${err.message}`);
  }
}, 60 * 60 * 1000);
if (walCheckpointTimer && typeof walCheckpointTimer.unref === 'function') {
  walCheckpointTimer.unref();
}

const statementCache = new Map();
const MAX_CACHED_STATEMENTS = 250;

function getPreparedStatement(sql) {
  let stmt = statementCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    if (statementCache.size >= MAX_CACHED_STATEMENTS) {
      const firstKey = statementCache.keys().next().value;
      statementCache.delete(firstKey);
    }
    statementCache.set(sql, stmt);
  }
  return stmt;
}

// Custom async wrapper for db.get
async function dbGet(sql, params = []) {
  try {
    const stmt = getPreparedStatement(sql);
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
    const stmt = getPreparedStatement(sql);
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
    const stmt = getPreparedStatement(sql);
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

async function closeDb() {
  statementCache.clear();
  if (db && typeof db.close === 'function') {
    db.close();
  }
}

function getDb() {
  return db;
}

module.exports = {
  db,
  getDb,
  dbGet,
  dbAll,
  dbRun,
  closeDb,
  getPreparedStatement,
  statementCache
};
