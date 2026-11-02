const attachScanMetaRoutes = require('./library/scan-meta');
const attachMoveRoutes = require('./library/move');
const attachTreeLogsRoutes = require('./library/tree-logs');

/**
 * Admin Library Management Routes Hub
 * @param {express.Router} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  attachScanMetaRoutes(router, deps);
  attachMoveRoutes(router, deps);
  attachTreeLogsRoutes(router, deps);
};
