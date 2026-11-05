const fs = require('fs');
const path = require('path');
const guidedReader = require('../guided-reader');
const { dbAll } = require('../../db');

async function moveFileWithExdevFallback(src, dest) {
  try {
    await fs.promises.rename(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(src, dest);
    await fs.promises.unlink(src);
  }
}

function sidecarPathFor(filePath) {
  return path.join(
    path.dirname(filePath),
    path.basename(filePath, path.extname(filePath)) + '.ComicInfo.xml'
  );
}

/**
 * Updates comic file, sidecar ComicInfo.xml, thumbnail, guided view sidecar, and DB references.
 *
 * `oldOriginalPath` / `newOriginalPath` control the kept source of a converted CBZ:
 * - omitted entirely: leave the original and its link untouched (rename)
 * - null: clear the link without moving anything (original already missing)
 * - string: move the original (basename preserved) and store the new link
 */
async function updateComicIdentity({
  dbRun,
  oldId,
  newId,
  oldPath,
  newPath,
  newName,
  thumbnailsDir,
  guidedViewDir,
  oldOriginalPath = null,
  newOriginalPath = undefined
}) {
  const existsAsync = async (p) => {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  };

  let originalMoved = false;
  let originalMissing = false;
  let originalLink = newOriginalPath;

  // 0. Move the kept original alongside the comic (never renamed)
  if (newOriginalPath === null) {
    originalLink = null;
  } else if (newOriginalPath !== undefined) {
    if (!oldOriginalPath || !(await existsAsync(oldOriginalPath))) {
      originalMissing = true;
      originalLink = null;
    } else if (path.resolve(oldOriginalPath) !== path.resolve(newOriginalPath)) {
      const originalDestDir = path.dirname(newOriginalPath);
      if (!(await existsAsync(originalDestDir))) {
        await fs.promises.mkdir(originalDestDir, { recursive: true });
      }
      if (await existsAsync(newOriginalPath)) {
        throw new Error(`Original file already exists at destination: ${newOriginalPath}`);
      }
      await moveFileWithExdevFallback(oldOriginalPath, newOriginalPath);
      originalMoved = true;

      const oldSidecar = sidecarPathFor(oldOriginalPath);
      const newSidecar = sidecarPathFor(newOriginalPath);
      if (await existsAsync(oldSidecar) && !(await existsAsync(newSidecar))) {
        try {
          await moveFileWithExdevFallback(oldSidecar, newSidecar);
        } catch (sidecarErr) {
          console.warn(`[ORGANIZATION] Failed to move original sidecar: ${sidecarErr.message}`);
        }
      }
    }
  }

  // 1. Move/Rename comic file if path changed
  if (oldPath !== newPath && await existsAsync(oldPath)) {
    const destDir = path.dirname(newPath);
    if (!(await existsAsync(destDir))) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }
    try {
      await moveFileWithExdevFallback(oldPath, newPath);
    } catch (renameErr) {
      if (originalMoved) {
        try {
          await moveFileWithExdevFallback(newOriginalPath, oldOriginalPath);
          originalMoved = false;
          const movedSidecar = sidecarPathFor(newOriginalPath);
          const restoredSidecar = sidecarPathFor(oldOriginalPath);
          if (await existsAsync(movedSidecar) && !(await existsAsync(restoredSidecar))) {
            await moveFileWithExdevFallback(movedSidecar, restoredSidecar);
          }
        } catch (rollbackErr) {
          console.warn(`[ORGANIZATION] Failed to roll back original move: ${rollbackErr.message}`);
        }
      }
      throw renameErr;
    }
  }

  // 2. Move/Rename adjacent .ComicInfo.xml sidecar
  const oldExt = path.extname(oldPath);
  const newExt = path.extname(newPath);
  const oldSidecar = path.join(path.dirname(oldPath), path.basename(oldPath, oldExt) + '.ComicInfo.xml');
  if (await existsAsync(oldSidecar)) {
    const newSidecar = path.join(path.dirname(newPath), path.basename(newPath, newExt) + '.ComicInfo.xml');
    try {
      await fs.promises.rename(oldSidecar, newSidecar);
    } catch (sErr) {
      if (sErr.code === 'EXDEV') {
        await fs.promises.copyFile(oldSidecar, newSidecar);
        await fs.promises.unlink(oldSidecar);
      } else {
        console.warn(`[ORGANIZATION] Failed to move sidecar: ${sErr.message}`);
      }
    }
  }

  // 3. Rename thumbnail in thumbnailsDir if old thumbnail exists
  if (thumbnailsDir && oldId !== newId) {
    const oldThumb = path.join(thumbnailsDir, `${oldId}.jpg`);
    const newThumb = path.join(thumbnailsDir, `${newId}.jpg`);
    if (await existsAsync(oldThumb)) {
      try {
        await fs.promises.rename(oldThumb, newThumb);
      } catch (tErr) {
        console.warn(`[ORGANIZATION] Failed to rename thumbnail: ${tErr.message}`);
      }
    }
  }

  // 4. Rename Guided View sidecar in guidedViewDir if it exists
  let newGvPath = undefined;
  let newGvStatus = undefined;
  if (guidedViewDir && oldId !== newId) {
    const oldGv = path.join(guidedViewDir, `${oldId}.json`);
    const newGv = path.join(guidedViewDir, `${newId}.json`);
    if (await existsAsync(oldGv)) {
      try {
        let sidecarData = null;
        try {
          const raw = await fs.promises.readFile(oldGv, 'utf8');
          sidecarData = JSON.parse(raw);
        } catch (_) {}

        if (sidecarData && typeof sidecarData === 'object' && sidecarData.pages) {
          sidecarData.comicId = newId;
          await fs.promises.writeFile(newGv, JSON.stringify(sidecarData, null, 2), 'utf8');
          if (oldGv !== newGv && await existsAsync(oldGv)) {
            try { await fs.promises.unlink(oldGv); } catch (_) {}
          }
          newGvPath = newGv;
          newGvStatus = 'completed';
        } else {
          if (await existsAsync(oldGv)) try { await fs.promises.unlink(oldGv); } catch (_) {}
          if (await existsAsync(newGv)) try { await fs.promises.unlink(newGv); } catch (_) {}
          newGvPath = null;
          newGvStatus = 'pending';
        }
      } catch (gErr) {
        console.warn(`[ORGANIZATION] Failed to migrate guided view sidecar: ${gErr.message}`);
        newGvPath = null;
        newGvStatus = 'pending';
      }
    } else if (await existsAsync(newGv)) {
      try {
        const raw = await fs.promises.readFile(newGv, 'utf8');
        const sidecarData = JSON.parse(raw);
        if (sidecarData && typeof sidecarData === 'object' && sidecarData.pages) {
          newGvPath = newGv;
          newGvStatus = 'completed';
        } else {
          try { await fs.promises.unlink(newGv); } catch (_) {}
          newGvPath = null;
          newGvStatus = 'pending';
        }
      } catch (_) {
        try { await fs.promises.unlink(newGv); } catch (_) {}
        newGvPath = null;
        newGvStatus = 'pending';
      }
    } else {
      newGvPath = null;
      newGvStatus = 'pending';
    }
  }

  // 5. Update Database Records
  if (typeof dbRun === 'function') {
    const newThumbFilename = `${newId}.jpg`;
    if (oldId !== newId) {
      if (guidedViewDir) {
        await dbRun(
          'UPDATE comics SET id = ?, path = ?, name = ?, thumbnailPath = ?, guidedViewPath = ?, guidedViewStatus = COALESCE(?, guidedViewStatus) WHERE id = ?',
          [newId, newPath, newName, newThumbFilename, newGvPath, newGvStatus, oldId]
        );
      } else {
        await dbRun(
          'UPDATE comics SET id = ?, path = ?, name = ?, thumbnailPath = ? WHERE id = ?',
          [newId, newPath, newName, newThumbFilename, oldId]
        );
      }
    } else {
      await dbRun(
        'UPDATE comics SET path = ?, name = ?, thumbnailPath = ? WHERE id = ?',
        [newPath, newName, newThumbFilename, oldId]
      );
    }

    if (newOriginalPath !== undefined) {
      await dbRun('UPDATE comics SET originalPath = ? WHERE id = ?', [originalLink, newId]);
    }

    if (newGvStatus === 'pending') {
      try {
        guidedReader.startRunForScope('comic', newId).catch(() => {
          guidedReader.onLibraryScanComplete([newId]).catch(() => {});
        });
      } catch (_) {}
    }

    let tables = new Set();
    try {
      const rows = await dbAll("SELECT name FROM sqlite_master WHERE type = 'table'");
      tables = new Set(rows.map(r => r.name));
    } catch (_) {}
    const updateIfTable = async (table, sql, params) => {
      if (!tables.has(table)) return;
      try { await dbRun(sql, params); } catch (_) {}
    };

    await updateIfTable('progress', 'UPDATE progress SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    await updateIfTable('device_progress', 'UPDATE device_progress SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    await updateIfTable('reading_list_items', 'UPDATE reading_list_items SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    await updateIfTable('user_comic_status', 'UPDATE user_comic_status SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    await updateIfTable('user_bookmarks', 'UPDATE user_bookmarks SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    await updateIfTable('reading_mode_preferences', 'UPDATE reading_mode_preferences SET targetId = ? WHERE targetId = ? AND preferenceType = ?', [newId, oldId, 'comic']);
  }

  return { originalMoved, originalMissing };
}

module.exports = {
  updateComicIdentity
};
