const { listPages } = require('./archive-utils');
const {
  processComic,
  extractPageBuffer,
  GUIDED_VIEW_DIR
} = require('./panel-detector/processor');
const {
  detectPanels,
  detectBubbles
} = require('./panel-detector/inference');
const {
  sortReadingOrder,
  buildMangaSequence,
  buildHybridWesternSequence
} = require('./panel-detector/ordering');

module.exports = {
  processComic,
  extractPageBuffer,
  listPages,
  detectPanels,
  detectBubbles,
  sortReadingOrder,
  buildMangaSequence,
  buildHybridWesternSequence,
  GUIDED_VIEW_DIR
};
