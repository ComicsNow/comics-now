const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || ROOT_DIR;

const DEFAULT_NAMING_RULES = {
  tokens: [
    { id: 'number', enabled: true, mandatory: false },
    { id: 'series', enabled: true, mandatory: true },
    { id: 'title', enabled: true, mandatory: false },
    { id: 'publisher', enabled: true, mandatory: true },
    { id: 'year', enabled: true, mandatory: true },
    { id: 'pages', enabled: true, mandatory: false },
    { id: 'writer', enabled: false, mandatory: false },
    { id: 'volume', enabled: false, mandatory: false }
  ]
};

const DEFAULT_FOLDER_RULES = {
  hierarchy: ['publisher', 'series']
};

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
  PAGE_CACHE_DIRECTORY: path.join(DATA_DIR, 'page-cache'),
  DEFAULT_MAX_PAGE_CACHE_MB: 200,
  PAGE_CACHE_MIN_MB: 50,
  PAGE_CACHE_MAX_MB: 10240,
  MAX_LOG_ENTRIES: 500,
  METADATA_MARKER_FILE: '.metadata.txt',
  DEFAULT_NAMING_RULES,
  DEFAULT_FOLDER_RULES
};
