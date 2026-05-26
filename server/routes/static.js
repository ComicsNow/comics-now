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

const { rateLimiter } = require('../middleware/rate-limiter');

function createStaticRouter({ getConfig, getComicsDirectories, getPublicLibraries }) {
  const router = express.Router();
  const staticLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 1000
  });
  router.use(staticLimiter);

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
  router.use('/icons', express.static(ICONS_DIRECTORY, { maxAge: '1y', immutable: true }));
  router.use('/logos', express.static(LOGOS_DIRECTORY, { maxAge: '1y', immutable: true }));

  router.get('*', sendAppShell);

  return router;
}

module.exports = {
  createStaticRouter
};
