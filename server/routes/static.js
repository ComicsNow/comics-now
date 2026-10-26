const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  PUBLIC_DIR,
  ICONS_DIRECTORY,
  THUMBNAILS_DIRECTORY,
  LOGOS_DIRECTORY
} = require('../constants');
const { log } = require('../logger');

function createStaticRouter({ getConfig, getComicsDirectories, getPublicLibraries }) {
  const router = express.Router();
  const distDir = path.join(PUBLIC_DIR, 'dist');
  const STATIC_DIR = fs.existsSync(path.join(distDir, 'index.html')) ? distDir : PUBLIC_DIR;

  let cachedIndexHtml = null;

  const sendAppShell = async (req, res) => {
    try {
      const config = getConfig();
      if (!cachedIndexHtml) {
        cachedIndexHtml = await fs.promises.readFile(path.join(STATIC_DIR, 'index.html'), 'utf-8');
      }
      const indexHtml = cachedIndexHtml;
      const baseHref = config.baseUrl.endsWith('/') ? config.baseUrl : (config.baseUrl + '/');
      const hideSupport = config.hideSupportForAdmin || process.env.HIDE_SUPPORT_FOR_ADMIN === 'true';
      const supportCss = hideSupport ? '\n  <style>#kofi-settings-link { display: none !important; }</style>' : '';
      const injectedHtml = indexHtml
        .replace(
          '<script id="app-config"></script>',
          `<script>window.APP_CONFIG = ${JSON.stringify({
            baseUrl: config.baseUrl,
            libraries: getPublicLibraries(),
            authEnabled: require('../config').isAuthEnabled(),
            cloudflareTeamDomain: config.authentication?.cloudflare?.teamDomain || null,
            hideSupportForAdmin: config.hideSupportForAdmin || false
          })}</script>${supportCss}\n  <link rel="manifest" href="${baseHref}manifest.json">`
        )
        .replace('<base href="/">', `<base href="${baseHref}">`);

      res.set('Cache-Control', 'no-store');
      res.send(injectedHtml);
    } catch (error) {
      log('ERROR', 'SERVER', `Serve index.html failed: ${error.message}`);
      res.status(500).send('Error loading application.');
    }
  };

  let cachedSwContent = null;

  router.get('/service-worker.js', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (cachedSwContent) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        return res.send(cachedSwContent);
      }

      let swContent = await fs.promises.readFile(path.join(PUBLIC_DIR, 'service-worker.js'), 'utf-8');

      // Determine build mtime to auto-bump cache version on build
      let buildMtime = '1';
      const distIndexPath = path.join(distDir, 'index.html');
      try {
        const stat = await fs.promises.stat(distIndexPath);
        buildMtime = String(Math.floor(stat.mtimeMs));
      } catch (e) {
        // file doesn't exist or unable to stat, ignore
      }

      // Discover any assets in dist/assets
      const distAssetsDir = path.join(distDir, 'assets');
      let distAssets = [];
      try {
        const files = await fs.promises.readdir(distAssetsDir);
        distAssets = files.filter(f => !f.endsWith('.map')).map(f => `assets/${f}`);
      } catch (e) {
        // directory doesn't exist or unable to read, ignore
      }

      // Replace CACHE_VERSION with dynamic timestamp
      swContent = swContent.replace(
        /const CACHE_VERSION = ['"][^'"]+['"];/,
        `const CACHE_VERSION = 'v9.0-${buildMtime}';`
      );

      // Inject discovered distAssets into ASSET_PATHS if not already present
      if (distAssets.length > 0) {
        swContent = swContent.replace(
          /const ASSET_PATHS = \[([\s\S]*?)\];/,
          (match, p1) => {
            const existing = p1.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
            const combined = Array.from(new Set([...distAssets, ...existing]));
            return `const ASSET_PATHS = ${JSON.stringify(combined, null, 2)};`;
          }
        );
      }

      cachedSwContent = swContent;
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(swContent);
    } catch (e) {
      log('ERROR', 'SERVER', `Failed to serve dynamic service-worker.js: ${e.message}`);
      res.sendFile(path.join(PUBLIC_DIR, 'service-worker.js'));
    }
  });

  router.get('/favicon.ico', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(ICONS_DIRECTORY, 'icon-192x192.png'));
  });

  router.get('/index.html', sendAppShell);

  const staticOptions = {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    }
  };

  router.use(express.static(STATIC_DIR, staticOptions));
  if (STATIC_DIR !== PUBLIC_DIR) {
    router.use(express.static(PUBLIC_DIR, staticOptions));
  }
  router.use('/thumbnails', express.static(THUMBNAILS_DIRECTORY, { maxAge: '1y', immutable: true }));
  router.get('/thumbnails/:filename', async (req, res, next) => {
    const rawFilename = req.params.filename;
    const safeFilename = path.basename(rawFilename);
    const resolvedDir = path.resolve(THUMBNAILS_DIRECTORY);
    const full = path.resolve(resolvedDir, safeFilename);
    if (!full.startsWith(resolvedDir + path.sep)) {
      return res.status(403).send('Forbidden');
    }
    try {
      await fs.promises.access(full);
      return res.sendFile(safeFilename, { root: resolvedDir });
    } catch (e) {
      // file does not exist, continue
    }

    const id = path.basename(safeFilename, path.extname(safeFilename));
    try {
      const { dbGet, dbRun } = require('../db');
      const { generateThumbnail } = require('../services/library-pages');
      const comic = await dbGet('SELECT id, path FROM comics WHERE id = ? OR thumbnailPath = ?', [id, safeFilename]);

      if (comic) {
        let comicExists = false;
        try {
          await fs.promises.access(comic.path);
          comicExists = true;
        } catch (e) {}

        if (comicExists) {
          const gen = await generateThumbnail(comic.path);
          const safeGen = gen ? path.basename(gen) : null;

          if (safeGen) {
            let safeGenExists = false;
            try {
              await fs.promises.access(path.join(resolvedDir, safeGen));
              safeGenExists = true;
            } catch (e) {}

            if (safeGenExists) {
              await dbRun('UPDATE comics SET thumbnailPath = ? WHERE id = ?', [safeGen, comic.id]);
              return res.sendFile(safeGen, { root: resolvedDir });
            }
          }
        }
      }
    } catch (e) {
      log('ERROR', 'THUMBNAIL', `On-demand thumbnail generation failed for ${safeFilename}: ${e.message}`);
    }
    next();
  });
  router.use('/icons', express.static(ICONS_DIRECTORY, { maxAge: '1y', immutable: true }));
  router.use('/logos', express.static(LOGOS_DIRECTORY, { maxAge: '1y', immutable: true }));

  router.get('*', sendAppShell);

  return router;
}

module.exports = {
  createStaticRouter
};
