const fs = require('fs');
const path = require('path');
const db = require('../../db');
const config = require('../../config');
const metadata = require('../metadata');
const { log } = require('../../logger');
const { buildTaggedDbMeta } = require('./persist');

const CBR_LOOKUP_SQL =
  "SELECT id, path FROM comics WHERE originalPath = ? COLLATE NOCASE AND LOWER(path) LIKE '%.cbz' ORDER BY id ASC LIMIT 1";
const CBZ_ORIGINAL_LOOKUP_SQL =
  "SELECT id, path FROM comics WHERE path = ? COLLATE NOCASE AND LOWER(path) LIKE '%.cbr' ORDER BY id ASC LIMIT 1";

function isUsableMetadata(info) {
  return Boolean(info && (info.Series || info.Title));
}

function isCompleteInfo(info) {
  const hasSeries = Boolean((info.Series || info.Title || '').toString().trim());
  const hasPublisher = Boolean((info.Publisher || '').toString().trim());
  const hasDate = Boolean((info.Year || info.CoverDate || info['Cover Date'] || '').toString().trim());
  const hasNumber = Boolean((info.Number || info.Volume || '').toString().trim());
  return hasSeries && hasPublisher && hasDate && hasNumber;
}

function sidecarPathFor(comicPath) {
  const ext = path.extname(comicPath);
  return path.join(path.dirname(comicPath), path.basename(comicPath, ext) + '.ComicInfo.xml');
}

async function findCompanion(primary) {
  const primaryExt = path.extname(primary.path || '').toLowerCase();

  if (primaryExt === '.cbr') {
    const rows = await db.dbAll(CBR_LOOKUP_SQL, [primary.path]);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  if (primaryExt === '.cbz' && primary.originalPath) {
    const rows = await db.dbAll(CBZ_ORIGINAL_LOOKUP_SQL, [primary.originalPath]);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  return null;
}

async function writeCompanionFile(companionPath, info) {
  const storage = config.getMetadataStorage();
  if (storage === 'db') return;

  const metadataXml = metadata.buildComicInfoXml(info);
  if (!metadataXml) return;

  const companionExt = path.extname(companionPath).toLowerCase();
  // RAR archives are read-only in place — the companion CBR always gets a sidecar.
  if (companionExt === '.cbr' || storage === 'sidecar') {
    await fs.promises.writeFile(sidecarPathFor(companionPath), metadataXml, 'utf-8');
    return;
  }

  await metadata.writeComicInfoToCbz(companionPath, metadataXml);
}

async function updateCompanionRow(companion, info) {
  const publisher = metadata.normalizePublisher(info.Publisher || 'Unknown Publisher');
  const series = info.Series || info.Title || 'Unknown Series';
  const dbMeta = buildTaggedDbMeta(info, {
    title: info.Title || '',
    series,
    number: info.Number || info.Volume || '',
    volume: info.Volume || '',
    publisher
  });
  const stats = await fs.promises.stat(companion.path).catch(() => ({ mtimeMs: Date.now() }));

  await db.dbRun(
    `UPDATE comics SET tagStatus = ?, publisher = ?, series = ?, metadata = ?, updatedAt = ? WHERE id = ?`,
    [isCompleteInfo(info) ? 'successful' : 'failed', publisher, series, JSON.stringify(dbMeta), stats.mtimeMs, companion.id]
  );
}

/**
 * Mirror a freshly tagged comic's metadata onto its linked converted companion.
 * The primary's tag must never fail because the companion could not be updated.
 *
 * @param {string} primaryComicId
 * @returns {Promise<{synced: boolean, companionId?: string, reason?: string, error?: string}>}
 */
async function syncCompanionTag(primaryComicId) {
  if (!primaryComicId) return { synced: false, reason: 'no_primary' };

  try {
    const primary = await db.dbGet('SELECT id, path, originalPath FROM comics WHERE id = ?', [primaryComicId]);
    if (!primary || !primary.path) return { synced: false, reason: 'no_primary' };

    const companion = await findCompanion(primary);
    if (!companion) return { synced: false, reason: 'no_companion' };

    const info = await metadata.getComicInfoFromArchive(primary.path);
    if (!isUsableMetadata(info)) return { synced: false, reason: 'no_metadata' };

    await writeCompanionFile(companion.path, info);
    await updateCompanionRow(companion, info);

    log('INFO', 'TAGGER', `✓ Mirrored metadata to companion: ${path.basename(companion.path)}`);
    return { synced: true, companionId: companion.id };
  } catch (err) {
    log('WARN', 'TAGGER', `Companion metadata sync failed for ${primaryComicId}: ${err.message}`);
    return { synced: false, reason: 'error', error: err.message };
  }
}

module.exports = {
  syncCompanionTag
};
