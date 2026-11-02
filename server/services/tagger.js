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

if (typeof setTaggerRunningCheck === 'function') {
  setTaggerRunningCheck(isTaggerRunning);
}

function applyUserSelectionWrapper(selections) {
  return applyUserSelection(selections, () => {
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
  applyUserSelection: applyUserSelectionWrapper,
  skipCurrentMatch,
  getPendingMatch,
  searchExternal,
  getScanLogsList,
  getScanLogDetail,
  clearEnhancedTracking
};
