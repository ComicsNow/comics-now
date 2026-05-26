// Guided Reader: panel-detection orchestrator.
//
// Phase 1: queue + hierarchical traversal + scheduling + live SSE log.
// Phase 2 will swap `processComic` for the real ONNX panel detector.

const { dbAll, dbGet, dbRun, getReadingPrefMaps, resolveReadingModes } = require('../db');
const { log, guidedLog } = require('../logger');
const { getComicsDirectories } = require('../config');
const panelDetector = require('./panel-detector');

const SETTINGS_KEYS = {
  autoOnAdd: 'guided.autoOnAdd',
  scheduleEnabled: 'guided.scheduleEnabled',
  scheduleInterval: 'guided.scheduleInterval',
  scheduleUnit: 'guided.scheduleUnit'
};

const state = {
  isRunning: false,
  isCancelled: false,
  current: null,        // { id, name, index, total }
  queue: [],            // array of comic rows
  startedAt: null,
  lastFinishedAt: null,
  lastError: null,
  scheduleTimer: null
};

async function getSetting(key, fallback) {
  try {
    const row = await dbGet('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  } catch {
    return fallback;
  }
}

async function getSettings() {
  return {
    autoOnAdd: !!(await getSetting(SETTINGS_KEYS.autoOnAdd, false)),
    scheduleEnabled: !!(await getSetting(SETTINGS_KEYS.scheduleEnabled, false)),
    scheduleInterval: Number(await getSetting(SETTINGS_KEYS.scheduleInterval, 24)) || 24,
    scheduleUnit: await getSetting(SETTINGS_KEYS.scheduleUnit, 'hours')
  };
}

async function getStatusCounts() {
  const rows = await dbAll(
    `SELECT COALESCE(guidedViewStatus, 'pending') AS s, COUNT(*) AS c
     FROM comics GROUP BY s`
  );
  const counts = { pending: 0, processing: 0, completed: 0, failed: 0, skipped: 0 };
  for (const r of rows) counts[r.s] = (counts[r.s] || 0) + r.c;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { ...counts, total };
}

async function getStatus() {
  const settings = await getSettings();
  const counts = await getStatusCounts();
  return {
    isRunning: state.isRunning,
    current: state.current,
    queueLength: state.queue.length,
    startedAt: state.startedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError,
    counts,
    settings,
    nextScheduledAt: state.scheduleTimer ? state.scheduleTimer._nextAt || null : null
  };
}

// Walk Library → Publisher → Series → Issue, returning all comics.
// \`scope\` is null for full-library, or { type, target, statuses? } to restrict.
//   type: 'comic' | 'series' | 'publisher' | 'library'
//   target: comic id | series name | publisher name | root dir
//   statuses: optional override for guidedViewStatus values to include
async function buildQueue(scope = null) {
  const roots = getComicsDirectories();
  const readingMaps = await getReadingPrefMaps();
  const queue = [];
  const statuses = (scope && Array.isArray(scope.statuses) && scope.statuses.length)
    ? scope.statuses
    : ['pending', 'failed'];
  const statusPlaceholders = statuses.map(() => '?').join(',');

  // For 'library' scope, restrict to that one root; otherwise iterate all roots.
  const targetRoots = (scope && scope.type === 'library')
    ? roots.filter(r => r === scope.target)
    : roots;

  for (const root of targetRoots) {
    // SQLite LIKE: escape % and _ in root path
    const rootPrefix = root.endsWith('/') ? root : root + '/';
    const likePattern = rootPrefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';

    let sql = `SELECT id, publisher, series, name, path,
                      COALESCE(guidedViewStatus, 'pending') AS guidedViewStatus
               FROM comics
               WHERE path LIKE ? ESCAPE '\\'
                 AND COALESCE(guidedViewStatus, 'pending') IN (${statusPlaceholders})`;
    const params = [likePattern, ...statuses];

    if (scope && scope.type === 'comic') {
      sql += ' AND id = ?';
      params.push(scope.target);
    } else if (scope && scope.type === 'series') {
      sql += ' AND series = ?';
      params.push(scope.target);
    } else if (scope && scope.type === 'publisher') {
      sql += ' AND publisher = ?';
      params.push(scope.target);
    }

    sql += ` ORDER BY
               COALESCE(publisher, 'zzz_unknown') COLLATE NOCASE,
               COALESCE(series, 'zzz_unknown') COLLATE NOCASE,
               COALESCE(name, '') COLLATE NOCASE`;

    const rows = await dbAll(sql, params);
    for (const r of rows) {
      const { mangaMode } = resolveReadingModes(r.id, r.series, r.publisher, r.path, readingMaps, roots);
      const type = mangaMode ? 'manga' : 'western';
      queue.push({ ...r, _root: root, type });
    }
  }
  return queue;
}

async function processComic(comic) {
  const type = comic.type || 'western';
  guidedLog('INFO', `   model: ${type}`);
  const startedAt = Date.now();
  const result = await panelDetector.processComic(comic.id, comic.path, type, {
    isCancelled: () => state.isCancelled
  });
  const secs = Math.round((Date.now() - startedAt) / 1000);
  guidedLog('INFO', `   pages ${result.pagesProcessed}/${result.pageCount}` +
    (result.pageFailures ? ` (${result.pageFailures} failed)` : '') +
    ` · ${result.panels} panels · ${secs}s`);
  return result;
}

async function runWorker() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.isCancelled = false;
  state.startedAt = Date.now();
  state.lastError = null;

  try {
    guidedLog('INFO', `Worker started. Initial queue: ${state.queue.length} comics`);

    while (state.queue.length > 0 && !state.isCancelled) {
      const comic = state.queue[0]; // Peek at first item
      const total = state.queue.length;
      
      state.current = { 
        id: comic.id, 
        name: comic.name, 
        path: comic.path, 
        index: 1, 
        total: total 
      };
      
      guidedLog('INFO', `Processing: ${comic.name} (${total} remaining in queue)`);

      try {
        await dbRun(
          `UPDATE comics SET guidedViewStatus = 'processing', guidedViewError = NULL WHERE id = ?`,
          [comic.id]
        );
        const result = await processComic(comic);
        await dbRun(
          `UPDATE comics SET guidedViewStatus = 'completed', guidedViewError = NULL, guidedViewPath = ? WHERE id = ?`,
          [result.outputPath || null, comic.id]
        );
        guidedLog('INFO', `   ✓ Completed (${result.panels} panels)`);
      } catch (err) {
        await dbRun(
          `UPDATE comics SET guidedViewStatus = 'failed', guidedViewError = ? WHERE id = ?`,
          [String(err.message || err).slice(0, 500), comic.id]
        );
        guidedLog('ERROR', `   ✗ Failed: ${err.message || err}`);
      }

      state.queue.shift(); // Remove processed item
    }
    
    if (state.isCancelled) {
      guidedLog('WARN', `Worker stopped due to cancellation. ${state.queue.length} items remain in queue.`);
    }

  } catch (err) {
    state.lastError = err.message || String(err);
    log('ERROR', 'GUIDED', `Worker crashed: ${state.lastError}`);
    guidedLog('ERROR', `Worker crashed: ${state.lastError}`);
  } finally {
    state.isRunning = false;
    state.current = null;
    state.lastFinishedAt = Date.now();
    guidedLog('INFO', `Worker finished. Run duration: ${Math.round((state.lastFinishedAt - state.startedAt) / 1000)}s`);
  }
}

