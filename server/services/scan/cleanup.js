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
const { SUPPORTED_COMIC_EXTENSIONS } = require('../comic-formats');

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

    // Clean up adjacent ComicInfo.xml sidecar if present, guarded by reachable storage and companion formats
    const parentDir = path.dirname(p);
    if (fs.existsSync(parentDir)) {
      const ext = path.extname(p);
      const sidecarPath = path.join(parentDir, path.basename(p, ext) + '.ComicInfo.xml');
      if (fs.existsSync(sidecarPath)) {
        const stem = path.join(parentDir, path.basename(p, ext));
        const formats = SUPPORTED_COMIC_EXTENSIONS || ['.cbz', '.cbr', '.pdf', '.epub'];
        const hasCompanion = formats.some(fExt => fs.existsSync(stem + fExt));

        if (!hasCompanion) {
          await fs.promises.unlink(sidecarPath).catch(() => {});
          log('INFO', 'SCAN', `Deleted orphan ComicInfo.xml sidecar: ${path.basename(sidecarPath)}`);
        } else {
          log('INFO', 'SCAN', `Preserving ComicInfo.xml sidecar for companion format: ${path.basename(sidecarPath)}`);
        }
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
    const candidateThumbs = await dbAll(
      "SELECT id, path, thumbnailPath FROM comics"
    );

    const thumbsToUpdate = [];
    for (const item of candidateThumbs) {
      if (!fs.existsSync(item.path)) continue;

      let needsRepair = false;
      if (!item.thumbnailPath) {
        needsRepair = true;
      } else {
        const full = path.join(THUMBNAILS_DIRECTORY, item.thumbnailPath);
        if (!fs.existsSync(full)) {
          needsRepair = true;
        } else {
          try {
            const st = fs.statSync(full);
            if (st.size === 0) needsRepair = true;
          } catch (_) {
            needsRepair = true;
          }
        }
      }

      if (needsRepair) {
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
