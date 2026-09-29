/**
 * Pure logic for the downloads modal's three tabs and the 24-hour history window.
 *
 * Kept dependency-free (no DOM, no IndexedDB) so it is trivially unit-testable and
 * reusable by both the page and the service worker.
 *
 * Queue/history item shape:
 *   { id, status: 'pending'|'downloading'|'paused'|'completed'|'error',
 *     addedAt, completedAt?, failedAt?, receivedBytes?, totalBytes?, retryCount? }
 */

const DOWNLOAD_TTL_MS = 24 * 60 * 60 * 1000; // Downloaded/Failed drop off the list after 24h.
const IN_PROGRESS_STATUSES = ['pending', 'downloading', 'paused'];
const MAX_BACKOFF_MS = 30_000;

function isInProgress(item) {
  return IN_PROGRESS_STATUSES.includes(item.status);
}

function withinTtl(timestamp, now) {
  return typeof timestamp === 'number' && (now - timestamp) < DOWNLOAD_TTL_MS;
}

/**
 * Split items into the three tab buckets.
 * - inProgress: pending/downloading/paused (kept until completed or cancelled)
 * - downloaded: completed within the last 24h (most recent first)
 * - failed:     errored within the last 24h (most recent first)
 */
function partitionDownloads(items = [], now = Date.now()) {
  const inProgress = [];
  const downloaded = [];
  const failed = [];

  for (const item of items) {
    if (!item) continue;
    if (isInProgress(item)) {
      inProgress.push(item);
    } else if (item.status === 'completed' && withinTtl(item.completedAt, now)) {
      downloaded.push(item);
    } else if (item.status === 'error' && withinTtl(item.failedAt, now)) {
      failed.push(item);
    }
  }

  downloaded.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  failed.sort((a, b) => (b.failedAt || 0) - (a.failedAt || 0));

  return { inProgress, downloaded, failed };
}

/**
 * Items that should be pruned from storage: terminal (completed/error) and older
 * than the TTL. In-progress items are never expired.
 */
function selectExpired(items = [], now = Date.now()) {
  return items.filter((item) => {
    if (!item || isInProgress(item)) return false;
    if (item.status === 'completed') return !withinTtl(item.completedAt, now);
    if (item.status === 'error') return !withinTtl(item.failedAt, now);
    return false;
  });
}

/** Exponential backoff (1s, 2s, 4s, 8s, …) capped at 30s. */
function computeBackoffMs(retryCount = 0) {
  const n = Math.max(0, Math.floor(retryCount));
  return Math.min(1000 * Math.pow(2, n), MAX_BACKOFF_MS);
}

/** Range header to resume a partial download, or null to start fresh. */
function nextRangeHeader(receivedBytes) {
  if (typeof receivedBytes !== 'number' || !Number.isFinite(receivedBytes) || receivedBytes <= 0) {
    return null;
  }
  return `bytes=${Math.floor(receivedBytes)}-`;
}

// CommonJS module — consumed by the app via `import * as DownloadHistory from
// './download-history.js'` (Vite resolves the namespace) and by Jest via require().
module.exports = {
  DOWNLOAD_TTL_MS,
  IN_PROGRESS_STATUSES,
  isInProgress,
  partitionDownloads,
  selectExpired,
  computeBackoffMs,
  nextRangeHeader
};
