const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE comics (
    id TEXT PRIMARY KEY,
    path TEXT,
    name TEXT,
    publisher TEXT,
    series TEXT,
    libraryMode TEXT,
    tagStatus TEXT,
    updatedAt INTEGER,
    metadata TEXT
  )
`);

const numRecords = 2000;
console.log(`Inserting ${numRecords} base records...`);

// Initialize db with some records
const insertStmt = db.prepare(`
  INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const initTx = db.transaction(() => {
  for (let i = 0; i < numRecords; i++) {
    insertStmt.run(`id_${i}`, `/path/to/comic_${i}.cbz`, `comic_${i}.cbz`, 'Marvel', 'Spider-Man', 'metadata', 'successful', 10000, '{}');
  }
});
initTx();

// Mock inputs
const testData = [];
for (let i = 0; i < numRecords; i++) {
  testData.push([
    `id_${i}`,
    `/path/to/comic_${i}.cbz`,
    `comic_${i}.cbz`,
    'Marvel',
    'Spider-Man',
    'metadata',
    'successful',
    10001,
    '{"Title":"Amazing Spider-Man","Number":"1"}'
  ]);
}

// 1. Unoptimized logic (simulate await db.dbRun inside loop by running one at a time)
function runUnoptimized() {
  const stmt = db.prepare(`
    INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      tagStatus = excluded.tagStatus,
      publisher = excluded.publisher,
      series = excluded.series,
      updatedAt = excluded.updatedAt,
      metadata = COALESCE(excluded.metadata, comics.metadata)
  `);

  const start = Date.now();
  for (const row of testData) {
    // Note: simulating the await db.dbRun which actually does this sequentially
    stmt.run(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]);
  }
  const end = Date.now();
  return end - start;
}

// 2. Optimized logic (using a transaction to batch updates)
function runOptimized() {
  const stmt = db.prepare(`
    INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      tagStatus = excluded.tagStatus,
      publisher = excluded.publisher,
      series = excluded.series,
      updatedAt = excluded.updatedAt,
      metadata = COALESCE(excluded.metadata, comics.metadata)
  `);

  const start = Date.now();
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]);
    }
  });
  tx(testData);
  const end = Date.now();
  return end - start;
}

const unoptTime = runUnoptimized();
console.log(`Unoptimized time: ${unoptTime} ms`);

const optTime = runOptimized();
console.log(`Optimized time: ${optTime} ms`);

db.close();
