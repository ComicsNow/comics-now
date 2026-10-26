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
    validateApiKey,
    validateSearchQuery,
    validateComicId,
    checkComicAccess,
    getAllReadingPreferences,
    setReadingPreference,
    getReadingPrefMaps,
    resolveReadingModes,
    modalDetector: require('../services/modal-detector')
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
  require('./public/auth')(publicRouter, extendedDeps);
  require('./public/health')(publicRouter, extendedDeps);
  router.use(publicRouter);
}

function setupUserRoutes(router, extendedDeps, requireUserAuth) {
  const userRouter = express.Router();
  userRouter.use(requireUserAuth);
  require('./user/settings')(userRouter, extendedDeps);
  require('./user/devices')(userRouter, extendedDeps);
  require('./user/reading-lists')(userRouter, extendedDeps);
  require('./user/reading')(userRouter, extendedDeps);
  require('./user/progress')(userRouter, extendedDeps);
  require('./user/library')(userRouter, extendedDeps);
  require('./user/pages')(userRouter, extendedDeps);
  require('./user/metadata')(userRouter, extendedDeps);
  router.use(userRouter);
}

function setupAdminRoutes(router, extendedDeps, requireAdminAuth) {
  const adminRouter = express.Router();
  adminRouter.use(requireAdminAuth);
  require('./admin/users')(adminRouter, extendedDeps);
  require('./admin/comictagger')(adminRouter, extendedDeps);
  require('./admin/guided')(adminRouter, extendedDeps);
  require('./admin/settings')(adminRouter, extendedDeps);
  require('./admin/library-mgmt')(adminRouter, extendedDeps);
  require('./admin/rename')(adminRouter, extendedDeps);
  require('./admin/mcp-tools')(adminRouter, extendedDeps);
  require('./admin/user-stats')(adminRouter, extendedDeps);
  require('./admin/gemini')(adminRouter, extendedDeps);
  router.use(adminRouter);
}

function setupImpersonationRoutes(router, extendedDeps, requireRealAdminAuth) {
  const impersonationRouter = express.Router();
  impersonationRouter.use(requireRealAdminAuth);
  require('./admin/impersonate')(impersonationRouter, extendedDeps);
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
