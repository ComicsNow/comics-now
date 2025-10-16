const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  PUBLIC_DIR,
  ICONS_DIRECTORY,
  THUMBNAILS_DIRECTORY,
  LOGOS_DIRECTORY,
  SCREENSHOTS_DIRECTORY
} = require('../constants');
const { log } = require('../logger');

function createStaticRouter({ getConfig, getComicsDirectories }) {
  const router = express.Router();

  const sendAppShell = (req, res) => {
    try {
      const config = getConfig();
      const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
      const baseHref = config.baseUrl.endsWith('/') ? config.baseUrl : (config.baseUrl + '/');
      const injectedHtml = indexHtml
        .replace(
          '<script id="app-config"></script>',
          `<script>window.APP_CONFIG = ${JSON.stringify({
            baseUrl: config.baseUrl,
            comicsDirectories: getComicsDirectories(),
            authEnabled: require('../config').isAuthEnabled(),
            cloudflareTeamDomain: config.authentication?.cloudflare?.teamDomain || null
          })}</script>`
        )
        .replace('<base href="/">', `<base href="${baseHref}">`)
        .replace('rel="manifest" href="manifest.json"', `rel="manifest" href="${baseHref}manifest.json"`);

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

  router.use(express.static(PUBLIC_DIR, { index: false }));
  router.use('/thumbnails', express.static(THUMBNAILS_DIRECTORY, { maxAge: '1y', immutable: true }));
  router.use('/icons', express.static(ICONS_DIRECTORY, { maxAge: '1y', immutable: true }));
  router.use('/logos', express.static(LOGOS_DIRECTORY, { maxAge: '1y', immutable: true }));
  router.use('/screenshots', express.static(SCREENSHOTS_DIRECTORY, { maxAge: '1y', immutable: true }));

  router.get('*', sendAppShell);

  return router;
}

module.exports = {
  createStaticRouter
};
