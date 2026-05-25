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
    if (!metadata) {
      return false;
    }
    const format = (metadata.format || '').toLowerCase();
    if (format !== 'png' && format !== 'svg' && format !== 'webp') {
      return false;
    }
    if (!metadata.hasAlpha) {
      return false;
    }
    
    // Get raw pixel data
    const { data } = await image.raw().toBuffer({ resolveWithObject: true });
    
    let totalBrightness = 0;
    let visiblePixelCount = 0;
    
    // Every pixel is 4 bytes (RGBA) in raw format
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      if (a > 15) { // Only count pixels that are not fully transparent
        // Standard perceived brightness formula:
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        totalBrightness += brightness;
        visiblePixelCount++;
      }
    }
    
    if (visiblePixelCount === 0) {
      return false;
    }
    
    const avgBrightness = totalBrightness / visiblePixelCount;
    // If the average brightness of the visible pixels is dark (less than 120 out of 255),
    // it needs a light background to be visible on our dark theme.
    return avgBrightness < 120;
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
