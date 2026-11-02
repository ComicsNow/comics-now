/**
 * User Metadata Routes Hub
 *
 * Mounts search, cover proxy, volume/issue details, and synthesis/extraction routes.
 */
const { attachSearchRoutes } = require('./metadata/search');
const { attachCoverProxyRoutes } = require('./metadata/cover-proxy');
const { attachIssuesRoutes } = require('./metadata/issues');
const { attachComicInfoRoutes } = require('./metadata/comic-info');

module.exports = function attach(router, deps) {
  attachSearchRoutes(router, deps);
  attachCoverProxyRoutes(router, deps);
  attachIssuesRoutes(router, deps);
  attachComicInfoRoutes(router, deps);
};
