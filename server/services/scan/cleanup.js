const fs = require('fs');
const path = require('path');
const { dbRun, dbAll } = require('../../db');
const { log } = require('../../logger');
const {
  ROOT_DIR,
  THUMBNAILS_DIRECTORY,
  GUIDED_VIEW_DIR
} = require('../../constants');
const { generateThumbnail } = require('../library-pages');

/**
 * Removes missing comics and cleans up orphan thumbnails and guided view sidecars.
 * Aborts if top-level dirs were unreachable or subfolder scan errors occurred.
 */
async function cleanupStaleComics({ dbComicsMap, fileSystemComics, unreachableTopDirs, subDirScanErrors }) {
  const toDelete = Array.from(dbComicsMap.keys()).filter(p => !fileSystemComics.has(p));

  if (unreachableTopDirs.length > 0 || subDirScanErrors > 0) {
    log('ERROR', 'SCAN', `Aborting stale-comic cleanup: ${unreachableTopDirs.length} top-level dir(s) unreachable, ${subDirScanErrors} subfolder error(s). Would have deleted ${toDelete.length} comics.`);
    return;
  }

  for (const p of toDelete) {
    // Critical safeguard: verify file is actually gone from filesystem before deleting from DB
    if (fs.existsSync(p)) {
      log('WARN', 'SCAN', `Safeguard: preserving comic that exists on disk but was missed in scan: ${path.basename(p)}`);
      continue;
    }
    const record = dbComicsMap.get(p);
    log('INFO', 'SCAN', `Removing missing comic: ${path.basename(p)}`);
    await dbRun('DELETE FROM comics WHERE path = ?', [p]);

    if (record?.thumbnailPath) {
      const full = path.join(THUMBNAILS_DIRECTORY, record.thumbnailPath);
      if (fs.existsSync(full)) {
        await fs.promises.unlink(full).catch(() => {});
        log('INFO', 'SCAN', `Deleted orphan thumbnail: ${record.thumbnailPath}`);
      }
    }

    // Clean up guided view sidecar if it exists
    const gvCandidates = [
      record?.guidedViewPath,
      record?.id ? path.join(GUIDED_VIEW_DIR, `${record.id}.json`) : null
    ].filter(Boolean);

    for (const gv of gvCandidates) {
      const fullGv = path.isAbsolute(gv) ? gv : path.resolve(ROOT_DIR, gv);
      if (fs.existsSync(fullGv)) {
        await fs.promises.unlink(fullGv).catch(() => {});
        log('INFO', 'SCAN', `Deleted orphan guided view sidecar: ${path.basename(fullGv)}`);
      }
    }
  }
}

/**
 * Repairs comics in the database that lack a thumbnail or whose thumbnail file was lost.
 *
 * @returns {Promise<{ thumbOk: number, thumbFail: number }>}
 */
async function repairMissingThumbnails() {
  let thumbOk = 0;
  let thumbFail = 0;

  try {
    const missingThumbs = await dbAll(
      "SELECT id, path, thumbnailPath FROM comics WHERE thumbnailPath IS NULL OR thumbnailPath = ''"
    );

    const thumbsToUpdate = [];
    for (const item of missingThumbs) {
      if (fs.existsSync(item.path)) {
        const gen = await generateThumbnail(item.path);
        if (gen) {
          thumbsToUpdate.push({ id: item.id, gen, path: item.path });
        } else {
          thumbFail++;
        }
      }
    }

    if (thumbsToUpdate.length > 0) {
      await dbRun('BEGIN TRANSACTION');
      for (const u of thumbsToUpdate) {
        await dbRun("UPDATE comics SET thumbnailPath = ? WHERE id = ?", [u.gen, u.id]);
      }
      await dbRun('COMMIT');

      for (const u of thumbsToUpdate) {
        thumbOk++;
        log('INFO', 'THUMBNAIL', `Restored missing thumbnail for: ${path.basename(u.path)}`);
      }
    }
  } catch (repairErr) {
    log('ERROR', 'SCAN', `Error repairing missing thumbnails: ${repairErr.message}`);
  }

  return { thumbOk, thumbFail };
}

module.exports = {
  cleanupStaleComics,
  repairMissingThumbnails
};
