/**
 * Single-file tagger run slot.
 *
 * A per-comic Tag Search and a full library scan must never run at the same
 * time, so the active file run is tracked here and consulted by both paths.
 */

let activeFileRun = null;

function beginFileRun(details = {}) {
  if (activeFileRun) return false;
  activeFileRun = {
    comicId: details.comicId || null,
    path: details.path || null,
    startedAt: Date.now()
  };
  return true;
}

function endFileRun() {
  activeFileRun = null;
}

function isFileTaggerRunning() {
  return activeFileRun !== null;
}

function getActiveFileRun() {
  return activeFileRun;
}

function resetFileRunState() {
  activeFileRun = null;
}

module.exports = {
  beginFileRun,
  endFileRun,
  isFileTaggerRunning,
  getActiveFileRun,
  resetFileRunState
};
