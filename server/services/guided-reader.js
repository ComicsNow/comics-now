const { dbAll, dbGet, dbRun, getReadingPrefMaps, resolveReadingModes } = require('../db');
const { log, guidedLog } = require('../logger');
const { getComicsDirectories } = require('../config');
const panelDetector = require('./panel-detector');
const modalDetector = require('./modal-detector');

const SETTINGS_KEYS = {
  autoOnAdd: 'guided.autoOnAdd',
  scheduleEnabled: 'guided.scheduleEnabled',
  scheduleInterval: 'guided.scheduleInterval',
  scheduleUnit: 'guided.scheduleUnit',
  useModal: 'guided.useModal',
  modalTokenId: 'guided.modalTokenId',
  modalTokenSecret: 'guided.modalTokenSecret',
  modalEnvironment: 'guided.modalEnvironment',
  concurrency: 'guided.concurrency'
};

const state = {
  isRunning: false,
  isCancelled: false,   // cancel the whole batch: stop worker + clear queue
  cancelCurrent: false, // skip just the in-flight comic, then continue
  current: null,        // { id, name, index, total }
  activeComics: new Map(), // comicId -> { id, name, path, cancel, workerIndex }
  activeWorkers: [],
  spawnWorkers: null,
  queue: [],            // array of comic rows
  startedAt: null,
  lastFinishedAt: null,
  lastError: null,
  scheduleTimer: null
};

function getEffectiveConcurrency(settings) {
  if (!settings || !settings.useModal) return 1;
  const c = Number(settings.concurrency);
  return (c === 1) ? 1 : 2;
}

