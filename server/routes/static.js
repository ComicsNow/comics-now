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

  const sendAppShell = (req, res) => {
    try {
      const config = getConfig();
      const indexHtml = fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf-8');
      const baseHref = config.baseUrl.endsWith('/') ? config.baseUrl : (config.baseUrl + '/');
      const hideSupport = config.hideSupportForAdmin || process.env.HIDE_SUPPORT_FOR_ADMIN === 'true';
      const supportCss = hideSupport ? '\n  <style>#kofi-settings-link, #support-link { display: none !important; }</style>' : '';
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

  router.get('/service-worker.js', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, 'service-worker.js'));
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
    if (fs.existsSync(full)) {
      return res.sendFile(safeFilename, { root: resolvedDir });
    }
    const id = path.basename(safeFilename, path.extname(safeFilename));
    try {
      const { dbGet, dbRun } = require('../db');
      const { generateThumbnail } = require('../services/library-pages');
      const comic = await dbGet('SELECT id, path FROM comics WHERE id = ? OR thumbnailPath = ?', [id, safeFilename]);
      if (comic && fs.existsSync(comic.path)) {
        const gen = await generateThumbnail(comic.path);
        const safeGen = gen ? path.basename(gen) : null;
        if (safeGen && fs.existsSync(path.join(resolvedDir, safeGen))) {
          await dbRun('UPDATE comics SET thumbnailPath = ? WHERE id = ?', [safeGen, comic.id]);
          return res.sendFile(safeGen, { root: resolvedDir });
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
