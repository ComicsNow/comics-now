const express = require('express');
const path = require('path');
const { 
  formatErrorMessage: _formatErrorMessage,
  isPathSafe: _isPathSafe
} = require('../utils');
const { 
  validateFingerprint, 
  validateDeviceId, 
  validateDeviceName,
  validateLastReadPage,
  validateStatus,
  validateScanInterval,
  validateApiKey
} = require('../validation');
const { 
  checkComicAccess, 
  getAllMangaModePreferences, 
  setMangaModePreference 
} = require('../db');

function createApiRouter(deps) {
  const { 
    log, 
    getComicsDirectories, 
    getPathFromLibraryId,
    getLibraryIdFromPath
  } = deps;
  
  // Create the shared helpers
  const formatErrorMessage = (error, req, fallbackMessage) => 
    require('../utils').formatErrorMessage(log, error, req, fallbackMessage);
    
  const isPathSafe = (requestedPath) => {
    const { resolveLibraryPath, isPathSafe: _isPathSafe } = require('../utils');
    const resolved = resolveLibraryPath(requestedPath, getPathFromLibraryId);
    return _isPathSafe(log, getComicsDirectories, resolved);
  };

  const resolvePath = (requestedPath) =>
    require('../utils').resolveLibraryPath(requestedPath, getPathFromLibraryId);

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
    checkComicAccess,
    getAllMangaModePreferences,
    setMangaModePreference
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

  const router = express.Router();

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
  
  // Register extracted routes
  router.use(userRouter);
  router.use(adminRouter);
  
  return router;
}

module.exports = { createApiRouter };
