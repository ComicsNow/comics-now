const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PAGE_CACHE_DIRECTORY, DEFAULT_MAX_PAGE_CACHE_MB } = require('../constants');
const { getConfig } = require('../config');
const { log } = require('../logger');

let cacheDir = PAGE_CACHE_DIRECTORY;
let isPruning = false;

function setCustomCacheDir(dir) {
  cacheDir = dir;
}

function getCacheDir() {
  return cacheDir;
}

function getMaxCacheBytes() {
  try {
    const config = getConfig ? getConfig() : null;
    const maxMb = (config && typeof config.pageCacheMaxMb === 'number' && config.pageCacheMaxMb > 0)
      ? config.pageCacheMaxMb
      : DEFAULT_MAX_PAGE_CACHE_MB;
    return maxMb * 1024 * 1024;
  } catch {
    return DEFAULT_MAX_PAGE_CACHE_MB * 1024 * 1024;
  }
}

function getPageCacheKey(filePath, mtimeMs, entryName, width = null) {
  const normPath = path.resolve(filePath);
  const rawKey = `${normPath}:${mtimeMs}:${entryName}:${width || 'orig'}`;
  const hash = crypto.createHash('sha1').update(rawKey).digest('hex');
  if (width) {
    return `${hash}_w${width}.webp`;
  }
  return `${hash}.bin`;
}

function getPageCachePath(key) {
  return path.join(cacheDir, key);
}

async function hasPageCache(key) {
  try {
    const p = getPageCachePath(key);
    await fs.promises.access(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function getPageCacheBuffer(key) {
  try {
    const p = getPageCachePath(key);
    const buf = await fs.promises.readFile(p);
    // Touch access time asynchronously so the LRU prune keeps hot pages.
    const now = new Date();
    fs.utimes(p, now, now, () => {});
    return buf;
  } catch {
    return null;
  }
}

async function setPageCacheBuffer(key, buffer) {
  if (!buffer || buffer.length === 0) return;
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const targetPath = getPageCachePath(key);
    // Atomic write: temp file + rename so a crash can never leave a partial entry.
    const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    await fs.promises.writeFile(tempPath, buffer);
    await fs.promises.rename(tempPath, targetPath);
    schedulePruneIfNeeded();
  } catch (err) {
    log('WARN', 'PAGE-CACHE', `Failed to write cache entry ${key}: ${err.message}`);
  }
}

let pruneTimeout = null;
function schedulePruneIfNeeded() {
  if (pruneTimeout || isPruning) return;
  pruneTimeout = setTimeout(async () => {
    pruneTimeout = null;
    await pruneCacheIfNeeded().catch(() => {});
  }, 1000);
  if (pruneTimeout.unref) pruneTimeout.unref();
}

async function pruneCacheIfNeeded(overrideMaxBytes = null) {
  if (isPruning) return;
  isPruning = true;
  try {
    if (!fs.existsSync(cacheDir)) return;
    const maxBytes = overrideMaxBytes || getMaxCacheBytes();
    const targetBytes = Math.floor(maxBytes * 0.85); // Prune down to 85% when the cap is breached.

    const entries = await fs.promises.readdir(cacheDir, { withFileTypes: true });
    let totalBytes = 0;
    const files = [];

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith('.tmp')) continue;
      const fullPath = path.join(cacheDir, entry.name);
      try {
        const stat = await fs.promises.stat(fullPath);
        totalBytes += stat.size;
        files.push({
          path: fullPath,
          size: stat.size,
          time: Math.max(stat.atimeMs || 0, stat.mtimeMs || 0)
        });
      } catch {}
    }

    if (totalBytes <= maxBytes) {
      return;
    }

    log('INFO', 'PAGE-CACHE', `Pruning cache: current ${(totalBytes / (1024 * 1024)).toFixed(1)}MB exceeds ${(maxBytes / (1024 * 1024)).toFixed(1)}MB cap`);

    // Oldest accessed/modified first.
    files.sort((a, b) => a.time - b.time);

    let bytesFreed = 0;
    for (const f of files) {
      if (totalBytes - bytesFreed <= targetBytes) break;
      try {
        await fs.promises.unlink(f.path);
        bytesFreed += f.size;
      } catch {}
    }

    log('INFO', 'PAGE-CACHE', `Pruning complete: freed ${(bytesFreed / (1024 * 1024)).toFixed(1)}MB, remaining ${((totalBytes - bytesFreed) / (1024 * 1024)).toFixed(1)}MB`);
  } catch (err) {
    log('ERROR', 'PAGE-CACHE', `Prune failed: ${err.message}`);
  } finally {
    isPruning = false;
  }
}

async function initPageCache() {
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    await pruneCacheIfNeeded();
  } catch (err) {
    log('WARN', 'PAGE-CACHE', `Init failed: ${err.message}`);
  }
}

module.exports = {
  getCacheDir,
  setCustomCacheDir,
  getMaxCacheBytes,
  getPageCacheKey,
  getPageCachePath,
  hasPageCache,
  getPageCacheBuffer,
  setPageCacheBuffer,
  pruneCacheIfNeeded,
  initPageCache
};
