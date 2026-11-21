const path = require('path');
const sharp = require('sharp');

const logoCache = new Map();

function normalizeKey(pubLogoDir) {
  if (!pubLogoDir || typeof pubLogoDir !== 'string') {
    throw new TypeError('pubLogoDir is required');
  }
  return path.resolve(pubLogoDir);
}

function assertSafeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new TypeError('filename is required');
  }
  if (filename.includes('\0') || filename.includes('..')) {
    throw new Error('Invalid filename');
  }
  if (filename !== path.basename(filename)) {
    throw new Error('Nested filename paths are not allowed');
  }
}

function buildBaseUrl(pubLogoDir, filename, options = {}) {
  const dir = encodeURIComponent(path.basename(pubLogoDir));
  const file = encodeURIComponent(filename);
  return options.baseUrl || `/logos/${dir}/${file}`;
}

async function computeContrast(filePath) {
  const fallback = {
    needsLightBackground: false,
    needsDarkBackground: true,
    brightness: 255
  };

  try {
    const { data, info } = await sharp(filePath, { failOn: 'none' })
      .resize(64, 64, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels || 4;
    let totalLuma = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += channels) {
      const alpha = channels >= 4 ? data[i + 3] : 255;
      if (alpha < 16) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      totalLuma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
    }

    const brightness = count > 0 ? totalLuma / count : fallback.brightness;

    return {
      needsLightBackground: brightness < 128,
      needsDarkBackground: brightness >= 128,
      brightness
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.message
    };
  }
}

async function setLogo(pubLogoDir, filename, options = {}) {
  const key = normalizeKey(pubLogoDir);
  assertSafeFilename(filename);

  const existing = logoCache.get(key);
  const version = (existing && existing.version ? existing.version : 0) + 1;
  const filePath = path.join(key, filename);
  const contrast = await computeContrast(filePath);

  const entry = {
    baseUrl: buildBaseUrl(key, filename, options),
    filename,
    version,
    needsLightBackground:
      options.needsLightBackground ?? contrast.needsLightBackground,
    needsDarkBackground:
      options.needsDarkBackground ?? contrast.needsDarkBackground,
    brightness: contrast.brightness,
    updatedAt: Date.now(),
    source: options.source || 'manual'
  };

  logoCache.set(key, entry);
  return entry;
}

function getLogo(pubLogoDir) {
  const entry = logoCache.get(normalizeKey(pubLogoDir));
  if (!entry) return null;
  return {
    baseUrl: entry.baseUrl,
    version: entry.version,
    filename: entry.filename,
    needsLightBackground: entry.needsLightBackground,
    needsDarkBackground: entry.needsDarkBackground,
    brightness: entry.brightness,
    updatedAt: entry.updatedAt,
    source: entry.source
  };
}

function invalidateLogo(pubLogoDir) {
  const key = normalizeKey(pubLogoDir);
  const entry = logoCache.get(key);
  if (!entry) return null;

  entry.version += 1;
  entry.updatedAt = Date.now();
  logoCache.set(key, entry);

  return {
    baseUrl: entry.baseUrl,
    version: entry.version,
    filename: entry.filename,
    needsLightBackground: entry.needsLightBackground,
    needsDarkBackground: entry.needsDarkBackground,
    brightness: entry.brightness,
    updatedAt: entry.updatedAt,
    source: entry.source
  };
}

function clearAll() {
  logoCache.clear();
}

module.exports = {
  getLogo,
  setLogo,
  invalidateLogo,
  clearAll,
  _logoCache: logoCache
};
