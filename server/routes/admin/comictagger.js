const attachSettingsRoutes = require('./comictagger/settings');
const attachExecutionRoutes = require('./comictagger/execution');
const attachRunFileRoutes = require('./comictagger/run-file');
const attachStreamRoutes = require('./comictagger/stream');

/**
 * Admin ComicTagger Routes Hub
 * @param {express.Router} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  attachSettingsRoutes(router, deps);
  attachExecutionRoutes(router, deps);
  attachRunFileRoutes(router, deps);
  attachStreamRoutes(router, deps);
};
