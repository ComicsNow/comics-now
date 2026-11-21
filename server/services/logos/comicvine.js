const path = require('path');
const fs = require('fs/promises');

const { cvFetchJson } = require('../comicvine');
const { COMICVINE_API_URL } = require('../../constants');
const { getConfig, getComicVineApiKey } = require('../../config');
const cryptoVault = require('../../utils/crypto-vault');
const settings = require('../../settings');

const cache = require('./cache');
const sanitizer = require('./sanitizer');

const inflightFetches = new Map();

function normalizePublisherName(name) {
  return String(name || '').trim().toLowerCase();
}

function slugify(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'publisher';

  return slug;
}

function getExtensionFromUrl(url) {
  const cleanUrl = String(url || '').split('?')[0].toLowerCase();
  const ext = path.extname(cleanUrl);

  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }

  return '.jpg';
}

function isPlaceholderImage(url) {
  if (!url || typeof url !== 'string') return true;
  const cleanUrl = url.split('?')[0].toLowerCase();
  const basename = path.basename(cleanUrl);
  return /blank\.(png|jpe?g|gif|webp)$/i.test(basename) || /default[-_]avatar|no[-_]image|placeholder/i.test(basename);
}

function getPublisherImageUrl(publisher) {
  const image = publisher && publisher.image ? publisher.image : {};
  const url = image.original_url || image.super_url || image.small_url;
  if (!url || isPlaceholderImage(url)) return null;
  return url;
}

async function getApiKey() {
  const settingsKey = settings && typeof settings.get === 'function' ? settings.get('comicVineApiKey') : null;
  if (settingsKey) {
    const decrypted = cryptoVault.decrypt(settingsKey) || settingsKey;
    if (decrypted) return decrypted;
  }
  if (typeof getComicVineApiKey === 'function') {
    const key = getComicVineApiKey();
    if (key) return key;
  }
  const config = typeof getConfig === 'function' ? getConfig() : {};
  const rawKey = config.comicVineApiKey || process.env.COMICVINE_API_KEY;
  if (!rawKey) throw new Error('ComicVine API key is not configured');
  const decrypted = cryptoVault.decrypt(rawKey) || rawKey;
  if (!decrypted) throw new Error('ComicVine API key is not configured');
  return decrypted;
}