function setQueueForTest(items) {
  state.queue = Array.isArray(items) ? [...items] : [];
}

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
  const modalSecret = await getSetting(SETTINGS_KEYS.modalTokenSecret, '');
  return {
    autoOnAdd: !!(await getSetting(SETTINGS_KEYS.autoOnAdd, false)),
    scheduleEnabled: !!(await getSetting(SETTINGS_KEYS.scheduleEnabled, false)),
    scheduleInterval: Number(await getSetting(SETTINGS_KEYS.scheduleInterval, 24)) || 24,
    scheduleUnit: await getSetting(SETTINGS_KEYS.scheduleUnit, 'hours'),
    useModal: !!(await getSetting(SETTINGS_KEYS.useModal, false)),
    modalTokenId: (await getSetting(SETTINGS_KEYS.modalTokenId, '')) || '',
    hasModalSecret: !!modalSecret,
    modalEnvironment: (await getSetting(SETTINGS_KEYS.modalEnvironment, '')) || '',
    concurrency: Number(await getSetting(SETTINGS_KEYS.concurrency, 2)) || 2
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
  const active = Array.from(state.activeComics.values()).map(c => ({
    id: c.id,
    name: c.name,
    path: c.path,
    workerIndex: c.workerIndex
  }));
  return {
    isRunning: state.isRunning,
    current: state.current,
    active,
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

    if (scope && Array.isArray(scope.ids) && scope.ids.length) {
      sql += ` AND id IN (${scope.ids.map(() => '?').join(',')})`;
      params.push(...scope.ids);
    }

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

async function processComic(comic, options = {}) {
  const type = comic.type || 'western';
  guidedLog('INFO', `   model: ${type}`);
  const startedAt = Date.now();
  const settings = await getSettings();
  const isCancelledFn = typeof options.isCancelled === 'function'
    ? options.isCancelled
    : () => state.isCancelled || state.cancelCurrent;

  let result;
  let usedModal = false;

  if (settings.useModal) {
    try {
      guidedLog('INFO', `   [Modal] Attempting GPU detection via Modal...`);
      const secret = await getSetting(SETTINGS_KEYS.modalTokenSecret, '');
      if (typeof modalDetector.ensureEnvironmentReady === 'function') {
        await modalDetector.ensureEnvironmentReady({
          modalTokenId: settings.modalTokenId,
          modalTokenSecret: secret,
          modalEnvironment: settings.modalEnvironment
        }, guidedLog);
      }
      result = await modalDetector.processComic(comic.id, comic.path, type, {
        isCancelled: isCancelledFn,
        modalTokenId: settings.modalTokenId,
        modalTokenSecret: secret,
        modalEnvironment: settings.modalEnvironment
      });
      usedModal = true;
      guidedLog('INFO', `   ✓ Modal GPU detection succeeded`);
    } catch (modalErr) {
      if (isCancelledFn()) throw modalErr;
      guidedLog('WARN', `   ⚠ Modal GPU detection unavailable (${modalErr.message}). Falling back to local CPU processing...`);
      result = await panelDetector.processComic(comic.id, comic.path, type, {
        isCancelled: isCancelledFn
      });
    }
  } else {
    result = await panelDetector.processComic(comic.id, comic.path, type, {
      isCancelled: isCancelledFn
    });
  }

  const secs = Math.round((Date.now() - startedAt) / 1000);
  guidedLog('INFO', `   pages ${result.pagesProcessed}/${result.pageCount}` +
    (result.pageFailures ? ` (${result.pageFailures} failed)` : '') +
    ` · ${result.panels} panels · ${secs}s` + (usedModal ? ' (Modal GPU)' : ' (CPU)'));
  return result;
}

async function runWorker() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.isCancelled = false;
  state.startedAt = Date.now();
  state.lastError = null;

  try {
    const settings = await getSettings();
    const initialConcurrency = getEffectiveConcurrency(settings);
    guidedLog('INFO', `Worker started. Initial queue: ${state.queue.length} comics (concurrency: ${initialConcurrency})`);

    state.activeWorkers = [];

    async function workerTask(workerIndex) {
      while (!state.isCancelled) {
        const curSettings = await getSettings();
        const maxConcurrency = getEffectiveConcurrency(curSettings);
        if (workerIndex >= maxConcurrency) {
          guidedLog('INFO', `Worker slot ${workerIndex + 1} retired (concurrency adjusted to ${maxConcurrency})`);
          break;
        }

        if (state.queue.length === 0) {
          break;
        }

        const comic = state.queue.shift();
        if (!comic) break;

        const totalRemaining = state.queue.length;
        const activeItem = {
          id: comic.id,
          name: comic.name,
          path: comic.path,
          workerIndex,
          isCancelled: false
        };
        state.activeComics.set(comic.id, activeItem);

        state.current = {
          id: comic.id,
          name: comic.name,
          path: comic.path,
          index: 1,
          total: totalRemaining + state.activeComics.size
        };

        guidedLog('INFO', `Processing: ${comic.name} (${totalRemaining} remaining in queue)`);

        try {
          await dbRun(
            `UPDATE comics SET guidedViewStatus = 'processing', guidedViewError = NULL WHERE id = ?`,
            [comic.id]
          );
          const result = await processComic(comic, {
            isCancelled: () => state.isCancelled || state.cancelCurrent || activeItem.isCancelled
          });
          if (!result || (result.panels === 0 && (result.pageCount > 0 || result.pagesProcessed > 0))) {
            throw new Error('Detection completed with 0 panels');
          }
          await dbRun(
            `UPDATE comics SET guidedViewStatus = 'completed', guidedViewError = NULL, guidedViewPath = ? WHERE id = ?`,
            [result.outputPath || null, comic.id]
          );
          guidedLog('INFO', `   ✓ Completed (${result.panels} panels)`);
        } catch (err) {
          if (state.isCancelled || state.cancelCurrent || activeItem.isCancelled) {
            await dbRun(
              `UPDATE comics SET guidedViewStatus = 'pending', guidedViewError = NULL WHERE id = ?`,
              [comic.id]
            ).catch(() => {});
            guidedLog('WARN', `   ⦸ Cancelled: ${comic.name}`);
          } else {
            await dbRun(
              `UPDATE comics SET guidedViewStatus = 'failed', guidedViewError = ? WHERE id = ?`,
              [String(err.message || err).slice(0, 500), comic.id]
            );
            guidedLog('ERROR', `   ✗ Failed: ${err.message || err}`);
          }
        } finally {
          state.activeComics.delete(comic.id);
          if (state.activeComics.size === 0) {
            state.current = null;
          } else {
            const nextActive = state.activeComics.values().next().value;
            state.current = {
              id: nextActive.id,
              name: nextActive.name,
              path: nextActive.path,
              index: 1,
              total: state.queue.length + state.activeComics.size
            };
          }
        }
      }
    }

    state.spawnWorkers = function(targetConcurrency) {
      while (state.activeWorkers.length < targetConcurrency && state.queue.length > 0 && !state.isCancelled) {
        const slot = state.activeWorkers.length;
        const p = workerTask(slot).finally(() => {
          const idx = state.activeWorkers.indexOf(p);
          if (idx !== -1) state.activeWorkers.splice(idx, 1);
        });
        state.activeWorkers.push(p);
      }
    };

    state.spawnWorkers(initialConcurrency);

    while (state.activeWorkers.length > 0) {
      await Promise.all([...state.activeWorkers]);
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
    state.activeComics.clear();
    state.activeWorkers = [];
    state.spawnWorkers = null;
    state.lastFinishedAt = Date.now();
    await dbRun(
      "UPDATE comics SET guidedViewStatus = 'pending' WHERE guidedViewStatus = 'processing'"
    ).catch(() => {});
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
  } else if (typeof state.spawnWorkers === 'function') {
    const settings = await getSettings();
    state.spawnWorkers(getEffectiveConcurrency(settings));
  }
  return true;
}

// Eligible guidedViewStatus values for a scoped run.
//   incremental (default): only comics that still need detection.
//   force: also re-run comics already 'completed'.
function getScopeStatuses(force) {
  return force ? ['pending', 'failed', 'completed'] : ['pending', 'failed'];
}

// Scoped run — process comics matching {type, target}.
// Incremental by default (skips already-detected comics); pass { force: true }
// to re-run everything in scope, including completed comics.
async function startRunForScope(type, target, options = {}) {
  const validTypes = ['comic', 'series', 'publisher', 'library'];
  if (!validTypes.includes(type) || !target) {
    guidedLog('ERROR', `Invalid scope: type=${type} target=${target}`);
    return false;
  }

  const scope = { type, target, statuses: getScopeStatuses(!!options.force) };
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
  } else if (typeof state.spawnWorkers === 'function') {
    const settings = await getSettings();
    state.spawnWorkers(getEffectiveConcurrency(settings));
  }
  return true;
}

// Skip only the comic currently being processed; the worker then continues with
// the rest of the queue. Can optionally skip a specific comic by id.
function cancelCurrent(comicId = null) {
  if (!state.isRunning) return false;
  if (comicId) {
    const active = state.activeComics.get(comicId);
    if (active) {
      active.isCancelled = true;
      guidedLog('WARN', `Skipping current job: ${active.name}`);
      return true;
    }
    return false;
  }
  state.cancelCurrent = true;
  for (const active of state.activeComics.values()) {
    active.isCancelled = true;
  }
  const name = state.current ? state.current.name : 'active job(s)';
  guidedLog('WARN', `Skipping current job: ${name}`);
  return true;
}

// Cancel the entire batch: drop every queued job and stop the worker after the
// in-flight comics unwind.
function cancelAll() {
  const cleared = state.queue.length;
  state.queue = [];
  if (state.isRunning) {
    state.isCancelled = true;
    for (const active of state.activeComics.values()) {
      active.isCancelled = true;
    }
  }
  dbRun("UPDATE comics SET guidedViewStatus = 'pending' WHERE guidedViewStatus = 'processing'").catch(() => {});
  guidedLog('WARN', `Cancel-all requested: cleared ${cleared} queued job(s); stopping current item.`);
  return state.isRunning || cleared > 0;
}

// Backward-compatible alias — the original single "cancel" now cancels the batch.
function cancelRun() {
  return cancelAll();
}

// Called from library scan completion when settings.autoOnAdd is on. Only the
// comics newly inserted by that scan (newComicIds) are considered — never the
// existing pending backlog. Detection is incremental (pending/failed only).
async function onLibraryScanComplete(newComicIds = []) {
  const ids = Array.isArray(newComicIds) ? newComicIds.filter(Boolean) : [];
  if (ids.length === 0) return;
  const settings = await getSettings();
  if (!settings.autoOnAdd) return;

  const scope = { ids, statuses: getScopeStatuses(false) };
  const newItems = await buildQueue(scope);
  if (newItems.length === 0) return;

  const existingIds = new Set(state.queue.map(c => c.id));
  const filtered = newItems.filter(c => !existingIds.has(c.id));
  state.queue.push(...filtered);

  if (filtered.length > 0) {
    guidedLog('INFO', `Auto-trigger: ${filtered.length} newly-added comic(s) queued for guided detection.`);
  }
  if (!state.isRunning) {
    runWorker().catch(err => log('ERROR', 'GUIDED', `runWorker(auto) rejected: ${err.message}`));
  }
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
  if (state.isRunning && typeof state.spawnWorkers === 'function') {
    const settings = await getSettings();
    const targetConcurrency = getEffectiveConcurrency(settings);
    if (state.activeWorkers.length < targetConcurrency) {
      state.spawnWorkers(targetConcurrency);
    }
  }
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
  getScopeStatuses,
  buildQueue,
  cancelRun,
  cancelCurrent,
  cancelAll,
  getStatus,
  getSettings,
  processComic,
  onLibraryScanComplete,
  applySettingsChanged,
  SETTINGS_KEYS,
  modalDetector,
  getEffectiveConcurrency,
  setQueueForTest,
  runWorker
};
