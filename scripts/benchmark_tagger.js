const db = require('../server/db');

async function runBenchmark() {
  console.log('Running benchmark...');
  // Setup tables if needed
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS comics (
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

  const numRecords = 5000;
  console.log(`Testing with ${numRecords} inserts/updates`);

  // N+1 method
  let start = Date.now();
  for (let i = 0; i < numRecords; i++) {
    const id = `id_${i}`;
    const filePath = `/path/to/comic_${i}.cbz`;
    const name = `Comic ${i}`;
    const pub = `Publisher`;
    const ser = `Series`;
    const mtimeMs = Date.now();
    const dbMeta = { title: `Title ${i}` };

    await db.dbRun(
      `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tagStatus = excluded.tagStatus,
         publisher = excluded.publisher,
         series = excluded.series,
         updatedAt = excluded.updatedAt,
         metadata = COALESCE(excluded.metadata, comics.metadata)`,
      [id, filePath, name, pub, ser, 'metadata', 'successful', mtimeMs, JSON.stringify(dbMeta)]
    );
  }
  let duration = Date.now() - start;
  console.log(`N+1 Query Method: ${duration}ms`);

  // Batch method (Transaction)
  start = Date.now();
  const stmt = db.db.prepare(`
    INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      tagStatus = excluded.tagStatus,
      publisher = excluded.publisher,
      series = excluded.series,
      updatedAt = excluded.updatedAt,
      metadata = COALESCE(excluded.metadata, comics.metadata)
  `);
  const insertMany = db.db.transaction((records) => {
    for (const record of records) {
      stmt.run(record);
    }
  });

  const recordsToInsert = [];
  for (let i = 0; i < numRecords; i++) {
    const id = `id_batch_${i}`;
    const filePath = `/path/to/batch_comic_${i}.cbz`;
    const name = `Batch Comic ${i}`;
    const pub = `Publisher`;
    const ser = `Series`;
    const mtimeMs = Date.now();
    const dbMeta = { title: `Batch Title ${i}` };

    recordsToInsert.push([
      id, filePath, name, pub, ser, 'metadata', 'successful', mtimeMs, JSON.stringify(dbMeta)
    ]);
  }

  insertMany(recordsToInsert);

  duration = Date.now() - start;
  console.log(`Batch Transaction Method: ${duration}ms`);
}
runBenchmark();
