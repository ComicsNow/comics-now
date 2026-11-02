const { getScanIntervalMs } = require('../../config');

let scanTimeout = null;

/**
 * Schedules the next recurring library scan using the configured interval.
 *
 * @param {Function} scanFn - The async function to invoke when the timer triggers
 */
function scheduleNextScan(scanFn) {
  if (scanTimeout) clearTimeout(scanTimeout);
  const interval = getScanIntervalMs();
  scanTimeout = setTimeout(async () => {
    if (typeof scanFn === 'function') {
      await scanFn();
    }
    scheduleNextScan(scanFn);
  }, interval);
}

function stopScheduledScan() {
  if (scanTimeout) {
    clearTimeout(scanTimeout);
    scanTimeout = null;
  }
}

module.exports = {
  scheduleNextScan,
  stopScheduledScan
};
