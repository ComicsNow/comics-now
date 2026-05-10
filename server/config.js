const fs = require('fs');
const path = require('path');
const { CONFIG_FILE } = require('./constants');
const { log } = require('./logger');

const DEFAULT_CONFIG = {
  port: 3000,
  baseUrl: '/',
  comictaggerPath: '/usr/local/bin/comictagger',
  comicsLocation: '/comics',
  libraries: [],
  scanIntervalMinutes: 5,
  comicVineApiKey: '',
  ctScheduleMinutes: 60,
  allowed_formats: 'cbz',
  metadata_storage: 'archive'
};

let config = { ...DEFAULT_CONFIG };

function normalizeDirectory(dir) {
  if (typeof dir !== 'string') return null;
  const trimmed = dir.trim();
  if (!trimmed) return null;

  let normalized;
  try {
    normalized = path.normalize(trimmed);
  } catch {
    return null;
  }

  const windowsDriveMatch = /^[A-Za-z]:[\\/]*$/.exec(normalized);
  if (windowsDriveMatch) {
    return `${normalized.slice(0, 2)}${path.sep}`;
  }

  const root = path.parse(normalized).root || '';
  if (normalized === root) {
    return root || normalized;
  }

  return normalized.replace(/[\\/]+$/, '');
}

function sanitizeDirectories(list) {
  if (!Array.isArray(list)) return [];
  const sanitized = [];
  const seen = new Set();
  for (const entry of list) {
    const pathValue = typeof entry === 'string' ? entry : entry.path;
    const normalized = normalizeDirectory(pathValue);
    if (normalized && !seen.has(normalized)) {
      sanitized.push(typeof entry === 'string' ? { path: normalized, hierarchyMode: 'metadata' } : { ...entry, path: normalized });
      seen.add(normalized);
    }
  }
  return sanitized;
}

function setLibraries(newLibraries, skipSave = false) {
  config.libraries = sanitizeDirectories(newLibraries);
  if (!skipSave) {
    saveConfigToDisk();
  }
}

// Legacy support: setComicsDirectories now maps to setLibraries
function setComicsDirectories(dirs, skipSave = false) {
  const newLibraries = dirs.map(dir => {
    const existing = (config.libraries || []).find(lib => normalizeDirectory(lib.path) === normalizeDirectory(dir));
    return {
      path: dir,
      hierarchyMode: existing?.hierarchyMode || 'metadata'
    };
  });
  setLibraries(newLibraries, skipSave);
  return getComicsDirectories();
}

function addLibrary(dir, mode = 'metadata') {
  const normalized = normalizeDirectory(dir);
  if (!normalized) return false;
  
  if (getComicsDirectories().includes(normalized)) return false;
  
  config.libraries.push({ path: normalized, hierarchyMode: mode });
  saveConfigToDisk();
  return true;
}

function removeLibrary(dir) {
  const normalized = normalizeDirectory(dir);
  if (!normalized) return false;
  
  const initialLength = config.libraries.length;
  config.libraries = config.libraries.filter(lib => normalizeDirectory(lib.path) !== normalized);
  
  if (config.libraries.length !== initialLength) {
    saveConfigToDisk();
    return true;
  }
  return false;
}

function ensureConfigFileExists() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const initialConfig = { ...DEFAULT_CONFIG, libraries: [{ path: '/comics', hierarchyMode: 'metadata' }] };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2));
    log('INFO', 'SERVER', `Created default config at ${CONFIG_FILE}`);
  }
}

function saveConfigToDisk() {
  try {
    // Ensure we don't save legacy comicsDirectories if it somehow got into the config object
    const { comicsDirectories, ...safeConfig } = config;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(safeConfig, null, 2));
    log('INFO', 'SERVER', `Saved config to ${CONFIG_FILE}`);
    return true;
  } catch (e) {
    log('ERROR', 'SERVER', `Failed to save config: ${e.message}`);
    return false;
  }
}

function loadConfigFromDisk() {
  ensureConfigFileExists();

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    
    // Migration: If legacy comicsDirectories exists, use it to backfill libraries if libraries is empty
    if (Array.isArray(parsed.comicsDirectories) && parsed.comicsDirectories.length > 0 && (!parsed.libraries || parsed.libraries.length === 0)) {
      parsed.libraries = parsed.comicsDirectories.map(dir => ({ path: dir, hierarchyMode: 'metadata' }));
    }
    
    // Remove legacy key from the loaded object
    delete parsed.comicsDirectories;

    // Merge parsed config over defaults
    config = { ...DEFAULT_CONFIG, ...parsed };
    
    // Sanitize libraries
    config.libraries = sanitizeDirectories(config.libraries);

  } catch (e) {
    log('ERROR', 'SERVER', `Bad config.json; using defaults. ${e.message}`);
    config = { ...DEFAULT_CONFIG };
  }

  // Fallback to comicsLocation if no libraries configured
  if (config.libraries.length === 0) {
    const normalizedBaseDir = normalizeDirectory(config.comicsLocation);
    if (normalizedBaseDir) {
      config.libraries = [{ path: normalizedBaseDir, hierarchyMode: 'metadata' }];
      log('WARN', 'SERVER', 'No libraries configured; defaulting to comicsLocation.');
    } else {
      log('WARN', 'SERVER', 'No libraries configured; scans are disabled.');
    }
  }

  return config;
}

