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

  // Guards ONLY the impersonation-control endpoints, judged by the REAL
  // identity. While impersonating, req.user is the (non-admin) target, so the
  // blanket requireAdmin on adminRouter would reject "stop"/"status". This
  // router is mounted before adminRouter so those paths resolve here; every
  // other path passes straight through untouched.
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
  require('./admin/rename')(adminRouter, extendedDeps);
  require('./admin/mcp-tools')(adminRouter, extendedDeps);
  require('./admin/user-stats')(adminRouter, extendedDeps);

  // Impersonation control (judged by the real admin identity, not the swap).
  // Must be registered BEFORE adminRouter so its /api/v1/admin/impersonate/*
  // routes resolve here and bypass adminRouter's blanket requireAdmin (which
  // sees the swapped non-admin identity while impersonating).
  const impersonationRouter = express.Router();
  impersonationRouter.use(requireRealAdminAuth);
  require('./admin/impersonate')(impersonationRouter, extendedDeps);

  // Register extracted routes
  router.use(impersonationRouter);
  router.use(userRouter);
  router.use(adminRouter);
  
  return router;
}

module.exports = { createApiRouter };
