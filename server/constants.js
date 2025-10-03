const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

module.exports = {
  ROOT_DIR,
  CONFIG_FILE: path.join(ROOT_DIR, 'config.json'),
  DB_FILE: path.join(ROOT_DIR, 'comics-now.db'),
  COMICVINE_API_URL: 'https://comicvine.gamespot.com/api',
  LOGOS_DIRECTORY: path.join(ROOT_DIR, 'logos'),
  ICONS_DIRECTORY: path.join(ROOT_DIR, 'icons'),
  SCREENSHOTS_DIRECTORY: path.join(ROOT_DIR, 'screenshots'),
  THUMBNAILS_DIRECTORY: path.join(ROOT_DIR, 'thumbnails'),
  TEMP_DIRECTORY: path.join(ROOT_DIR, 'temp'),
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  SCRIPTS_DIRECTORY: path.join(ROOT_DIR, 'scripts'),
  MAX_LOG_ENTRIES: 500,
  METADATA_MARKER_FILE: '.metadata.txt'
};
