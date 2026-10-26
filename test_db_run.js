const db = require('./server/db.js');
async function test() {
  await db.initializeDatabase();
  const start = Date.now();
  for(let i=0; i<500; i++) {
     await db.dbRun("INSERT INTO user_reading_preferences (userId, preferenceType, targetId, updatedAt, createdAt) VALUES (?, ?, ?, ?, ?)", [`user_${i}`, 'test', 'target', Date.now(), Date.now()]);
  }
  const end = Date.now();
  console.log(`Unoptimized (Sequential await db.dbRun): ${end - start}ms`);

  const stmt = db.db.prepare("INSERT INTO user_reading_preferences (userId, preferenceType, targetId, updatedAt, createdAt) VALUES (?, ?, ?, ?, ?)");
  const rows = [];
  for(let i=500; i<1000; i++) {
     rows.push([`user_${i}`, 'test', 'target', Date.now(), Date.now()]);
  }

  const start2 = Date.now();
  const tx = db.db.transaction((updates) => {
    for (const update of updates) {
      stmt.run(update[0], update[1], update[2], update[3], update[4]);
    }
  });
  tx(rows);
  const end2 = Date.now();
  console.log(`Optimized (Batch transaction): ${end2 - start2}ms`);
}
test().catch(console.error);
