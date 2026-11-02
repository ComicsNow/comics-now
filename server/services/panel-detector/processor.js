const fs = require('fs');
const path = require('path');
const { listPages, getEntryBuffer } = require('../archive-utils');
const { ROOT_DIR } = require('../../constants');
const { guidedLog, guidedLogUpdate } = require('../../logger');
const { detectPanels, detectBubbles } = require('./inference');
const {
  sortReadingOrder,
  buildMangaSequence,
  buildHybridWesternSequence
} = require('./ordering');

const GUIDED_VIEW_DIR = path.join(ROOT_DIR, 'metadata', 'guided_view');

async function extractPageBuffer(comicPath, pageName) {
  return await getEntryBuffer(comicPath, pageName);
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

async function processComic(id, comicPath, type, opts = {}) {
  const isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : () => false;
  let pages = await listPages(comicPath);
  if (!pages || pages.length === 0) throw new Error('No pages found');
  if (opts.maxPages && pages.length > opts.maxPages) pages = pages.slice(0, opts.maxPages);

  await fs.promises.mkdir(GUIDED_VIEW_DIR, { recursive: true });
  const result = { comicId: id, type, pages: {} };
  let totalPanels = 0, pagesProcessed = 0;

  for (const pageName of pages) {
    if (isCancelled()) throw new Error('Cancelled');
    try {
      if (pagesProcessed % 10 === 0) guidedLogUpdate('processing-pages:' + id, 'INFO', '   ... processing page ' + pagesProcessed + '/' + pages.length);
      const buffer = await withTimeout(
        extractPageBuffer(comicPath, pageName),
        30000,
        `Page extraction timed out for ${pageName}`
      );
      const rawPanels = (type === 'manga') ? await detectPanels(buffer, 'manga', 0.1, 0) : await detectPanels(buffer, 'western', 0.5, 0);
      const panels = sortReadingOrder(rawPanels, type);
      const bubbles = await detectBubbles(buffer, type);
      let sequence = (type === 'manga') ? buildMangaSequence(rawPanels, bubbles) : buildHybridWesternSequence(panels, bubbles);
      result.pages[pageName] = { panels, bubbles, sequence: sequence.length > 0 ? sequence : panels };
      totalPanels += panels.length;
      pagesProcessed++;
    } catch (err) {
      result.pages[pageName] = { panels: [], bubbles: [], sequence: [] };
      guidedLog('WARN', '   page failed: ' + pageName + ' — ' + err.message);
    }
  }
  await fs.promises.writeFile(path.join(GUIDED_VIEW_DIR, id + '.json'), JSON.stringify(result, null, 2));
  return { panels: totalPanels, pagesProcessed, pageCount: pages.length, outputPath: path.join(GUIDED_VIEW_DIR, id + '.json') };
}

module.exports = {
  GUIDED_VIEW_DIR,
  extractPageBuffer,
  withTimeout,
  processComic
};
