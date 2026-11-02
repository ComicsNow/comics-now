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

module.exports = { state };
