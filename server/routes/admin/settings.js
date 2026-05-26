
/**
 * Admin Settings Routes
 * @param {express.Router} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  const {
    setScanIntervalMinutes,
    setComicVineApiKey,
    getLibraries,
    addLibrary,
    removeLibrary,
    setAllowedFormats,
    setMetadataStorage,
    saveSetting,
    scheduleNextScan,
    formatErrorMessage,
    validateScanInterval,
    validateApiKey,
    requireAdmin
  } = deps;

  router.get('/api/v1/admin/libraries', requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, libraries: getLibraries() });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to get libraries') });
    }
  });

  router.post('/api/v1/admin/libraries', requireAdmin, async (req, res) => {
    try {
      const { path, hierarchyMode } = req.body;
      if (!path) {
        return res.status(400).json({ ok: false, message: 'Path is required' });
      }
      const success = addLibrary(path, hierarchyMode || 'metadata');
      if (success) {
        res.json({ ok: true });
      } else {
        res.status(400).json({ ok: false, message: 'Failed to add library (invalid path or already exists)' });
      }
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to add library') });
    }
  });

  router.delete('/api/v1/admin/libraries', requireAdmin, async (req, res) => {
    try {
      const { path } = req.body;
      if (!path) {
        return res.status(400).json({ ok: false, message: 'Path is required' });
      }
      const success = removeLibrary(path);
      if (success) {
        res.json({ ok: true });
      } else {
        res.status(400).json({ ok: false, message: 'Failed to remove library (path not found)' });
      }
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to remove library') });
    }
  });

  router.post('/api/v1/settings', requireAdmin, async (req, res) => {
    try {
      const { interval = 5, apiKey = '', allowedFormats = 'cbz', metadataStorage = 'archive' } = req.body || {};

      // Validate scan interval
      const parsedInterval = parseInt(interval, 10);
      const intervalToValidate = isNaN(parsedInterval) ? 5 : parsedInterval;
      const intervalValidation = validateScanInterval(intervalToValidate);
      if (!intervalValidation.valid) {
        return res.status(400).json({ ok: false, message: intervalValidation.error });
      }

      // Validate API key
      const apiKeyValidation = validateApiKey(apiKey);
      if (!apiKeyValidation.valid) {
        return res.status(400).json({ ok: false, message: apiKeyValidation.error });
      }

      const minutes = intervalValidation.sanitized;
      const sanitizedApiKey = apiKeyValidation.sanitized;

      setScanIntervalMinutes(minutes);
      setComicVineApiKey(sanitizedApiKey);
      setAllowedFormats(allowedFormats);
      setMetadataStorage(metadataStorage);

      await saveSetting('scanInterval', minutes);
      await saveSetting('comicVineApiKey', sanitizedApiKey);
      await saveSetting('allowed_formats', allowedFormats);
      await saveSetting('metadata_storage', metadataStorage);

      scheduleNextScan();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: formatErrorMessage(e, req, 'Failed to save settings') });
    }
  });
};
