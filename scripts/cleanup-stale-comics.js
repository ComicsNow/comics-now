#!/usr/bin/env node
// Removes DB rows for comics whose files no longer exist on disk,
// along with their orphan thumbnails and dependent rows.
// Usage:
//   node scripts/cleanup-stale-comics.js          # dry run, prints what would be deleted
//   node scripts/cleanup-stale-comics.js --apply  # actually delete

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'comics-now.db');
const THUMBNAILS_DIR = path.join(ROOT, 'thumbnails');

const apply = process.argv.includes('--apply');

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows)));
  });
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (e) { e ? reject(e) : resolve(this); });
  });
}

(async () => {
  const db = new sqlite3.Database(DB_FILE);
  const rows = await all(db, 'SELECT id, path, thumbnailPath FROM comics');
  console.log(`Total comics in DB: ${rows.length}`);

  const stale = rows.filter(r => !fs.existsSync(r.path));
  console.log(`Stale (path missing on disk): ${stale.length}`);

  if (stale.length === 0) {
    db.close();
    return;
  }

  for (const r of stale.slice(0, 10)) console.log(`  - ${r.path}`);
  if (stale.length > 10) console.log(`  ... and ${stale.length - 10} more`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete.');
    db.close();
    return;
  }

  let deletedThumbs = 0;
  await run(db, 'BEGIN');
  try {
    for (const r of stale) {
      await run(db, 'DELETE FROM comics WHERE id = ?', [r.id]);
      await run(db, 'DELETE FROM progress WHERE comicId = ?', [r.id]);
      await run(db, 'DELETE FROM user_comic_status WHERE comicId = ?', [r.id]);
      await run(db, 'DELETE FROM device_progress WHERE comicId = ?', [r.id]);
      await run(db, 'DELETE FROM reading_list_items WHERE comicId = ?', [r.id]);
      await run(db,
        "DELETE FROM user_reading_preferences WHERE preferenceType = 'comic' AND targetId = ?",
        [r.id]
      );

      if (r.thumbnailPath) {
        const thumb = path.join(THUMBNAILS_DIR, r.thumbnailPath);
        if (fs.existsSync(thumb)) {
          try { fs.unlinkSync(thumb); deletedThumbs++; } catch {}
        }
      }
    }
    await run(db, 'COMMIT');
  } catch (e) {
    await run(db, 'ROLLBACK');
    console.error('Rollback due to error:', e.message);
    db.close();
    process.exit(1);
  }

  console.log(`\nDeleted ${stale.length} comic rows and ${deletedThumbs} orphan thumbnails.`);
  db.close();
})().catch(e => { console.error(e); process.exit(1); });
