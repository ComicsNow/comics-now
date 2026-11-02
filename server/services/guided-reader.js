const {
  SETTINGS_KEYS,
  getSetting,
  getSettings,
  getStatusCounts,
  getStatus,
  intervalToMs
} = require('./guided/settings');

const {
  getEffectiveConcurrency,
  processComic,
  modalDetector,
  panelDetector
} = require('./guided/processor');

const {
  getScopeStatuses,
  buildQueue
} = require('./guided/queue');

const {
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
} = require('./guided/worker');

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
  panelDetector,
  getEffectiveConcurrency,
  setQueueForTest,
  runWorker
};
