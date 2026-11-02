const attachCatalogRoutes = require('./library/catalog');
const attachFoldersRoutes = require('./library/folders');

/**
 * Attaches user library API routes.
 * Facade module delegating to catalog and folder submodules.
 * @param {import('express').Router} router
 * @param {object} deps
 */
module.exports = function attachLibraryRoutes(router, deps) {
  attachCatalogRoutes(router, deps);
  attachFoldersRoutes(router, deps);
};