async function startRun() {
  const newItems = await buildQueue();
  // Filter out items already in queue
  const existingIds = new Set(state.queue.map(c => c.id));
  const filtered = newItems.filter(c => !existingIds.has(c.id));
  state.queue.push(...filtered);
  
  if (filtered.length > 0) {
    guidedLog('INFO', `Added ${filtered.length} comics to queue. Total queue: ${state.queue.length}`);
  }

  if (!state.isRunning) {
    runWorker().catch(err => log('ERROR', 'GUIDED', `runWorker rejected: ${err.message}`));
  }
  return true;
}

// Scoped run — process only comics matching {type, target}.
// For scoped runs we also include 'completed' in the eligible statuses so that
// "Run again" on a single comic / series / publisher / library works as expected.
async function startRunForScope(type, target) {
  const validTypes = ['comic', 'series', 'publisher', 'library'];
  if (!validTypes.includes(type) || !target) {
    guidedLog('ERROR', `Invalid scope: type=${type} target=${target}`);
    return false;
  }
  
  const scope = { type, target, statuses: ['pending', 'failed', 'completed'] };
  const newItems = await buildQueue(scope);
  
  // Filter out items already in queue
  const existingIds = new Set(state.queue.map(c => c.id));
  const filtered = newItems.filter(c => !existingIds.has(c.id));
  state.queue.push(...filtered);

  if (filtered.length > 0) {
    guidedLog('INFO', `Added ${filtered.length} comics (scoped: ${type}) to queue. Total queue: ${state.queue.length}`);
  }

  if (!state.isRunning) {
    runWorker().catch(err => log('ERROR', 'GUIDED', `runWorker(scope) rejected: ${err.message}`));
  }
  return true;
}

