/**
 * Comics Now! - Automated Comic Tagger Orchestration Service Facade
 *
 * Coordinates scanning runner, file gates, engine IPC, interactive review, and database persistence.
 */

const { setTaggerRunningCheck, scanLibrary } = require('./library-scan');
const {
  runComicTagger,
  cancelComicTagger,
  isTaggerRunning,
  scheduleCtRun
} = require('./tagger/runner');
const {
  resolveScanMode,
  getScanScopeCounts
} = require('./tagger/gates');
const {
  applyUserSelection,
  skipCurrentMatch,
  getPendingMatch
} = require('./tagger/review');
const {
  searchExternal,
  getScanLogsList,
  getScanLogDetail,
  clearEnhancedTracking
} = require('./tagger/engine-client');
const { runSingleFileTagger } = require('./tagger/single-file');
const { isFileTaggerRunning, getActiveFileRun } = require('./tagger/file-run-state');

if (typeof setTaggerRunningCheck === 'function') {
  setTaggerRunningCheck(() => isTaggerRunning() || isFileTaggerRunning());
}

function applyUserSelectionWrapper(selections) {
  const origin = getPendingMatch()?.origin || 'scan';
  return applyUserSelection(selections, () => {
    if (origin === 'file') return;
    if (!isTaggerRunning() && typeof scanLibrary === 'function') {
      scanLibrary();
    }
  });
}

module.exports = {
  runComicTagger,
  resolveScanMode,
  getScanScopeCounts,
  cancelComicTagger,
  isTaggerRunning,
  scheduleCtRun,
  runSingleFileTagger,
  isFileTaggerRunning,
  getActiveFileRun,
  applyUserSelection: applyUserSelectionWrapper,
  skipCurrentMatch,
  getPendingMatch,
  searchExternal,
  getScanLogsList,
  getScanLogDetail,
  clearEnhancedTracking
};
