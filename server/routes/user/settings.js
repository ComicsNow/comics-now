const express = require('express');

/**
 * User Settings Routes
 * @param {express.Router} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  const {
    getComicVineApiKey,
    getScanIntervalMinutes,
    getAllowedFormats,
    getMetadataStorage
  } = deps;

  router.get('/api/v1/settings', (req, res) => {
    const apiKey = getComicVineApiKey();
    const isAdmin = req.user?.role === 'admin';

    res.json({
      scanInterval: getScanIntervalMinutes(),
      allowedFormats: getAllowedFormats(),
      metadataStorage: getMetadataStorage(),
      hasApiKey: !!(apiKey && apiKey !== 'YOUR_API_KEY_HERE'),
      // Only send actual key to admins (for settings form)
      comicVineApiKey: isAdmin ? apiKey : undefined
    });
  });
};
