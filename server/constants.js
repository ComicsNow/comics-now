const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || ROOT_DIR;

module.exports = {
  ROOT_DIR,
  CONFIG_FILE: path.join(DATA_DIR, 'config.json'),
  DB_FILE: path.join(DATA_DIR, 'comics-now.db'),
  COMICVINE_API_URL: 'https://comicvine.gamespot.com/api',
  LOGOS_DIRECTORY: path.join(ROOT_DIR, 'logos'),
  ICONS_DIRECTORY: path.join(ROOT_DIR, 'icons'),
  THUMBNAILS_DIRECTORY: path.join(DATA_DIR, 'thumbnails'),
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  SCRIPTS_DIRECTORY: path.join(ROOT_DIR, 'scripts'),
  GUIDED_VIEW_DIR: path.join(DATA_DIR, 'metadata', 'guided_view'),
  MAX_LOG_ENTRIES: 500,
  METADATA_MARKER_FILE: '.metadata.txt'
};
