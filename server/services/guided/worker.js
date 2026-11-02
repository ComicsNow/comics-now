const { dbRun } = require('../../db');
const { log, guidedLog } = require('../../logger');
const { state } = require('./state');
const { getSettings, intervalToMs } = require('./settings');
const { getEffectiveConcurrency, processComic } = require('./processor');
const { buildQueue, getScopeStatuses } = require('./queue');

function setQueueForTest(items) {
  state.queue = Array.isArray(items) ? [...items] : [];
}

async function runWorker() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.isCancelled = false;
  state.cancelCurrent = false;
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
            isCancelled: () => state.isCancelled || activeItem.isCancelled
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
          if (state.isCancelled || activeItem.isCancelled) {
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
            state.cancelCurrent = false;
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
    state.isCancelled = false;
    state.cancelCurrent = false;
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
  state.isCancelled = false;
  state.cancelCurrent = false;
  const newItems = await buildQueue();
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

async function startRunForScope(type, target, options = {}) {
  const validTypes = ['comic', 'series', 'publisher', 'library'];
  if (!validTypes.includes(type) || !target) {
    guidedLog('ERROR', `Invalid scope: type=${type} target=${target}`);
    return false;
  }

  state.isCancelled = false;
  state.cancelCurrent = false;

  const scope = { type, target, statuses: getScopeStatuses(!!options.force) };
  const newItems = await buildQueue(scope);
  
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

function cancelRun() {
  return cancelAll();
}

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
  setQueueForTest,
  runWorker,
  startRun,
  startRunForScope,
  cancelCurrent,
  cancelAll,
  cancelRun,
  onLibraryScanComplete,
  scheduleNextRun,
  applySettingsChanged,
  initialize
};