async function downloadImageBuffer(url) {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('global fetch is required to download ComicVine images');
  }

  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ComicVine image: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function fetchPublisherLogo(publisherName, pubLogoDir, options = {}) {
  const normalizedPublisher = normalizePublisherName(publisherName);
  if (!normalizedPublisher) {
    return Promise.reject(new Error('Publisher name is required'));
  }

  const resolvedDestDir = path.resolve(pubLogoDir);
  const flightKey = `${normalizedPublisher}:${resolvedDestDir}`;

  if (inflightFetches.has(flightKey)) {
    return inflightFetches.get(flightKey);
  }

  const operation = (async () => {
    try {
      let apiKey;
      try {
        apiKey = await getApiKey();
      } catch {
        return { skipped: true, reason: 'missing_api_key' };
      }
      if (!apiKey) {
        return { skipped: true, reason: 'missing_api_key' };
      }

      const initialCacheEntry = cache.getLogo(resolvedDestDir);
      const initialVersion = initialCacheEntry ? initialCacheEntry.version : 0;

      const comicVineBase = COMICVINE_API_URL.replace(/\/$/, '');
      const endpoint = `${comicVineBase}/publishers/?api_key=${encodeURIComponent(
        apiKey
      )}&filter=name:${encodeURIComponent(
        publisherName
      )}&field_list=id,name,image&format=json`;

      const data = await cvFetchJson(endpoint);
      const results = data && (data.results || data);
      const publisher = results && Array.isArray(results) ? results[0] : results;
      if (!publisher) {
        return { skipped: true, reason: 'publisher_not_found' };
      }

      const imageUrl = getPublisherImageUrl(publisher);
      if (!imageUrl) {
        return { skipped: true, reason: 'no_image_url' };
      }

      const imageBuffer = await downloadImageBuffer(imageUrl);
      const detected = sanitizer.sniffImageFormat ? sanitizer.sniffImageFormat(imageBuffer) : null;
      const extension = detected ? detected.ext : getExtensionFromUrl(imageUrl);
      const safeFilename = `${slugify(publisherName)}${extension}`;
      const tempFilename = `.${safeFilename}.comicvine-download-${Date.now()}.tmp`;
      const sanitized = sanitizer.sanitizeLogo(imageBuffer, resolvedDestDir, safeFilename);
      if (!sanitized || !sanitized.ok) {
        return {
          skipped: true,
          reason: sanitized?.reason || 'sanitization_failed'
        };
      }

      const cacheBeforeWrite = cache.getLogo(resolvedDestDir);
      if (cacheBeforeWrite && cacheBeforeWrite.version !== initialVersion) {
        return {
          skipped: true,
          reason: 'manual_upload_version_changed',
          version: cacheBeforeWrite.version
        };
      }

      const entry = await cache.setLogo(resolvedDestDir, safeFilename, {
        source: 'comicvine'
      });

      return {
        stored: true,
        filename: safeFilename,
        baseUrl: entry.baseUrl,
        version: entry.version,
        needsLightBackground: entry.needsLightBackground,
        needsDarkBackground: entry.needsDarkBackground,
        source: entry.source
      };
    } finally {
      inflightFetches.delete(flightKey);
    }
  })();

  inflightFetches.set(flightKey, operation);
  return operation;
}

function clearInflightFetches() {
  inflightFetches.clear();
}

async function previewPublisherLogo(publisherName) {
  const normalizedPublisher = normalizePublisherName(publisherName);
  if (!normalizedPublisher) {
    return { success: false, reason: 'Publisher name is required' };
  }
  let apiKey;
  try {
    apiKey = await getApiKey();
  } catch {
    return { success: false, reason: 'ComicVine API key is not configured' };
  }
  if (!apiKey) {
    return { success: false, reason: 'ComicVine API key is not configured' };
  }

  const comicVineBase = COMICVINE_API_URL.replace(/\/$/, '');
  const endpoint = `${comicVineBase}/publishers/?api_key=${encodeURIComponent(
    apiKey
  )}&filter=name:${encodeURIComponent(
    publisherName
  )}&field_list=id,name,image&format=json`;

  const data = await cvFetchJson(endpoint);
  const results = data && (data.results || data);
  const publisher = results && Array.isArray(results) ? results[0] : results;
  if (!publisher) {
    return { success: false, reason: `Publisher not found on ComicVine for "${publisherName}"` };
  }

  const imageUrl = getPublisherImageUrl(publisher);
  if (!imageUrl) {
    return { success: false, reason: `No logo available on ComicVine for "${publisherName}"` };
  }

  const imageBuffer = await downloadImageBuffer(imageUrl);
  const detected = sanitizer.sniffImageFormat ? sanitizer.sniffImageFormat(imageBuffer) : null;
  const ext = detected ? detected.ext : getExtensionFromUrl(imageUrl);
  const magic = sanitizer.validateMagicBytes(imageBuffer, ext);
  if (!magic.ok) {
    return { success: false, reason: magic.reason || 'Invalid image format from ComicVine' };
  }

  const mimeType = detected ? detected.mimeType : (ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : (ext === '.gif' ? 'image/gif' : 'image/jpeg')));

  return {
    success: true,
    base64: imageBuffer.toString('base64'),
    mimeType,
    extension: ext,
    sourceUrl: imageUrl
  };
}

module.exports = {
  downloadImageBuffer,
  cvFetchJson,
  fetchPublisherLogo,
  previewPublisherLogo,
  clearInflightFetches,
  inflightFetches
};
