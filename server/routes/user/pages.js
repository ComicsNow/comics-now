const fs = require('fs');
const path = require('path');
const { rateLimiter } = require('../../middleware/rate-limiter');

const downloadLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30
});


/**
 * User Pages Routes
 * 
 * Handles comic page listing, image serving, and downloads.
 */
module.exports = function attach(router, deps) {
  const pagesLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 2000
  });
  router.use(pagesLimiter);

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

  // Serve a comic's guided-view sidecar (panel coordinates).
  router.get('/api/v1/comics/:id/guided-view', requireAuth, async (req, res) => {
    try {
      const row = await dbGet(
        'SELECT guidedViewStatus, guidedViewPath FROM comics WHERE id = ?',
        [req.params.id]
      );
      if (!row) return res.status(404).json({ ok: false, message: 'Comic not found' });
      if (row.guidedViewStatus !== 'completed' || !row.guidedViewPath) {
        return res.status(404).json({ ok: false, message: 'Guided view not available' });
      }
      if (!fs.existsSync(row.guidedViewPath)) {
        return res.status(404).json({ ok: false, message: 'Guided view file missing' });
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      fs.createReadStream(row.guidedViewPath).pipe(res);
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to load guided view') });
    }
  });

  router.get('/api/v1/comics/pages', async (req, res) => {
    try {
      const rawPath = Buffer.from(req.query.path || '', 'base64').toString('utf-8');
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
      const rawPath = Buffer.from(req.query.path || '', 'base64').toString('utf-8');
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

      const pageName = req.query.page || '';
      if (!p || !pageName || !fs.existsSync(p)) return res.status(404).end();

      const { getEntryBuffer } = require('../../services/archive-utils');
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

  router.get('/api/v1/comics/download', requireAuth, downloadLimiter, async (req, res) => {
    let p;
    try {
      const rawPath = Buffer.from(req.query.path || '', 'base64').toString('utf-8');
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
