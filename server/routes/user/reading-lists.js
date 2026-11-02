const attachCrudRoutes = require('./reading-lists/crud');
const attachItemsRoutes = require('./reading-lists/items');
const attachOrderRoutes = require('./reading-lists/order');

/**
 * Attaches user reading lists API routes.
 * Facade module delegating to CRUD, item management, and ordering/DAG/sync submodules.
 * @param {import('express').Router} router
 * @param {object} deps
 */
module.exports = function attach(router, deps) {
  attachCrudRoutes(router, deps);
  attachItemsRoutes(router, deps);
  attachOrderRoutes(router, deps);
};
