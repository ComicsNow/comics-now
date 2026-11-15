const path = require('path');

const ALL_COMIC_FORMATS = Object.freeze(['cbz', 'cbr', 'pdf', 'epub']);
const SUPPORTED_COMIC_EXTENSIONS = Object.freeze(['.cbz', '.cbr', '.pdf', '.epub']);
const CONVERTIBLE_COMIC_FORMATS = Object.freeze(['cbr', 'pdf', 'epub']);

/**
 * Normalize an allowedFormats setting (legacy string, CSV, or array) into a
 * deduplicated list of supported comic format identifiers.
 */
function normalizeAllowedFormats(allowedFormats = 'cbz') {
  if (Array.isArray(allowedFormats)) {
    const valid = [];
    for (const item of allowedFormats) {
      const norm = String(item || '').trim().toLowerCase();
      if (ALL_COMIC_FORMATS.includes(norm) && !valid.includes(norm)) {
        valid.push(norm);
      }
    }
    return valid.length > 0 ? valid : ['cbz'];
  }

  const raw = String(allowedFormats || 'cbz').trim().toLowerCase();
  if (raw === 'both') return ['cbz', 'cbr'];
  if (raw === 'all') return [...ALL_COMIC_FORMATS];
  if (raw.includes(',')) {
    return normalizeAllowedFormats(raw.split(','));
  }
  return ALL_COMIC_FORMATS.includes(raw) ? [raw] : ['cbz'];
}

/**
 * Read-side visibility check for the Allowed Library Formats setting.
 * Unknown or extensionless names stay visible.
 */
function isComicFormatAllowed(fileNameOrPath, allowedFormats = 'cbz') {
  const ext = path.extname(String(fileNameOrPath || '')).toLowerCase();
  if (!SUPPORTED_COMIC_EXTENSIONS.includes(ext)) return true;

  const allowed = normalizeAllowedFormats(allowedFormats);
  return allowed.includes(ext.slice(1));
}

module.exports = {
  ALL_COMIC_FORMATS,
  SUPPORTED_COMIC_EXTENSIONS,
  CONVERTIBLE_COMIC_FORMATS,
  normalizeAllowedFormats,
  isComicFormatAllowed
};
