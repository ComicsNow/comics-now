const fs = require('fs');
const path = require('path');
const { log } = require('../../logger');
const { GUIDED_VIEW_DIR } = require('../../constants');
const {
  isUsableGuidedSidecarData,
  readGuidedSidecar,
  hasUsableGuidedSidecar
} = require('../guided/sidecar');

async function migrateMovedSidecar(id, baseName, sidecarPath, dbComicsMap) {
  for (const [oldPath, oldRec] of dbComicsMap.entries()) {
    if (oldRec.id === id) continue;
    if (path.basename(oldPath) !== baseName) continue;
    if (fs.existsSync(oldPath)) continue;

    const oldSidecar = path.join(path.dirname(sidecarPath), `${oldRec.id}.json`);
    if (!fs.existsSync(oldSidecar)) continue;

    const data = await readGuidedSidecar(oldSidecar);
    if (!isUsableGuidedSidecarData(data)) continue;

    data.comicId = id;
    await fs.promises.writeFile(sidecarPath, JSON.stringify(data, null, 2), 'utf8');
    if (oldSidecar !== sidecarPath) {
      try { await fs.promises.unlink(oldSidecar); } catch (_) {}
    }
    return true;
  }
  return false;
}

/**
 * Reconciles guided-view status and sidecar paths for a comic archive.
 *
 * Only sidecars with at least one detected panel may promote a comic to
 * `completed`; empty or corrupt sidecars leave the existing status intact so
 * failed detections stay eligible for retry.
 */
async function reconcileGuidedView(id, filePath, existing, dbComicsMap, options = {}) {
  const guidedViewDir = options.guidedViewDir || GUIDED_VIEW_DIR;
  let guidedViewStatus = existing?.guidedViewStatus || 'pending';
  let guidedViewPath = existing?.guidedViewPath || null;
  let guidedViewError = existing?.guidedViewError || null;
  const sidecarPath = path.join(guidedViewDir, `${id}.json`);

  if (guidedViewStatus === 'processing') {
    return { guidedViewStatus, guidedViewPath, guidedViewError };
  }

  if (guidedViewStatus === 'completed') {
    if (!fs.existsSync(sidecarPath)) {
      guidedViewStatus = 'pending';
      guidedViewPath = null;
    }
    return { guidedViewStatus, guidedViewPath, guidedViewError };
  }

  if (fs.existsSync(sidecarPath)) {
    if (await hasUsableGuidedSidecar(sidecarPath)) {
      guidedViewStatus = 'completed';
      guidedViewPath = sidecarPath;
      guidedViewError = null;
      log('INFO', 'SCAN', `Reconnected guided-view sidecar: ${path.basename(filePath)}`);
    }
    return { guidedViewStatus, guidedViewPath, guidedViewError };
  }

  const migrated = await migrateMovedSidecar(id, path.basename(filePath), sidecarPath, dbComicsMap);
  if (migrated) {
    guidedViewStatus = 'completed';
    guidedViewPath = sidecarPath;
    guidedViewError = null;
    log('INFO', 'SCAN', `Migrated moved comic guided-view sidecar: ${path.basename(filePath)}`);
  }

  return { guidedViewStatus, guidedViewPath, guidedViewError };
}

module.exports = { reconcileGuidedView };