function cancelRun() {
  if (!state.isRunning) return false;
  state.isCancelled = true;
  guidedLog('WARN', 'Cancellation requested; finishing current item then stopping');
  return true;
}

// Called from library scan completion when settings.autoOnAdd is on.
async function onLibraryScanComplete() {
  const settings = await getSettings();
  if (!settings.autoOnAdd) return;
  const counts = await getStatusCounts();
  const work = (counts.pending || 0) + (counts.failed || 0);
  if (work === 0) return;
  if (state.isRunning) {
    guidedLog('INFO', `Auto-trigger: ${work} pending, but a run is already in progress`);
    return;
  }
  guidedLog('INFO', `Auto-trigger: scan completed, ${work} pending — starting run`);
  startRun();
}

function intervalToMs(interval, unit) {
  const n = Math.max(1, Number(interval) || 1);
  if (unit === 'days') return n * 24 * 60 * 60 * 1000;
  return n * 60 * 60 * 1000; // hours
}

async function scheduleNextRun() {
  if (state.scheduleTimer) {
    clearTimeout(state.scheduleTimer);
    state.scheduleTimer = null;
  }
  const settings = await getSettings();
  if (!settings.scheduleEnabled) return;

  const ms = intervalToMs(settings.scheduleInterval, settings.scheduleUnit);
  const nextAt = Date.now() + ms;
  state.scheduleTimer = setTimeout(async () => {
    state.scheduleTimer = null;
    guidedLog('INFO', `Scheduled run firing (every ${settings.scheduleInterval} ${settings.scheduleUnit})`);
    startRun();
    // Reschedule after firing — interval is "between starts".
    scheduleNextRun().catch(() => {});
  }, ms);
  state.scheduleTimer._nextAt = nextAt;
  log('INFO', 'GUIDED', `Next scheduled run in ${Math.round(ms / 60000)} min`);
}

async function applySettingsChanged() {
  await scheduleNextRun();
}

async function initialize() {
  try {
    const { changes } = await dbRun(
      "UPDATE comics SET guidedViewStatus = 'pending' WHERE guidedViewStatus = 'processing'"
    );
    if (changes > 0) {
      log('INFO', 'GUIDED', `Cleared ${changes} stuck processing tasks`);
    }
  } catch (err) {
    log('ERROR', 'GUIDED', `Failed to clear stuck tasks: ${err.message}`);
  }
  
  await scheduleNextRun();
  log('INFO', 'GUIDED', 'Guided reader service initialized');
}

module.exports = {
  initialize,
  startRun,
  startRunForScope,
  cancelRun,
  getStatus,
  getSettings,
  onLibraryScanComplete,
  applySettingsChanged,
  SETTINGS_KEYS
};
