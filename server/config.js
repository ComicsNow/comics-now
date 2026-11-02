const {
  normalizeDirectory,
  sanitizeDirectories,
  getPublicLibraries,
  getPathFromLibraryId,
  getLibraryIdFromPath
} = require('./config/paths');

const store = require('./config/store');

module.exports = {
  ...store,
  normalizeDirectory,
  sanitizeDirectories,
  getPublicLibraries: store.getPublicLibraries,
  getPathFromLibraryId: store.getPathFromLibraryId,
  getLibraryIdFromPath: store.getLibraryIdFromPath
};