function getConfig() {
  return config;
}

function getComicsDirectories() {
  return (config.libraries || []).map(lib => lib.path);
}

function getLibraries() {
  return config.libraries || [];
}

function getPublicLibraries() {
  return (config.libraries || []).map((lib, index) => ({
    id: `lib_${index}`,
    name: path.basename(lib.path) || `Library ${index + 1}`,
    hierarchyMode: lib.hierarchyMode
  }));
}

function getPathFromLibraryId(libId) {
  const match = /^lib_(\d+)$/.exec(libId);
  if (!match) return null;
  const index = parseInt(match[1], 10);
  const libraries = getLibraries();
  if (index >= 0 && index < libraries.length) {
    return libraries[index].path;
  }
  return null;
}

function getLibraryIdFromPath(absolutePath) {
  const libraries = getLibraries();
  const index = libraries.findIndex(lib => absolutePath === lib.path || absolutePath.startsWith(lib.path + path.sep));
  if (index === -1) return null;
  return `lib_${index}`;
}

function getScanIntervalMs() {
  return (config.scanIntervalMinutes || 5) * 60000;
}

function getScanIntervalMinutes() {
  return config.scanIntervalMinutes || 5;
}

function setScanIntervalMinutes(minutes, skipSave = false) {
  const sanitized = Math.max(1, parseInt(minutes, 10) || 5);
  config.scanIntervalMinutes = sanitized;
  if (!skipSave) {
    saveConfigToDisk();
  }
  return sanitized * 60 * 1000;
}

function getComicVineApiKey() {
  return config.comicVineApiKey || '';
}

function setComicVineApiKey(key, skipSave = false) {
  config.comicVineApiKey = key || '';
  if (!skipSave) {
    saveConfigToDisk();
  }
}

function getCtScheduleMinutes() {
  return config.ctScheduleMinutes || 0;
}

function setCtScheduleMinutes(minutes, skipSave = false) {
  const sanitized = Math.max(0, parseInt(minutes, 10) || 0);
  config.ctScheduleMinutes = sanitized;
  if (!skipSave) {
    saveConfigToDisk();
  }
}

function getAllowedFormats() {
  return config.allowed_formats || 'cbz';
}

function setAllowedFormats(value, skipSave = false) {
  const allowed = ['cbz', 'cbr', 'both'];
  const sanitized = allowed.includes(value) ? value : 'cbz';
  config.allowed_formats = sanitized;
  if (!skipSave) {
    saveConfigToDisk();
  }
  return sanitized;
}

function getMetadataStorage() {
  return config.metadata_storage || 'archive';
}

function setMetadataStorage(value, skipSave = false) {
  const allowed = ['archive', 'db'];
  const sanitized = allowed.includes(value) ? value : 'archive';
  config.metadata_storage = sanitized;
  if (!skipSave) {
    saveConfigToDisk();
  }
  return sanitized;
}

function getCorsConfig() {
  if (!config.cors) {
    return { enabled: false, allowedOrigins: [] };
  }
  return {
    enabled: config.cors.enabled !== false, // Default to true if set
    allowedOrigins: Array.isArray(config.cors.allowedOrigins) ? config.cors.allowedOrigins : []
  };
}

function getAuthConfig() {
  return config.authentication || { enabled: false };
}

function isAuthEnabled() {
  return config.authentication?.enabled === true;
}

function getAdminEmail() {
  return config.authentication?.adminEmail || null;
}

function getCloudflareConfig() {
  return config.authentication?.cloudflare || {};
}

function getTrustedIPs() {
  return config.authentication?.trustedIPs || [];
}

function getComicsLocation() {
  return config.comicsLocation || '/comics';
}

function setComicsLocation(location, skipSave = false) {
  const normalized = normalizeDirectory(location);
  if (normalized) {
    config.comicsLocation = normalized;
    if (!skipSave) {
      saveConfigToDisk();
    }
    return true;
  }
  return false;
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfigFromDisk,
  getConfig,
  setComicsDirectories,
  getComicsDirectories,
  getLibraries,
  getPublicLibraries,
  getPathFromLibraryId,
  getLibraryIdFromPath,
  addLibrary,
  removeLibrary,
  saveConfigToDisk,
  normalizeDirectory,
  sanitizeDirectories,
  getScanIntervalMs,
  getScanIntervalMinutes,
  setScanIntervalMinutes,
  getComicVineApiKey,
  setComicVineApiKey,
  getCtScheduleMinutes,
  setCtScheduleMinutes,
  getComicsLocation,
  setComicsLocation,
  getAllowedFormats,
  setAllowedFormats,
  getMetadataStorage,
  setMetadataStorage,
  getCorsConfig,
  getAuthConfig,
  isAuthEnabled,
  getAdminEmail,
  getCloudflareConfig,
  getTrustedIPs
};
