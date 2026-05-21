const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

function createId(p) {
  return crypto.createHash('sha1').update(p).digest('hex');
}

function safeDirName(str) {
  return String(str).trim().replace(/[\\/]+/g, '_').replace(/\s+/g, ' ');
}

function isImage(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'].includes(ext);
}

function getMimeFromExt(name) {
  const ext = name.toLowerCase();
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.webp')) return 'image/webp';
  if (ext.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Security: Resolve a redacted library path (e.g., lib_0/Folder/Comic.cbz) 
 * back to an absolute filesystem path.
 * @param {string} requestedPath - The path from the client.
 * @param {Function} getPathFromLibraryId - Function to map lib_X to absolute path.
 * @returns {string} - The absolute filesystem path.
 */
function resolveLibraryPath(requestedPath, getPathFromLibraryId) {
  if (!requestedPath || typeof requestedPath !== 'string') return requestedPath;

  // Normalize separators to forward slashes for matching
  const normalizedPath = requestedPath.replace(/\\/g, '/');

  // Check if it starts with lib_X
  const libMatch = /^lib_(\d+)([\\/].*)?$/.exec(normalizedPath);
  if (libMatch) {
    const libId = `lib_${libMatch[1]}`;
    const relativePart = (libMatch[2] || '').replace(/^[\\/]+/, '');
    const rootPath = getPathFromLibraryId(libId);
    if (rootPath) {
      // Use the actual OS path separator for the joined result
      return path.join(rootPath, relativePart.replace(/\//g, path.sep));
    }
  }

  return requestedPath;
}

/**
 * Security: Validate that a file path is within allowed comic directories
 * Prevents path traversal attacks (e.g., ../../etc/passwd)
 * @param {Function} log - Logger function
 * @param {Function} getComicsDirectories - Function to get allowed directories
 * @param {string} requestedPath - The decoded file path from user input
 * @returns {boolean} - True if path is safe, false if potentially malicious
 */
function isPathSafe(log, getComicsDirectories, requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') {
    return false;
  }

  // Resolve to absolute path and follow symbolic links to prevent bypasses
  let resolvedPath;
  try {
    try {
      resolvedPath = fs.realpathSync(requestedPath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        // If file/directory does not exist on disk yet, resolve the realpath of its parent directory
        const dir = path.dirname(requestedPath);
        const base = path.basename(requestedPath);
        resolvedPath = path.join(fs.realpathSync(dir), base);
      } else {
        return false;
      }
    }
  } catch {
    // Fall back to path.resolve if it's completely unresolvable
    try {
      resolvedPath = path.resolve(requestedPath);
    } catch {
      return false;
    }
  }

  // Get allowed comic directories
  const allowedDirs = getComicsDirectories();

  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    log('WARN', 'SECURITY', 'No comic directories configured - rejecting all paths');
    return false;
  }

  // Check if resolved path starts with any allowed directory (using realpaths for validation)
  const isSafe = allowedDirs.some(allowedDir => {
    try {
      const resolvedAllowedDir = fs.realpathSync(allowedDir);
      return resolvedPath.startsWith(resolvedAllowedDir + path.sep) ||
             resolvedPath === resolvedAllowedDir;
    } catch {
      try {
        const resolvedAllowedDir = path.resolve(allowedDir);
        return resolvedPath.startsWith(resolvedAllowedDir + path.sep) ||
               resolvedPath === resolvedAllowedDir;
      } catch {
        return false;
      }
    }
  });

  if (!isSafe) {
    log('WARN', 'SECURITY', `Path traversal attempt blocked: ${requestedPath} -> ${resolvedPath}`);
  }

  return isSafe;
}

/**
 * Security: Format error messages based on user role
 * Admins get detailed errors for debugging, non-admins get generic messages
 * @param {Function} log - Logger function
 * @param {Error} error - The error object
 * @param {Object} req - Express request object (with req.user)
 * @param {string} fallbackMessage - Generic message for non-admins
 * @returns {string} - Formatted error message
 */
function formatErrorMessage(log, error, req, fallbackMessage = 'Operation failed') {
  const isAdmin = req.user?.role === 'admin';

  // Always log full error server-side for debugging
  log('ERROR', 'API', `Error for ${req.user?.email || 'unknown'}: ${error.message || error}`);

  // Return detailed error to admins, generic to non-admins
  if (isAdmin) {
    return error.message || error.toString();
  }

  return fallbackMessage;
}

function t0() {
  return process.hrtime();
}

function ms(since) {
  const diff = process.hrtime(since);
  return (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(3);
}

function stripHtml(s = '') {
  return s.replace(/<[^>]*>/gm, '');
}

function sanitizeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;

  Object.getOwnPropertyNames(obj).forEach(name => {
    const prop = obj[name];
    if (prop !== null && typeof prop === 'object') {
      deepFreeze(prop);
    }
  });
  return Object.freeze(obj);
}

/**
 * Parallel map with concurrency limit
 */
async function pMap(items, mapper, concurrency = 5) {
  const results = new Array(items.length);
  const activeTasks = new Set();
  let index = 0;

  for (const item of items) {
    const currentIndex = index++;
    const task = (async () => {
      try {
        results[currentIndex] = await mapper(item);
      } finally {
        activeTasks.delete(task);
      }
    })();
    activeTasks.add(task);
    if (activeTasks.size >= concurrency) {
      await Promise.race(activeTasks);
    }
  }

  await Promise.all(activeTasks);
  return results;
}

module.exports = {
  createId,
  safeDirName,
  isImage,
  getMimeFromExt,
  isPathSafe,
  resolveLibraryPath,
  formatErrorMessage,
  t0,
  ms,
  stripHtml,
  sanitizeHtml,
  deepFreeze,
  pMap
};
