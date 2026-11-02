const { guidedLog } = require('../../logger');
const panelDetector = require('../panel-detector');
const modalDetector = require('../modal-detector');
const cryptoVault = require('../../utils/crypto-vault');
const { state } = require('./state');
const { SETTINGS_KEYS, getSetting, getSettings } = require('./settings');

function getEffectiveConcurrency(settings) {
  if (!settings || !settings.useModal) return 1;
  const c = Number(settings.concurrency);
  return (c === 1) ? 1 : 2;
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
      const rawSecret = await getSetting(SETTINGS_KEYS.modalTokenSecret, '');
      const secret = cryptoVault.decrypt(rawSecret);
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

module.exports = {
  getEffectiveConcurrency,
  processComic,
  modalDetector,
  panelDetector
};
