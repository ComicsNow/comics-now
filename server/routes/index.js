const express = require('express');
const path = require('path');
const { 
  formatErrorMessage: sharedFormatErrorMessage,
  isPathSafe: sharedIsPathSafe,
  resolveLibraryPath
} = require('../utils');
const { 
  validateFingerprint, 
  validateDeviceId, 
  validateDeviceName,
  validateLastReadPage,
  validateStatus,
  validateScanInterval,
  validatePageCacheMaxMb,
  validateApiKey,
  validateSearchQuery,
  validateComicId
} = require('../validation');
const { 
  checkComicAccess, 
  getAllReadingPreferences, 
  setReadingPreference,
  getReadingPrefMaps,
  resolveReadingModes
} = require('../db');
const modalDetector = require('../services/modal-detector');

const attachAuthRoutes = require('./public/auth');
const attachHealthRoutes = require('./public/health');

const attachUserSettingsRoutes = require('./user/settings');
const attachUserDevicesRoutes = require('./user/devices');
const attachUserReadingListsRoutes = require('./user/reading-lists');
const attachUserReadingRoutes = require('./user/reading');
const attachUserProgressRoutes = require('./user/progress');
const attachUserLibraryRoutes = require('./user/library');
const attachUserPagesRoutes = require('./user/pages');
const attachUserMetadataRoutes = require('./user/metadata');
const attachUserStoryArcsRoutes = require('./user/story-arcs');

const attachAdminUsersRoutes = require('./admin/users');
const attachAdminComictaggerRoutes = require('./admin/comictagger');
const attachAdminGuidedRoutes = require('./admin/guided');
const attachAdminSettingsRoutes = require('./admin/settings');
const attachAdminLibraryMgmtRoutes = require('./admin/library-mgmt');
const attachAdminRenameRoutes = require('./admin/rename');
const attachAdminMcpToolsRoutes = require('./admin/mcp-tools');
const attachAdminUserStatsRoutes = require('./admin/user-stats');
const attachAdminGeminiRoutes = require('./admin/gemini');
const attachAdminImpersonateRoutes = require('./admin/impersonate');

function createExtendedDeps(deps) {
  const { log, getComicsDirectories, getPathFromLibraryId } = deps;

  const formatErrorMessage = (error, req, fallbackMessage) =>
    sharedFormatErrorMessage(log, error, req, fallbackMessage);

  const isPathSafe = (requestedPath) => {
    const resolved = resolveLibraryPath(requestedPath, getPathFromLibraryId);
    return sharedIsPathSafe(log, getComicsDirectories, resolved);
  };

  const resolvePath = (requestedPath) =>
    resolveLibraryPath(requestedPath, getPathFromLibraryId);

  return {
    ...deps,
    formatErrorMessage,
    isPathSafe,
    resolvePath,
    validateFingerprint,
    validateDeviceId,
    validateDeviceName,
    validateLastReadPage,
    validateStatus,
    validateScanInterval,
    validatePageCacheMaxMb,
    validateApiKey,
    validateSearchQuery,
    validateComicId,
    checkComicAccess,
    getAllReadingPreferences,
    setReadingPreference,
    getReadingPrefMaps,
    resolveReadingModes,
    modalDetector
  };
}

function createAuthMiddlewares(deps) {
  const requireUserAuth = (req, res, next) => {
    const normalizedPath = path.posix.normalize(req.path);
    if (!normalizedPath.startsWith('/api')) return next();
    return deps.requireAuth(req, res, next);
  };

  const requireAdminAuth = (req, res, next) => {
    const normalizedPath = path.posix.normalize(req.path);
    if (!normalizedPath.startsWith('/api')) return next();
    return deps.requireAdmin(req, res, next);
  };

  const requireRealAdminAuth = (req, res, next) => {
    const normalizedPath = path.posix.normalize(req.path);
    if (!normalizedPath.startsWith('/api/v1/admin/impersonate')) return next();
    if (!deps.isAuthEnabled()) return next();
    const real = req.realUser || req.user;
    if (!real || real.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  };

  return { requireUserAuth, requireAdminAuth, requireRealAdminAuth };
}

function setupPublicRoutes(router, extendedDeps) {
  const publicRouter = express.Router();
  attachAuthRoutes(publicRouter, extendedDeps);
  attachHealthRoutes(publicRouter, extendedDeps);
  router.use(publicRouter);
}

function setupUserRoutes(router, extendedDeps, requireUserAuth) {
  const userRouter = express.Router();
  userRouter.use(requireUserAuth);
  attachUserSettingsRoutes(userRouter, extendedDeps);
  attachUserDevicesRoutes(userRouter, extendedDeps);
  attachUserReadingListsRoutes(userRouter, extendedDeps);
  attachUserReadingRoutes(userRouter, extendedDeps);
  attachUserProgressRoutes(userRouter, extendedDeps);
  attachUserLibraryRoutes(userRouter, extendedDeps);
  attachUserPagesRoutes(userRouter, extendedDeps);
  attachUserMetadataRoutes(userRouter, extendedDeps);
  attachUserStoryArcsRoutes(userRouter, extendedDeps);
  router.use(userRouter);
}

function setupAdminRoutes(router, extendedDeps, requireAdminAuth) {
  const adminRouter = express.Router();
  adminRouter.use(requireAdminAuth);
  attachAdminUsersRoutes(adminRouter, extendedDeps);
  attachAdminComictaggerRoutes(adminRouter, extendedDeps);
  attachAdminGuidedRoutes(adminRouter, extendedDeps);
  attachAdminSettingsRoutes(adminRouter, extendedDeps);
  attachAdminLibraryMgmtRoutes(adminRouter, extendedDeps);
  attachAdminRenameRoutes(adminRouter, extendedDeps);
  attachAdminMcpToolsRoutes(adminRouter, extendedDeps);
  attachAdminUserStatsRoutes(adminRouter, extendedDeps);
  attachAdminGeminiRoutes(adminRouter, extendedDeps);
  router.use(adminRouter);
}

function setupImpersonationRoutes(router, extendedDeps, requireRealAdminAuth) {
  const impersonationRouter = express.Router();
  impersonationRouter.use(requireRealAdminAuth);
  attachAdminImpersonateRoutes(impersonationRouter, extendedDeps);
  router.use(impersonationRouter);
}

function createApiRouter(deps) {
  const extendedDeps = createExtendedDeps(deps);
  const { requireUserAuth, requireAdminAuth, requireRealAdminAuth } = createAuthMiddlewares(deps);

  const router = express.Router();

  setupPublicRoutes(router, extendedDeps);
  
  // Register impersonation routes before admin routes
  setupImpersonationRoutes(router, extendedDeps, requireRealAdminAuth);
  setupUserRoutes(router, extendedDeps, requireUserAuth);
  setupAdminRoutes(router, extendedDeps, requireAdminAuth);

  return router;
}

module.exports = { createApiRouter };
