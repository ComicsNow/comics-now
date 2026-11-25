'use strict';

const path = require('path');
const fs = require('fs');

const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

function bufferStartsWith(buffer, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function normalizeExtension(extension) {
  let ext = String(extension || '').toLowerCase().trim();
  if (ext && !ext.startsWith('.')) ext = `.${ext}`;
  return ext;
}

function looksLikeSvg(input) {
  let text;
  if (Buffer.isBuffer(input)) {
    if (input.indexOf(0) !== -1) return false;
    text = input.toString('utf8');
  } else {
    text = String(input);
  }

  text = text.replace(/^\uFEFF/, '').trimStart();
  text = text.replace(/^<\?xml[^?]*\?>\s*/i, '');
  return /^<svg(?:\s|>)/i.test(text);
}

function validateMagicBytes(buffer, extension) {
  const ext = normalizeExtension(extension);

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, reason: 'Invalid or empty buffer.' };
  }

  if (ext === '.svg') {
    if (looksLikeSvg(buffer)) {
      return { ok: true, mimeType: MIME_BY_EXTENSION['.svg'] };
    }
    return { ok: false, reason: 'SVG content must start with an <svg> tag and be valid XML/SVG text.' };
  }

  if (ext === '.png') {
    const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bufferStartsWith(buffer, PNG_MAGIC)) {
      return { ok: true, mimeType: MIME_BY_EXTENSION['.png'] };
    }
    return { ok: false, reason: 'PNG magic bytes do not match.' };
  }

  if (ext === '.jpg' || ext === '.jpeg') {
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { ok: true, mimeType: MIME_BY_EXTENSION['.jpg'] };
    }
    return { ok: false, reason: 'JPEG magic bytes do not match.' };
  }

  if (ext === '.webp') {
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { ok: true, mimeType: MIME_BY_EXTENSION['.webp'] };
    }
    return { ok: false, reason: 'WebP magic bytes do not match.' };
  }

  if (ext === '.gif') {
    if (
      buffer.length >= 6 &&
      (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
    ) {
      return { ok: true, mimeType: MIME_BY_EXTENSION['.gif'] };
    }
    return { ok: false, reason: 'GIF magic bytes do not match.' };
  }

  return { ok: false, reason: `Unsupported extension: ${ext || '(none)'}` };
}

function sniffImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bufferStartsWith(buffer, PNG_MAGIC)) {
    return { ext: '.png', mimeType: MIME_BY_EXTENSION['.png'] };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', mimeType: MIME_BY_EXTENSION['.jpg'] };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: '.webp', mimeType: MIME_BY_EXTENSION['.webp'] };
  }

  if (
    buffer.length >= 6 &&
    (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return { ext: '.gif', mimeType: MIME_BY_EXTENSION['.gif'] };
  }

  if (looksLikeSvg(buffer)) {
    return { ext: '.svg', mimeType: MIME_BY_EXTENSION['.svg'] };
  }

  return null;
}

function decodeHtmlEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  return String(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => named[name.toLowerCase()]);
}

function removeDangerousTags(svg) {
  let prev;
  let result = svg;
  const tagRe = /<(script|foreignObject|iframe|object|embed|animate|set|handler|listener)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const selfClosingRe = /<(script|foreignObject|iframe|object|embed|animate|set|handler|listener)\b[^>]*\/?>/gi;
  do {
    prev = result;
    result = result.replace(tagRe, '').replace(selfClosingRe, '');
  } while (result !== prev);
  return result;
}

function removeDangerousStyleBlocks(svg) {
  return svg.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (match, body) => {
    return /@import|\burl\s*\(/i.test(decodeHtmlEntities(body)) ? '' : match;
  });
}

function isDangerousUrl(value) {
  const decoded = decodeHtmlEntities(value);
  const compact = decoded.replace(/[\x00-\x20\x7f-\x9f]+/g, '').toLowerCase();
  return compact.startsWith('javascript:') || compact.startsWith('data:') || compact.startsWith('vbscript:');
}

function sanitizeAttributes(svg) {
  return svg.replace(/\s+([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, name, value) => {
    const decodedName = decodeHtmlEntities(name).toLowerCase();

    if (/^on/.test(decodedName)) return '';

    const rawValue =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        ? value.slice(1, -1)
        : value;

    if (isDangerousUrl(rawValue)) return '';

    return match;
  });
}

function sanitizeSvg(svgStringOrBuffer) {
  let svg = Buffer.isBuffer(svgStringOrBuffer) ? svgStringOrBuffer.toString('utf8') : String(svgStringOrBuffer);

  svg = svg.replace(/<!DOCTYPE[^>]*>/gi, '');
  svg = svg.replace(/<!ENTITY[^>]*>/gi, '');
  svg = removeDangerousTags(svg);
  svg = removeDangerousStyleBlocks(svg);
  svg = sanitizeAttributes(svg);

  return svg;
}

function resolveSafeLogoPath(baseDir, filename) {
  if (typeof baseDir !== 'string' || typeof filename !== 'string' || filename.length === 0) {
    throw new Error('Invalid base directory or filename.');
  }

  let decoded = filename;
  try { decoded = decodeURIComponent(filename); } catch (_) {}
  const normalized = decoded.split('\\').join('/');

  if (normalized.includes('\0') || decoded.includes('\0') || filename.includes('\0')) {
    throw new Error('Filename contains null bytes.');
  }

  if (normalized.includes('..') || decoded.includes('..') || filename.includes('..')) {
    throw new Error('Path escapes the base directory.');
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(resolvedBase, normalized);
  const relative = path.relative(resolvedBase, resolvedPath);

  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Path escapes the base directory.');
  }

  return resolvedPath;
}

function sanitizeLogo(buffer, destDir, filename) {
  if (typeof filename !== 'string' || filename.length === 0) {
    return { ok: false, reason: 'Invalid filename.' };
  }

  if (filename.includes('\0')) {
    return { ok: false, reason: 'Filename contains null bytes.' };
  }

  const extension = path.extname(filename).toLowerCase();
  const validation = validateMagicBytes(buffer, extension);
  if (!validation.ok) return validation;

  let content = buffer;
  if (extension === '.svg') {
    content = Buffer.from(sanitizeSvg(buffer), 'utf8');
  }

  let safePath;
  try {
    safePath = resolveSafeLogoPath(destDir, filename);
  } catch (error) {
    return { ok: false, reason: error.message };
  }

  try {
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, content);
    return { ok: true, mimeType: validation.mimeType, path: safePath };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

module.exports = {
  validateMagicBytes,
  sniffImageFormat,
  sanitizeSvg,
  resolveSafeLogoPath,
  sanitizeLogo,
};
