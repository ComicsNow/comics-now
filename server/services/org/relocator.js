const fs = require('fs');
const path = require('path');
const guidedReader = require('../guided-reader');
const { dbAll } = require('../../db');

/**
 * Updates comic file, sidecar ComicInfo.xml, thumbnail, guided view sidecar, and DB references.
 */
async function updateComicIdentity({
  dbRun,
  oldId,
  newId,
  oldPath,
  newPath,
  newName,
  thumbnailsDir,
  guidedViewDir
}) {
  const existsAsync = async (p) => {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Move/Rename comic file if path changed
  if (oldPath !== newPath && await existsAsync(oldPath)) {
    const destDir = path.dirname(newPath);
    if (!(await existsAsync(destDir))) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }
    try {
      await fs.promises.rename(oldPath, newPath);
    } catch (renameErr) {
      if (renameErr.code === 'EXDEV') {
        await fs.promises.copyFile(oldPath, newPath);
        await fs.promises.unlink(oldPath);
      } else {
        throw renameErr;
      }
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
}

module.exports = {
  updateComicIdentity
};
