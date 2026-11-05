const fs = require('fs');
const path = require('path');

const ORIGINAL_EXTENSIONS = ['.cbr', '.pdf'];

/**
 * Builds a Map of resolved original path -> converted CBZ path.
 */
function buildOriginalLinkMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row || !row.path || !row.originalPath) continue;
    const key = path.resolve(row.originalPath);
    if (!map.has(key)) map.set(key, row.path);
  }
  return map;
}

/**
 * Returns the linked CBZ only when it still exists on disk, so a deleted
 * conversion allows the original to be converted again.
 */
function resolveLiveLinkedCbz(originalLinks, originalPath, exists = fs.existsSync) {
  if (!originalLinks || !originalPath) return null;
  const linked = originalLinks.get(path.resolve(originalPath));
  if (!linked) return null;
  try {
    return exists(linked) ? linked : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the originalPath value to store for a crawled comic.
 * New conversions record their source; normal rescans preserve an existing
 * link only while the original still exists.
 */
function resolveOriginalLink({ wasConverted, sourcePath, existingOriginalPath, exists = fs.existsSync }) {
  const candidate = wasConverted ? sourcePath : existingOriginalPath;
  if (!candidate) return null;
  try {
    return exists(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Finds a kept .cbr/.pdf with the same stem beside a converted CBZ.
 */
function findAdjacentOriginal(cbzPath, exists = fs.existsSync) {
  const ext = path.extname(cbzPath);
  const stem = cbzPath.slice(0, cbzPath.length - ext.length);
  for (const candidateExt of ORIGINAL_EXTENSIONS) {
    const candidate = `${stem}${candidateExt}`;
    try {
      if (exists(candidate)) return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Links pre-existing conversions whose original still sits next to the CBZ.
 * Only affects rows created before originalPath existed.
 */
async function backfillOriginalLinks({ all, run, existsSync = fs.existsSync } = {}) {
  const rows = await all(
    "SELECT id, path FROM comics WHERE convertedAt IS NOT NULL AND (originalPath IS NULL OR originalPath = '')"
  );
  let linked = 0;
  for (const row of rows || []) {
    const candidate = findAdjacentOriginal(row.path, existsSync);
    if (!candidate) continue;
    try {
      await run('UPDATE comics SET originalPath = ? WHERE id = ?', [candidate, row.id]);
      linked++;
    } catch {
      // Link backfill is best-effort; a failed row is retried on the next scan.
    }
  }
  return linked;
}

module.exports = {
  buildOriginalLinkMap,
  resolveLiveLinkedCbz,
  resolveOriginalLink,
  findAdjacentOriginal,
  backfillOriginalLinks
};
