const fs = require('fs');
const path = require('path');
const {
  CONFIG_FILE,
  DEFAULT_MAX_PAGE_CACHE_MB,
  PAGE_CACHE_MIN_MB,
  PAGE_CACHE_MAX_MB
} = require('../constants');
const { log } = require('../logger');
const {
  normalizeDirectory,
  sanitizeDirectories,
  getPublicLibraries: getPublicLibs,
  getPathFromLibraryId: getPathFromLibId,
  getLibraryIdFromPath: getLibIdFromPath
} = require('./paths');
const { applyEnvOverrides } = require('./env');
const { createTaggerConfigAccessors } = require('./tagger-config');

const DEFAULT_CONFIG = {
  port: 3000,
  baseUrl: '/',
  comicsLocation: '/comics',
  libraries: [],
  scanIntervalMinutes: 5,
  pageCacheMaxMb: DEFAULT_MAX_PAGE_CACHE_MB,
  comicVineApiKey: '',
  ctScheduleMinutes: 60,
  allowed_formats: 'cbz',
  delete_cbr_after_conversion: false,
  delete_pdf_after_conversion: false,
  metadata_storage: 'archive',
  trustProxy: false,
  taggerMode: 'new',
  taggerServiceUrl: 'http://127.0.0.1:5000',
  taggerLowerThreshold: 0.80,
  taggerUpperThreshold: 0.90,
  taggerEnabledSources: ['src-comicvine', 'src-metron', 'src-gcd', 'src-lcg', 'src-goodreads', 'src-blackwells', 'src-waterstones', 'src-googlebooks', 'src-amazon', 'src-forbiddenplanet'],
  metronUser: '',
  metronPassword: '',
  googleBooksApiKey: '',
  namingRules: null,
  folderRules: null,
  geminiApiKey: '',
  geminiModel: 'gemini-3.5-flash-lite',
  geminiCoverMatchEnabled: true,
  geminiCoverDailyCap: 450,
  geminiTermsAccepted: false
};

let config = { ...DEFAULT_CONFIG };
applyEnvOverrides(config);

function ensureConfigFileExists() {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    const initialConfig = { ...DEFAULT_CONFIG, libraries: [{ path: '/comics', hierarchyMode: 'metadata' }] };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2));
    log('INFO', 'SERVER', `Created default config at ${CONFIG_FILE}`);
  }
}

function saveConfigToDisk() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let diskConfig = {};
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        diskConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      }
    } catch (_) {}
    const { comicsDirectories, ...safeConfig } = config;
    const merged = { ...diskConfig, ...safeConfig };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
    log('INFO', 'SERVER', `Saved config to ${CONFIG_FILE}`);
    return true;
  } catch (e) {
    log('ERROR', 'SERVER', `Failed to save config: ${e.message}`);
    return false;
  }
}

async function loadConfigFromDisk() {
  ensureConfigFileExists();

  try {
    const raw = await fs.promises.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    
    if (Array.isArray(parsed.comicsDirectories) && parsed.comicsDirectories.length > 0 && (!parsed.libraries || parsed.libraries.length === 0)) {
      parsed.libraries = parsed.comicsDirectories.map(dir => ({ path: dir, hierarchyMode: 'metadata' }));
    }
    
    delete parsed.comicsDirectories;
    Object.keys(config).forEach(k => delete config[k]);
    Object.assign(config, DEFAULT_CONFIG, parsed);
    config.libraries = sanitizeDirectories(config.libraries);
    applyEnvOverrides(config);
  } catch (e) {
    log('ERROR', 'SERVER', `Bad config.json; using defaults. ${e.message}`);
    Object.keys(config).forEach(k => delete config[k]);
    Object.assign(config, DEFAULT_CONFIG);
    applyEnvOverrides(config);
  }

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
  const dirs = (config.libraries || []).map(lib => lib.path);
  if (config.comicsLocation && !dirs.includes(config.comicsLocation)) {
    dirs.push(config.comicsLocation);
  }
  return dirs;
}

function getLibraries() {
  return config.libraries || [];
}

function setLibraries(newLibraries, skipSave = false) {
  config.libraries = sanitizeDirectories(newLibraries);
  if (!skipSave) {
    saveConfigToDisk();
  }
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

function getPublicLibraries() {
  return getPublicLibs(config.libraries);
}

function getPathFromLibraryId(libId) {
  return getPathFromLibId(getLibraries(), libId);
}

function getLibraryIdFromPath(absolutePath) {
  return getLibIdFromPath(getLibraries(), absolutePath);
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

function sanitizePageCacheMb(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_MAX_PAGE_CACHE_MB;
  }
  return Math.min(PAGE_CACHE_MAX_MB, Math.max(PAGE_CACHE_MIN_MB, Math.round(numeric)));
}

function getPageCacheMaxMb() {
  return sanitizePageCacheMb(config.pageCacheMaxMb);
}

function setPageCacheMaxMb(value, skipSave = false) {
  const sanitized = sanitizePageCacheMb(value);
  config.pageCacheMaxMb = sanitized;
  if (!skipSave) {
    saveConfigToDisk();
  }
  return sanitized;
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

function getDeleteCbrAfterConversion() {
  return config.delete_cbr_after_conversion === true;
}

function setDeleteCbrAfterConversion(value, skipSave = false) {
  const sanitized = value === true || value === 'true' || value === 'delete';
  config.delete_cbr_after_conversion = sanitized;
  if (!skipSave) {
    saveConfigToDisk();
  }
  return sanitized;
}

function getDeletePdfAfterConversion() {
  return config.delete_pdf_after_conversion === true;
}

function setDeletePdfAfterConversion(value, skipSave = false) {
  const sanitized = value === true || value === 'true' || value === 'delete';
  config.delete_pdf_after_conversion = sanitized;
  if (!skipSave) {
    saveConfigToDisk();
  }
  return sanitized;
}

function getMetadataStorage() {
  return config.metadata_storage || 'archive';
}

function setMetadataStorage(value, skipSave = false) {
  const allowed = ['archive', 'db', 'sidecar'];
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
    enabled: config.cors.enabled !== false,
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

const taggerAccessors = createTaggerConfigAccessors(config, saveConfigToDisk);

module.exports = {
  DEFAULT_CONFIG,
  loadConfigFromDisk,
  getConfig,
  getComicsDirectories,
  getLibraries,
  setLibraries,
  getPublicLibraries,
  getPathFromLibraryId,
  getLibraryIdFromPath,
  addLibrary,
  removeLibrary,
  saveConfigToDisk,
  getScanIntervalMs,
  getScanIntervalMinutes,
  setScanIntervalMinutes,
  getPageCacheMaxMb,
  setPageCacheMaxMb,
  getComicsLocation,
  setComicsLocation,
  getAllowedFormats,
  setAllowedFormats,
  getDeleteCbrAfterConversion,
  setDeleteCbrAfterConversion,
  getDeletePdfAfterConversion,
  setDeletePdfAfterConversion,
  getMetadataStorage,
  setMetadataStorage,
  getCorsConfig,
  getAuthConfig,
  isAuthEnabled,
  getAdminEmail,
  getCloudflareConfig,
  getTrustedIPs,
  ...taggerAccessors
};
