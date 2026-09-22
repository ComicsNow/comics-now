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
      const injectedHtml = indexHtml
        .replace(
          '<script id="app-config"></script>',
          `<script>window.APP_CONFIG = ${JSON.stringify({
            baseUrl: config.baseUrl,
            libraries: getPublicLibraries(),
            authEnabled: require('../config').isAuthEnabled(),
            cloudflareTeamDomain: config.authentication?.cloudflare?.teamDomain || null,
            hideSupportForAdmin: config.hideSupportForAdmin || false
          })}</script>\n  <link rel="manifest" href="${baseHref}manifest.json">`
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

  router.use(express.static(STATIC_DIR, { index: false }));
  if (STATIC_DIR !== PUBLIC_DIR) {
    router.use(express.static(PUBLIC_DIR, { index: false }));
  }
  router.use('/thumbnails', express.static(THUMBNAILS_DIRECTORY, { maxAge: '1y', immutable: true }));
  router.get('/thumbnails/:filename', async (req, res, next) => {
    const filename = req.params.filename;
    const full = path.join(THUMBNAILS_DIRECTORY, filename);
    if (fs.existsSync(full)) {
      return res.sendFile(full);
    }
    const id = path.basename(filename, path.extname(filename));
    try {
      const { dbGet, dbRun } = require('../db');
      const { generateThumbnail } = require('../services/library-pages');
      const comic = await dbGet('SELECT id, path FROM comics WHERE id = ? OR thumbnailPath = ?', [id, filename]);
      if (comic && fs.existsSync(comic.path)) {
        const gen = await generateThumbnail(comic.path);
        if (gen && fs.existsSync(path.join(THUMBNAILS_DIRECTORY, gen))) {
          await dbRun('UPDATE comics SET thumbnailPath = ? WHERE id = ?', [gen, comic.id]);
          return res.sendFile(path.join(THUMBNAILS_DIRECTORY, gen));
        }
      }
    } catch (e) {
      log('ERROR', 'THUMBNAIL', `On-demand thumbnail generation failed for ${filename}: ${e.message}`);
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
