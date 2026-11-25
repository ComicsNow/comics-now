const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { dbAll } = require('../../db');
const { LOGOS_DIRECTORY } = require('../../constants');
const { safeDirName, isImage } = require('../../utils');
const sanitizer = require('../../services/logos/sanitizer');
const libraryLogos = require('../../services/library-logos');
const cache = require('../../services/logos/cache');
const comicvine = require('../../services/logos/comicvine');

const router = express.Router();

const MAX_LOGO_BYTES = 10 * 1024 * 1024;

function buildLogoUrl(safeName, filename) {
  return `/logos/${encodeURIComponent(safeName)}/${encodeURIComponent(filename)}`;
}

function getPubDir(publisher) {
  const safeName = safeDirName(publisher);
  return path.join(LOGOS_DIRECTORY, safeName);
}

async function clearExistingLogos(pubDir, excludeFiles = []) {
  try {
    const files = await fs.readdir(pubDir);
    const excludeSet = new Set(excludeFiles);
    await Promise.all(
      files
        .filter((file) => !excludeSet.has(file) && (isImage(file) || file.toLowerCase().endsWith('.svg') || /^logo\./i.test(file)))
        .map((file) => fs.unlink(path.join(pubDir, file)).catch(() => {})),
    );
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function ensureCanonicalLogo(pubDir, incomingFilename) {
  await fs.mkdir(pubDir, { recursive: true });
  if (!incomingFilename) return null;

  const ext = path.extname(incomingFilename).slice(1).toLowerCase() || 'png';
  const canonical = `logo.${ext}`;
  const files = await fs.readdir(pubDir);

  for (const file of files) {
    if ((isImage(file) || file.toLowerCase().endsWith('.svg') || /^logo\./i.test(file)) && file !== canonical && file !== incomingFilename) {
      await fs.unlink(path.join(pubDir, file)).catch(() => {});
    }
  }

  if (incomingFilename !== canonical) {
    try {
      await fs.rm(path.join(pubDir, canonical), { force: true }).catch(() => {});
      await fs.rename(path.join(pubDir, incomingFilename), path.join(pubDir, canonical));
    } catch (_) {}
  }

  return canonical;
}

async function getCurrentLogo(pubDir) {
  try {
    const files = await fs.readdir(pubDir);
    const sorted = files.filter((f) => !f.startsWith('.')).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const prefer = sorted.find((file) => /^logo\./i.test(file) && (isImage(file) || file.toLowerCase().endsWith('.svg')));
    const filename = prefer || sorted.find((file) => isImage(file) || file.toLowerCase().endsWith('.svg')) || null;
    if (!filename) return null;

    let cached = null;
    try {
      cached = cache.getLogo(pubDir);
    } catch {
      cached = null;
    }
    return { filename, cached };
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await dbAll(
      `SELECT DISTINCT publisher FROM comics WHERE publisher IS NOT NULL AND TRIM(publisher) != '' ORDER BY publisher COLLATE NOCASE ASC`,
    );

    const publishers = await Promise.all(
      rows.map(async ({ publisher }) => {
        const safeName = safeDirName(publisher);
        const pubDir = path.join(LOGOS_DIRECTORY, safeName);
        const current = await getCurrentLogo(pubDir);
        const filename = current?.filename || null;
        const cached = current?.cached || null;
        const url = filename ? buildLogoUrl(safeName, filename) : null;
        const dimensions =
          cached?.dimensions ||
          (cached?.width && cached?.height ? { width: cached.width, height: cached.height } : null);

        let needsLightBackground = cached?.needsLightBackground ?? null;
        let needsDarkBackground = cached?.needsDarkBackground ?? null;
        if (filename && (needsLightBackground === null || needsDarkBackground === null)) {
          try {
            const resolved = await libraryLogos.resolveLogo(pubDir);
            needsLightBackground = resolved?.needsBackground ?? false;
            needsDarkBackground = resolved?.needsDarkBackground ?? false;
          } catch (_) {
            needsLightBackground = false;
            needsDarkBackground = false;
          }
        }

        return {
          publisher,
          safeName,
          hasLogo: Boolean(filename),
          filename,
          url,
          version: cached?.version || null,
          format: cached?.format || (filename ? path.extname(filename).slice(1).toLowerCase() : null),
          dimensions,
          needsLightBackground,
          needsDarkBackground,
        };
      }),
    );

    res.json({ publishers });
  } catch (err) {
    next(err);
  }
});

router.post('/upload', async (req, res, next) => {
  try {
    const { publisher, data, filename } = req.body || {};

    if (!publisher?.trim()) {
      return res.status(400).json({ error: 'publisher is required' });
    }

    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'data Base64 string is required' });
    }

    const cleanBase64 = data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (!buffer.length) {
      return res.status(400).json({ error: 'Invalid Base64 image data' });
    }

    if (buffer.length > MAX_LOGO_BYTES) {
      return res.status(400).json({ error: 'Logo image must be smaller than 10 MB' });
    }

    const detected = sanitizer.sniffImageFormat ? sanitizer.sniffImageFormat(buffer) : null;
    const ext = (detected ? detected.ext : (path.extname(filename || '') || '.png')).replace(/^\./, '').toLowerCase();
    const magicResult = sanitizer.validateMagicBytes(buffer, '.' + ext);
    if (!magicResult.ok) {
      return res.status(400).json({ error: magicResult.reason });
    }

    const pubDir = getPubDir(publisher);
    await fs.mkdir(pubDir, { recursive: true });

    const targetFilename = `logo.${ext}`;
    const tempFilename = `.tmp_logo_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const sanitizeResult = sanitizer.sanitizeLogo(buffer, pubDir, tempFilename);
    if (!sanitizeResult || !sanitizeResult.ok) {
      try { await fs.unlink(path.join(pubDir, tempFilename)); } catch (_) {}
      return res.status(400).json({ error: sanitizeResult?.reason || 'Failed to sanitize image' });
    }

    await clearExistingLogos(pubDir, [tempFilename]);
    await fs.rename(path.join(pubDir, tempFilename), path.join(pubDir, targetFilename));

    await cache.setLogo(pubDir, targetFilename);
    libraryLogos.invalidatePublisher(publisher);

    return res.json({
      success: true,
      logo: buildLogoUrl(safeDirName(publisher), targetFilename),
      filename: targetFilename,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/fetch', async (req, res, next) => {
  try {
    const { publisher } = req.body || {};
    if (!publisher?.trim()) {
      return res.status(400).json({ error: 'publisher is required' });
    }

    const pubDir = getPubDir(publisher);
    const result = await comicvine.fetchPublisherLogo(publisher, pubDir);

    if (!result?.stored) {
      return res.status(404).json({
        error: result?.reason || 'No logo found on ComicVine for publisher',
      });
    }

    const canonicalFilename = await ensureCanonicalLogo(pubDir, result.filename);
    await cache.setLogo(pubDir, canonicalFilename);
    libraryLogos.invalidatePublisher(publisher);

    return res.json({
      success: true,
      logo: buildLogoUrl(safeDirName(publisher), canonicalFilename),
      filename: canonicalFilename,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:publisher', async (req, res, next) => {
  try {
    const { publisher } = req.params;
    if (!publisher?.trim()) {
      return res.status(400).json({ error: 'publisher is required' });
    }

    const pubDir = getPubDir(publisher);
    await clearExistingLogos(pubDir);
    cache.invalidateLogo(pubDir);
    libraryLogos.invalidatePublisher(publisher);

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/fetch-preview', async (req, res, next) => {
  try {
    const { publisher } = req.body || {};
    if (!publisher?.trim()) {
      return res.status(400).json({ error: 'publisher is required' });
    }

    const result = await comicvine.previewPublisherLogo(publisher);
    if (!result?.success) {
      return res.status(404).json({
        error: result?.reason || 'No logo found on ComicVine for publisher',
      });
    }

    return res.json({
      success: true,
      publisher,
      base64: result.base64,
      mimeType: result.mimeType,
      extension: result.extension,
      sourceUrl: result.sourceUrl,
      previewUrl: `data:${result.mimeType};base64,${result.base64}`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/save', async (req, res, next) => {
  try {
    const { changes } = req.body || {};
    if (!Array.isArray(changes)) {
      return res.status(400).json({ error: 'changes array is required' });
    }

    const saved = [];
    for (const item of changes) {
      const { publisher, type, data, filename } = item || {};
      if (!publisher?.trim()) continue;

      const pubDir = getPubDir(publisher);
      if (type === 'delete') {
        await clearExistingLogos(pubDir);
        cache.invalidateLogo(pubDir);
        libraryLogos.invalidatePublisher(publisher);
        saved.push({ publisher, action: 'deleted' });
      } else if (type === 'upload' || type === 'fetch') {
        if (!data || typeof data !== 'string') continue;
        const cleanBase64 = data.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        if (!buffer.length || buffer.length > MAX_LOGO_BYTES) continue;

        const detected = sanitizer.sniffImageFormat ? sanitizer.sniffImageFormat(buffer) : null;
        const ext = (detected ? detected.ext : (path.extname(filename || '') || '.png')).replace(/^\./, '').toLowerCase();
        const magicResult = sanitizer.validateMagicBytes(buffer, '.' + ext);
        if (!magicResult.ok) continue;

        await fs.mkdir(pubDir, { recursive: true });
        const targetFilename = `logo.${ext}`;
        const tempFilename = `.tmp_logo_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const sanitizeResult = sanitizer.sanitizeLogo(buffer, pubDir, tempFilename);
        if (!sanitizeResult || !sanitizeResult.ok) {
          try { await fs.unlink(path.join(pubDir, tempFilename)); } catch (_) {}
          saved.push({ publisher, action: 'failed', error: sanitizeResult?.reason || 'Failed to sanitize image' });
          continue;
        }

        await clearExistingLogos(pubDir, [tempFilename]);
        await fs.rename(path.join(pubDir, tempFilename), path.join(pubDir, targetFilename));

        await cache.setLogo(pubDir, targetFilename);
        libraryLogos.invalidatePublisher(publisher);
        saved.push({
          publisher,
          action: 'saved',
          logo: buildLogoUrl(safeDirName(publisher), targetFilename),
          filename: targetFilename,
        });
      }
    }

    return res.json({ success: true, count: saved.length, results: saved });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
