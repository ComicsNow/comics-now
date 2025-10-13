const fs = require('fs');
const path = require('path');
const { CONFIG_FILE } = require('./constants');
const { log } = require('./logger');

const DEFAULT_CONFIG = {
  port: 3000,
  baseUrl: '/',
  comictaggerPath: '/usr/local/bin/comictagger',
  comicsLocation: '/comics',
  comicsDirectories: ['/comics']
};

let config = { ...DEFAULT_CONFIG };
let comicsDirectories = [];
let scanIntervalMs = 300000; // 5 minutes
let comicVineApiKey = 'YOUR_API_KEY_HERE';
let ctScheduleMinutes = 60;

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
    const normalized = normalizeDirectory(entry);
    if (normalized && !seen.has(normalized)) {
      sanitized.push(normalized);
      seen.add(normalized);
    }
  }
  return sanitized;
}

function setComicsDirectories(dirs) {
  comicsDirectories = sanitizeDirectories(dirs);
  config.comicsDirectories = [...comicsDirectories];
  return comicsDirectories;
}

function ensureConfigFileExists() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    log('INFO', 'SERVER', `Created default config at ${CONFIG_FILE}`);
  }
}

function loadConfigFromDisk() {
  ensureConfigFileExists();

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    config = { ...DEFAULT_CONFIG, ...parsed };
  } catch (e) {
    log('ERROR', 'SERVER', `Bad config.json; using defaults. ${e.message}`);
    config = { ...DEFAULT_CONFIG };
  }

  setComicsDirectories(config.comicsDirectories || []);
  if (comicsDirectories.length === 0) {
    const normalizedBaseDir = normalizeDirectory(config.comicsLocation);
    if (normalizedBaseDir) {
      comicsDirectories = [normalizedBaseDir];
      config.comicsDirectories = [...comicsDirectories];
      log('WARN', 'SERVER', 'No comicsDirectories configured; defaulting to comicsLocation for library scans.');
    } else {
      log('WARN', 'SERVER', 'No comics directories configured; library scans are disabled.');
    }
  }

  return config;
}

function getConfig() {
  return config;
}

function getComicsDirectories() {
  return comicsDirectories;
}

function getScanIntervalMs() {
  return scanIntervalMs;
}

function getScanIntervalMinutes() {
  return Math.max(1, Math.round(scanIntervalMs / 60000));
}

function setScanIntervalMinutes(minutes) {
  const sanitized = Math.max(1, parseInt(minutes, 10) || 5);
  scanIntervalMs = sanitized * 60 * 1000;
  return scanIntervalMs;
}

function getComicVineApiKey() {
  return comicVineApiKey;
}

function setComicVineApiKey(key) {
  comicVineApiKey = key || '';
}

function getCtScheduleMinutes() {
  return ctScheduleMinutes;
}

function setCtScheduleMinutes(minutes) {
  ctScheduleMinutes = Math.max(0, parseInt(minutes, 10) || 0);
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

module.exports = {
  DEFAULT_CONFIG,
  loadConfigFromDisk,
  getConfig,
  setComicsDirectories,
  getComicsDirectories,
  normalizeDirectory,
  sanitizeDirectories,
  getScanIntervalMs,
  getScanIntervalMinutes,
  setScanIntervalMinutes,
  getComicVineApiKey,
  setComicVineApiKey,
  getCtScheduleMinutes,
  setCtScheduleMinutes,
  getCorsConfig,
  getAuthConfig,
  isAuthEnabled,
  getAdminEmail,
  getCloudflareConfig,
  getTrustedIPs
};
