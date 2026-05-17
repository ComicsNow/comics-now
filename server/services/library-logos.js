const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { log } = require('../logger');
const { isImage } = require('../utils');

const LOGO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const logoCache = new Map();

async function findLogoFileIn(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const prefer = files.find(n => /^logo\./i.test(n) && (isImage(n) || n.toLowerCase().endsWith('.svg')));
    if (prefer) return prefer;

    const any = files.find(n => isImage(n) || n.toLowerCase().endsWith('.svg'));
    return any || null;
  } catch {
    return null;
  }
}

async function logoNeedsBackground(fullPath) {
  try {
    const image = sharp(fullPath);
    const metadata = await image.metadata();
    if (!metadata || (metadata.format || '').toLowerCase() !== 'png') {
      return false;
    }
    if (!metadata.hasAlpha) {
      return false;
    }
    const stats = await image.clone().stats();
    const alphaChannel = Array.isArray(stats?.channels) ? stats.channels[stats.channels.length - 1] : null;
    if (!alphaChannel) {
      return false;
    }
    return alphaChannel.min < 255;
  } catch (err) {
    log('ERROR', 'LOGOS', `Failed to inspect logo ${fullPath}: ${err.message}`);
    return false;
  }
}

async function resolveLogo(pubLogoDir) {
  const now = Date.now();
  const cached = logoCache.get(pubLogoDir);
  if (cached && cached.expiresAt > now) {
    return { logoFile: cached.logoFile, needsBackground: cached.needsBackground };
  }
  const logoFile = await findLogoFileIn(pubLogoDir);
  let needsBackground = false;
  if (logoFile) {
    needsBackground = await logoNeedsBackground(path.join(pubLogoDir, logoFile));
  }
  logoCache.set(pubLogoDir, { logoFile, needsBackground, expiresAt: now + LOGO_CACHE_TTL_MS });
  return { logoFile, needsBackground };
}

module.exports = {
  resolveLogo
};
