const fs = require('fs');
const path = require('path');
const { openArchiveSession, getEntryBuffer } = require('../archive-utils');
const { GUIDED_VIEW_DIR } = require('../../constants');
const { guidedLog, guidedLogUpdate } = require('../../logger');
const {
  detectPageInProcess,
  detectPageInWorker,
  abortActiveWorker
} = require('./worker-client');

const PAGE_TIMEOUT_MS = 30000;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(message);
      err.code = 'EXTRACTION_TIMEOUT';
      reject(err);
    }, ms);
    promise
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

async function extractPageBuffer(comicPath, pageName) {
  return getEntryBuffer(comicPath, pageName);
}

async function writeSidecarAtomic(targetPath, data) {
  const tmpPath = targetPath + '.tmp';
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2));
  try {
    await fs.promises.rename(tmpPath, targetPath);
  } catch (err) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

async function processComic(id, comicPath, type, opts = {}) {
  const isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : () => false;
  const session = await openArchiveSession(comicPath);
  try {
    let pages = session.pages || [];
    if (pages.length === 0) throw new Error('No pages found');
    if (opts.maxPages && pages.length > opts.maxPages) pages = pages.slice(0, opts.maxPages);

    await fs.promises.mkdir(GUIDED_VIEW_DIR, { recursive: true });
    const result = { comicId: id, type, pages: {} };
    let totalPanels = 0, pagesProcessed = 0;

    for (const pageName of pages) {
      if (isCancelled()) {
        abortActiveWorker('Cancelled');
        throw new Error('Cancelled');
      }
      try {
        if (pagesProcessed % 10 === 0) guidedLogUpdate('processing-pages:' + id, 'INFO', '   ... processing page ' + pagesProcessed + '/' + pages.length);
        const buffer = await withTimeout(
          session.readBuffer(pageName),
          PAGE_TIMEOUT_MS,
          `Page extraction timed out for ${pageName}`
        );
        const useWorker = opts.useWorker !== undefined ? Boolean(opts.useWorker) : !process.env.JEST_WORKER_ID;
        const detected = useWorker
          ? await detectPageInWorker(buffer, type, { isCancelled })
          : await detectPageInProcess(buffer, type);
        result.pages[pageName] = {
          panels: detected.panels,
          bubbles: detected.bubbles,
          sequence: detected.sequence
        };
        totalPanels += detected.panels.length;
        pagesProcessed++;
      } catch (err) {
        // A timed-out shared extractor or cancelled run must abort the comic immediately.
        if (isCancelled() || (err && err.code === 'EXTRACTION_TIMEOUT')) throw err;
        result.pages[pageName] = { panels: [], bubbles: [], sequence: [] };
        guidedLog('WARN', '   page failed: ' + pageName + ' — ' + err.message);
      }
    }

    if (totalPanels === 0) {
      return { panels: 0, pagesProcessed, pageCount: pages.length, outputPath: null };
    }

    const outputPath = path.join(GUIDED_VIEW_DIR, id + '.json');
    await writeSidecarAtomic(outputPath, result);
    return { panels: totalPanels, pagesProcessed, pageCount: pages.length, outputPath };
  } finally {
    await session.close();
  }
}

module.exports = {
  GUIDED_VIEW_DIR,
  extractPageBuffer,
  withTimeout,
  processComic
};
