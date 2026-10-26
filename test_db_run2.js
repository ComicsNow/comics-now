const db = require('./server/db.js');
async function test() {
  await db.initializeDatabase();

  // Clean up test data
  await db.dbRun("DELETE FROM comics WHERE id LIKE 'test_%'");

  const start = Date.now();
  for(let i=0; i<1000; i++) {
     await db.dbRun("INSERT INTO comics (id, path, name) VALUES (?, ?, ?)", [`test_${i}`, `/test/${i}`, `test_${i}`]);
  }
  const end = Date.now();
  console.log(`Unoptimized (Sequential await db.dbRun) for 1000 rows: ${end - start}ms`);

  await db.dbRun("DELETE FROM comics WHERE id LIKE 'test_%'");

  const stmt = db.db.prepare("INSERT INTO comics (id, path, name) VALUES (?, ?, ?)");
  const rows = [];
  for(let i=0; i<1000; i++) {
     rows.push([`test_${i}`, `/test/${i}`, `test_${i}`]);
  }

  const start2 = Date.now();
  const tx = db.db.transaction((updates) => {
    for (const update of updates) {
      stmt.run(update[0], update[1], update[2]);
    }
  });
  tx(rows);
  const end2 = Date.now();
  console.log(`Optimized (Batch transaction) for 1000 rows: ${end2 - start2}ms`);
}
test().catch(console.error);
