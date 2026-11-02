const { log } = require('../../logger');

let isScanning = false;
let scanProgress = { totalFiles: 0, scannedFiles: 0, status: 'Idle' };
let isTaggerRunningFn = null;

function setTaggerRunningCheck(fn) {
  isTaggerRunningFn = fn;
}

function getScanState() {
  return isScanning;
}

function getScanProgress() {
  return scanProgress;
}

function setScanProgress(progress) {
  scanProgress = { ...scanProgress, ...progress };
}

function acquireScanLock(force = false) {
  if (isScanning) {
    log('INFO', 'SCAN', 'Already scanning; skip.');
    return false;
  }
  if (!force) {
    try {
      const isRunning = isTaggerRunningFn ? isTaggerRunningFn() : false;
      if (isRunning) {
        log('INFO', 'SCAN', 'Scan skipped: Tag Comics Now is actively running.');
        return false;
      }
    } catch (_) {}
  }
  isScanning = true;
  scanProgress = { totalFiles: 0, scannedFiles: 0, status: 'Starting' };
  return true;
}

function releaseScanLock() {
  isScanning = false;
  scanProgress.status = 'Idle';
}

module.exports = {
  setTaggerRunningCheck,
  getScanState,
  getScanProgress,
  setScanProgress,
  acquireScanLock,
  releaseScanLock
};
