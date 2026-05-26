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

function createApiRouter(deps) {
  const { 
    log, 
    getComicsDirectories, 
    getPathFromLibraryId
  } = deps;
  
  // Create the shared helpers
  const formatErrorMessage = (error, req, fallbackMessage) => 
    sharedFormatErrorMessage(log, error, req, fallbackMessage);
    
  const isPathSafe = (requestedPath) => {
    const resolved = resolveLibraryPath(requestedPath, getPathFromLibraryId);
    return sharedIsPathSafe(log, getComicsDirectories, resolved);
  };

  const resolvePath = (requestedPath) =>
    resolveLibraryPath(requestedPath, getPathFromLibraryId);

  // Merge extra deps for new sub-routers
  const extendedDeps = {
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
    resolveReadingModes
  };

  // Middleware wrappers to prevent blocking static SPA routes that fall through
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

  const { rateLimiter } = require('../middleware/rate-limiter');
  const router = express.Router();
  const apiLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 1000
  });
  router.use(apiLimiter);

  // Public routes
  const publicRouter = express.Router();
  require('./public/auth')(publicRouter, extendedDeps);
  router.use(publicRouter);
  
  // Extract user routes
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
  
  // Extract admin routes
  const adminRouter = express.Router();
  adminRouter.use(requireAdminAuth);
  require('./admin/users')(adminRouter, extendedDeps);
  require('./admin/comictagger')(adminRouter, extendedDeps);
  require('./admin/guided')(adminRouter, extendedDeps);
  require('./admin/settings')(adminRouter, extendedDeps);
  require('./admin/library-mgmt')(adminRouter, extendedDeps);
  require('./admin/rename')(adminRouter, extendedDeps);
  
  // Register extracted routes
  router.use(userRouter);
  router.use(adminRouter);
  
  return router;
}

module.exports = { createApiRouter };
