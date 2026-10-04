const fs = require('fs');
const path = require('path');

// Collapses concurrent transcodes of the same page (e.g. preload bursts) into a
// single sharp run. Keyed by WebP cache key; entries are removed once settled.
const inFlightTranscodes = new Map();

/**
 * User Pages Routes
 *
 * Handles comic page listing, image serving, and downloads.
 */
module.exports = function attach(router, deps) {
  const {
    dbGet,
    dbRun,
    log,
    formatErrorMessage,
    isPathSafe,
    resolvePath,
    checkComicAccess,
    getComicsDirectories,
    getComicPages,
    createId,
    getMimeFromExt,
    requireAuth
  } = deps;

  function getQueryParamString(param) {
    if (Array.isArray(param)) {
      param = param[0];
    }
    return typeof param === 'string' ? param : '';
  }

  // Serve a comic's guided-view sidecar (panel coordinates).
  router.get('/api/v1/comics/:id/guided-view', requireAuth, async (req, res) => {
    try {
      const row = await dbGet(
        'SELECT id, path, publisher, series, guidedViewStatus, guidedViewPath FROM comics WHERE id = ?',
        [req.params.id]
      );
      if (!row) return res.status(404).json({ ok: false, message: 'Comic not found' });

      // Security: Validate user has access to this comic
      const hasAccess = await checkComicAccess(
        req.user?.userId,
        req.user?.role,
        row.path,
        row.publisher,
        row.series,
        getComicsDirectories(),
        row.id
      );
      if (!hasAccess) {
        return res.status(403).json({ ok: false, message: 'Access denied' });
      }

      if (row.guidedViewStatus !== 'completed' || !row.guidedViewPath) {
        return res.status(404).json({ ok: false, message: 'Guided view not available' });
      }
      if (!fs.existsSync(row.guidedViewPath)) {
        return res.status(404).json({ ok: false, message: 'Guided view file missing' });
      }
      // Revalidate so editor saves are visible immediately (no cached hour).
      const stat = fs.statSync(row.guidedViewPath);
      const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', stat.mtime.toUTCString());
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.setHeader('Content-Type', 'application/json');
      fs.createReadStream(row.guidedViewPath).pipe(res);
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to load guided view') });
    }
  });

  router.get('/api/v1/comics/pages', async (req, res) => {
    try {
      const rawPath = Buffer.from(getQueryParamString(req.query.path), 'base64').toString('utf-8');
      const p = resolvePath(rawPath);

      // Security: Validate path is within allowed directories
      if (!isPathSafe(p)) {
        return res.status(403).json({ pages: [], error: 'Access denied' });
      }

      // Security: Validate user has access to this specific comic
      const comic = await dbGet('SELECT id, publisher, series FROM comics WHERE path = ?', [p]);
      if (comic) {
        const hasAccess = await checkComicAccess(
          req.user.userId,
          req.user.role,
          p,
          comic.publisher,
          comic.series,
          getComicsDirectories(),
          comic.id
        );
        if (!hasAccess) {
          log('WARN', 'SECURITY', `User ${req.user.userId} denied access to comic pages: ${p}`);
          return res.status(403).json({ pages: [], error: 'Access denied' });
        }
      }

      if (!p || !fs.existsSync(p)) return res.json({ pages: [] });
      const pages = await getComicPages(p);
      const id = createId(p);
      await dbRun('UPDATE comics SET totalPages = ? WHERE id = ?', [pages.length, id]).catch(() => {});
      res.json({ pages });
    } catch (e) {
      log('ERROR', 'SERVER', `/pages failed: ${e.message}`);
      res.json({ pages: [] });
    }
  });

  router.get('/api/v1/comics/pages/image', async (req, res) => {
    try {
      const rawPath = Buffer.from(getQueryParamString(req.query.path), 'base64').toString('utf-8');
      const p = resolvePath(rawPath);

      // Security: Validate path is within allowed directories
      if (!isPathSafe(p)) {
        return res.status(403).end();
      }

      // Security: Validate user has access to this specific comic
      const comic = await dbGet('SELECT id, publisher, series FROM comics WHERE path = ?', [p]);
      if (comic) {
        const hasAccess = await checkComicAccess(
          req.user.userId,
          req.user.role,
          p,
          comic.publisher,
          comic.series,
          getComicsDirectories(),
          comic.id
        );
        if (!hasAccess) {
          log('WARN', 'SECURITY', `User ${req.user.userId} denied access to comic image: ${p}`);
          return res.status(403).end();
        }
      }

      const pageName = getQueryParamString(req.query.page);
      if (!p || !pageName || !fs.existsSync(p)) return res.status(404).end();

      const { getEntryBuffer } = require('../../services/archive-utils');
      const {
        getPageCacheKey,
        getPageCacheBuffer,
        setPageCacheBuffer
      } = require('../../services/page-cache');

      const rawW = parseInt(getQueryParamString(req.query.w), 10);
      const targetWidth = (!isNaN(rawW) && rawW > 0) ? Math.min(rawW, 2400) : null;
      // fmt=webp requests a full-resolution WebP (no resize). The fullscreen reader
      // uses this so img.naturalWidth == original width, keeping guided-view /
      // speech-bubble coordinates accurate. Thumbnails still use w= to downscale.
      const wantsFullWebp = getQueryParamString(req.query.fmt) === 'webp';
      // Never transcode animated GIFs — a single WebP frame would kill the animation.
      const isAnimated = /\.gif$/i.test(pageName);

      if ((targetWidth || wantsFullWebp) && !isAnimated) {
        let mtimeMs = 0;
        try {
          const stat = await fs.promises.stat(p);
          mtimeMs = Math.floor(stat.mtimeMs);
        } catch {}
        // Full-res WebP gets its own cache slot ('full') distinct from any width.
        const cacheWidthToken = targetWidth || 'full';
        const webpCacheKey = getPageCacheKey(p, mtimeMs, pageName, cacheWidthToken);

        // Fast path: serve a previously transcoded WebP straight from disk.
        const cachedWebp = await getPageCacheBuffer(webpCacheKey);
        if (cachedWebp) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Content-Type', 'image/webp');
          return res.send(cachedWebp);
        }

        let sourceBuffer;
        try {
          sourceBuffer = await getEntryBuffer(p, pageName);
        } catch (err) {
          log('ERROR', 'PAGES', `Failed to read page ${pageName}: ${err.message}`);
          return res.status(500).end();
        }
        if (!sourceBuffer) return res.status(404).end();

        try {
          let transcode = inFlightTranscodes.get(webpCacheKey);
          if (!transcode) {
            const sharp = require('sharp');
            let pipeline = sharp(sourceBuffer);
            if (targetWidth) {
              pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: true });
            }
            transcode = pipeline
              .webp({ quality: 80, effort: 1 })
              .toBuffer()
              .then(async (webpBuffer) => {
                await setPageCacheBuffer(webpCacheKey, webpBuffer);
                return webpBuffer;
              });
            inFlightTranscodes.set(webpCacheKey, transcode);
            // Clear the entry once settled (both branches resolve → no unhandled rejection).
            transcode.then(
              () => inFlightTranscodes.delete(webpCacheKey),
              () => inFlightTranscodes.delete(webpCacheKey)
            );
          }
          const webpBuffer = await transcode;

          if (res.writableEnded || req.destroyed) return;
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Content-Type', 'image/webp');
          return res.send(webpBuffer);
        } catch (err) {
          // Corrupt/unsupported source: fall back to original bytes rather than 500.
          log('WARN', 'PAGES', `WebP transcode failed for ${pageName}, serving original: ${err.message}`);
          if (res.writableEnded || req.destroyed) return;
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Content-Type', getMimeFromExt(pageName));
          return res.send(sourceBuffer);
        }
      }

      // Original-format path (no width requested, or animated GIF).
      try {
        const buffer = await getEntryBuffer(p, pageName);
        if (!buffer) return res.status(404).end();
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Type', getMimeFromExt(pageName));
        res.send(buffer);
      } catch (err) {
        log('ERROR', 'PAGES', `Failed to read page ${pageName}: ${err.message}`);
        return res.status(500).end();
      }
    } catch {
      res.status(500).end();
    }
  });

  router.get('/api/v1/comics/download', async (req, res) => {
    let p;
    try {
      const rawPath = Buffer.from(getQueryParamString(req.query.path), 'base64').toString('utf-8');
      p = resolvePath(rawPath);

      // Security: Validate path is within allowed directories
      if (!isPathSafe(p)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Security: Validate user has access to this specific comic
      const comic = await dbGet('SELECT id, publisher, series FROM comics WHERE path = ?', [p]);
      if (comic) {
        const hasAccess = await checkComicAccess(
          req.user.userId,
          req.user.role,
          p,
          comic.publisher,
          comic.series,
          getComicsDirectories(),
          comic.id
        );
        if (!hasAccess) {
          log('WARN', 'SECURITY', `User ${req.user.userId} denied download of comic: ${p}`);
          return res.status(403).json({ message: 'Access denied' });
        }
      }

      if (!p || !fs.existsSync(p)) return res.status(404).json({ message: 'Not found' });

      log('INFO', 'DOWNLOAD', `Serving ${path.basename(p)}`);

      // CORS headers now set by global middleware in server.js
      // Keep expose headers for range requests
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Accel-Buffering', 'no');

      const stat = await fs.promises.stat(p);
      const fileSize = stat.size;
      const range = req.headers.range;

      // HEAD: return size only (used to seed Background Fetch's downloadTotal so
      // the progress bar can compute a percentage) — never stream the body.
      if (req.method === 'HEAD') {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Length', fileSize);
        return res.end();
      }

      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        let start = parseInt(startStr, 10);
        let end = endStr ? parseInt(endStr, 10) : fileSize - 1;
        if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
          return res.end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', end - start + 1);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(p)}"`);
        fs.createReadStream(p, { start, end }).pipe(res);
      } else {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(p)}"`);
        res.setHeader('Content-Length', fileSize);
        fs.createReadStream(p).pipe(res);
      }
    } catch (e) {
      log('ERROR', 'DOWNLOAD', `Download failed${p ? ' for ' + path.basename(p) : ''}: ${e.message}`);
      res.status(500).json({ message: formatErrorMessage(e, req, 'Download failed') });
    }
  });
};
