import { state, global as canonicalGlobal } from '../globals.js';

import {
  isRateDefenseMessage,
  ctLogEntryKey,
  formatLogTime,
  formatCtLogMessage,
  upsertCtLogLine,
  upsertRateDefenseLine,
  appendLocalCtLogLine,
  applyCtLogEntry,
  loadCtSavedLogs,
  seenLogEntries,
  ctLogLineElements
} from './logging.js';

import {
  setScanRunningUI,
  updateCtProgressFromLog,
  updateCtButtonIndicator
} from './progress.js';

import {
  runCtScan,
  fetchCtScopeCounts,
  loadScanLogs,
  clearTrackingHistory,
  migrateLibraryMetadata,
  cancelCtScan
} from './scan.js';

import {
  fetchCtSettings,
  saveCtSettings
} from './settings.js';

import {
  geminiState,
  loadGeminiModels,
  openGeminiComplianceModal,
  initGeminiComplianceModal
} from './gemini.js';

import {
  checkPendingMatch,
  clearCtMatches,
  debouncedFetchPendingMatchDetails,
  fetchPendingMatchDetails,
  getCtMatchHtml,
  renderComicPreview,
  showCtConfirm,
  handleCtConfirmYes,
  handleCtConfirmNo
} from './matches.js';

import {
  ctSyncLogsAndState,
  openCTModal,
  closeCTModal,
  bindComicTaggerEvents
} from './lifecycle.js';

if (typeof window !== 'undefined') {
  setInterval(updateCtButtonIndicator, 10000);
  setTimeout(updateCtButtonIndicator, 2000);
}

export {
  checkPendingMatch,
  formatCtLogMessage,
  loadCtSavedLogs,
  openCTModal,
  clearCtMatches,
  closeCTModal,
  fetchCtSettings,
  debouncedFetchPendingMatchDetails,
  fetchPendingMatchDetails,
  getCtMatchHtml,
  renderComicPreview,
  saveCtSettings,
  loadScanLogs,
  clearTrackingHistory,
  showCtConfirm,
  handleCtConfirmYes,
  handleCtConfirmNo,
  updateCtButtonIndicator,
  ctSyncLogsAndState,
  isRateDefenseMessage,
  ctLogEntryKey,
  formatLogTime,
  upsertCtLogLine,
  upsertRateDefenseLine,
  appendLocalCtLogLine,
  applyCtLogEntry,
  setScanRunningUI,
  updateCtProgressFromLog,
  runCtScan,
  fetchCtScopeCounts,
  migrateLibraryMetadata,
  cancelCtScan,
  geminiState,
  loadGeminiModels,
  openGeminiComplianceModal,
  initGeminiComplianceModal,
  bindComicTaggerEvents,
  seenLogEntries,
  ctLogLineElements
};

const ComicTagger = {
  checkPendingMatch,
  formatCtLogMessage,
  loadCtSavedLogs,
  openCTModal,
  clearCtMatches,
  closeCTModal,
  fetchCtSettings,
  debouncedFetchPendingMatchDetails,
  fetchPendingMatchDetails,
  getCtMatchHtml,
  renderComicPreview,
  saveCtSettings,
  loadScanLogs,
  clearTrackingHistory,
  showCtConfirm,
  handleCtConfirmYes,
  handleCtConfirmNo,
  updateCtButtonIndicator,
  ctSyncLogsAndState,
  isRateDefenseMessage,
  ctLogEntryKey,
  formatLogTime,
  upsertCtLogLine,
  upsertRateDefenseLine,
  appendLocalCtLogLine,
  applyCtLogEntry,
  setScanRunningUI,
  updateCtProgressFromLog,
  runCtScan,
  fetchCtScopeCounts,
  migrateLibraryMetadata,
  cancelCtScan,
  geminiState,
  loadGeminiModels,
  openGeminiComplianceModal,
  initGeminiComplianceModal,
  bindComicTaggerEvents
};

export default ComicTagger;

// Register onto state & window
Object.assign(state, ComicTagger);

if (typeof window !== 'undefined') {
  Object.assign(window, ComicTagger);
}

const globalTarget = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : (typeof window !== 'undefined' ? window : globalThis);
if (globalTarget) {
  Object.assign(globalTarget, ComicTagger);
}
