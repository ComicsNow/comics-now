const cryptoVault = require('../../../utils/crypto-vault');
const { getNamingRules, setNamingRules, getFolderRules, setFolderRules } = require('../../../config');
const { saveSetting: defaultSaveSetting } = require('../../../settings');
const {
  DEFAULT_NAMING_RULES,
  DEFAULT_FOLDER_RULES,
  formatComicFilename,
  formatFolderPath
} = require('../../../services/organization');

module.exports = function attachSettingsRoutes(router, deps) {
  const {
    log,
    getCtScheduleMinutes,
    setCtScheduleMinutes,
    getComicsLocation,
    setComicsLocation,
    saveSetting,
    scheduleCtRun,
    getComicVineApiKey,
    setComicVineApiKey,
    getGoogleBooksApiKey,
    setGoogleBooksApiKey,
    formatErrorMessage,
    getTaggerServiceUrl,
    setTaggerServiceUrl,
    stopTaggerWorker,
    startTaggerWorker,
    isWorkerOnline,
    getMetadataStorage,
    setMetadataStorage,
    getTaggerLowerThreshold,
    setTaggerLowerThreshold,
    getTaggerUpperThreshold,
    setTaggerUpperThreshold,
    getTaggerEnabledSources,
    setTaggerEnabledSources,
    getMetronUser,
    setMetronUser,
    getMetronPassword,
    setMetronPassword,
    getGcdUser,
    setGcdUser,
    getGcdPassword,
    setGcdPassword,
    getTaggerForceReprocess,
    setTaggerForceReprocess
  } = deps;

  router.get('/api/v1/tag-comics-now/schedule', async (req, res) => {
    const taggerServiceUrl = getTaggerServiceUrl ? getTaggerServiceUrl() : 'http://127.0.0.1:5000';
    let serviceOnline = false;
    try {
      serviceOnline = isWorkerOnline ? await isWorkerOnline(taggerServiceUrl) : false;
    } catch (_) {
      serviceOnline = false;
    }

    res.json({
      minutes: getCtScheduleMinutes ? getCtScheduleMinutes() : 60,
      comicsLocation: getComicsLocation ? getComicsLocation() : '',
      taggerMode: 'new',
      taggerServiceUrl,
      serviceOnline,
      metadataStorage: getMetadataStorage ? getMetadataStorage() : 'archive',
      lowerThreshold: getTaggerLowerThreshold ? getTaggerLowerThreshold() : 0.80,
      upperThreshold: getTaggerUpperThreshold ? getTaggerUpperThreshold() : 0.90,
      enabledSources: getTaggerEnabledSources ? getTaggerEnabledSources() : [],
      forceReprocess: getTaggerForceReprocess ? getTaggerForceReprocess() : false,
      metronUser: getMetronUser ? getMetronUser() : '',
      hasMetronPass: !!(getMetronPassword && getMetronPassword()),
      gcdUser: getGcdUser ? getGcdUser() : '',
      hasGcdPass: !!(getGcdPassword && getGcdPassword()),
      hasComicVineKey: !!(getComicVineApiKey && getComicVineApiKey()),
      comicVineApiKey: cryptoVault.mask(getComicVineApiKey ? getComicVineApiKey() : ''),
      hasGoogleBooksKey: !!(getGoogleBooksApiKey && getGoogleBooksApiKey()),
      googleBooksApiKey: cryptoVault.mask(getGoogleBooksApiKey ? getGoogleBooksApiKey() : '')
    });
  });

  router.post('/api/v1/tag-comics-now/schedule', async (req, res) => {
    try {
      const {
        minutes = 60,
        comicsLocation,
        metadataStorage,
        lowerThreshold,
        upperThreshold,
        enabledSources,
        forceReprocess,
        metronUser,
        metronPassword,
        gcdUser,
        gcdPassword,
        comicVineApiKey,
        googleBooksApiKey,
        taggerServicePort
      } = req.body || {};

      let servicePort;
      if (taggerServicePort != null) {
        const parsedPort = typeof taggerServicePort === 'string' && taggerServicePort.trim() !== ''
          ? Number(taggerServicePort)
          : taggerServicePort;
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
          return res.status(400).json({ error: 'taggerServicePort must be an integer between 1 and 65535' });
        }
        servicePort = parsedPort;
      }

      const mins = Math.max(0, parseInt(minutes, 10) || 0);
      if (setCtScheduleMinutes) setCtScheduleMinutes(mins);
      await saveSetting('ctScheduleMinutes', mins);
      
      if (comicsLocation && setComicsLocation) {
        setComicsLocation(comicsLocation);
      }

      if (metadataStorage && setMetadataStorage) {
        setMetadataStorage(metadataStorage);
        await saveSetting('metadata_storage', metadataStorage);
      }

      if (lowerThreshold !== undefined) {
        const parsedLower = Number(lowerThreshold);
        if (isNaN(parsedLower) || parsedLower < 0.0 || parsedLower > 1.0) {
          return res.status(400).json({ error: 'lowerThreshold must be a number between 0 and 1' });
        }
        if (setTaggerLowerThreshold) {
          setTaggerLowerThreshold(parsedLower);
          const sanitizedLower = getTaggerLowerThreshold ? getTaggerLowerThreshold() : parsedLower;
          await saveSetting('taggerLowerThreshold', sanitizedLower);
        }
      }

      if (upperThreshold !== undefined) {
        const parsedUpper = Number(upperThreshold);
        if (isNaN(parsedUpper) || parsedUpper < 0.0 || parsedUpper > 1.0) {
          return res.status(400).json({ error: 'upperThreshold must be a number between 0 and 1' });
        }
        if (setTaggerUpperThreshold) {
          setTaggerUpperThreshold(parsedUpper);
          const sanitizedUpper = getTaggerUpperThreshold ? getTaggerUpperThreshold() : parsedUpper;
          await saveSetting('taggerUpperThreshold', sanitizedUpper);
        }
      }

      if (enabledSources && setTaggerEnabledSources) {
        setTaggerEnabledSources(enabledSources);
        await saveSetting('taggerEnabledSources', enabledSources);
      }

      if (forceReprocess !== undefined && setTaggerForceReprocess) {
        setTaggerForceReprocess(forceReprocess);
        await saveSetting('taggerForceReprocess', forceReprocess);
      }

      if (metronUser !== undefined && setMetronUser) {
        setMetronUser(metronUser);
        await saveSetting('metronUser', metronUser);
      }

      if (metronPassword !== undefined && setMetronPassword && metronPassword.trim() && !cryptoVault.isMasked(metronPassword)) {
        const encMetron = cryptoVault.encrypt(metronPassword.trim());
        setMetronPassword(encMetron);
        await saveSetting('metronPassword', encMetron);
      }

      if (gcdUser !== undefined && setGcdUser) {
        setGcdUser(gcdUser);
        await saveSetting('gcdUser', gcdUser);
      }

      if (gcdPassword !== undefined && setGcdPassword && gcdPassword.trim() && !cryptoVault.isMasked(gcdPassword)) {
        const encGcd = cryptoVault.encrypt(gcdPassword.trim());
        setGcdPassword(encGcd);
        await saveSetting('gcdPassword', encGcd);
      }

      if (comicVineApiKey !== undefined && setComicVineApiKey && !cryptoVault.isMasked(comicVineApiKey)) {
        const encCv = cryptoVault.encrypt(typeof comicVineApiKey === 'string' ? comicVineApiKey.trim() : '');
        setComicVineApiKey(encCv);
        await saveSetting('comicVineApiKey', encCv);
      }

      if (googleBooksApiKey !== undefined && setGoogleBooksApiKey && !cryptoVault.isMasked(googleBooksApiKey)) {
        const encGb = cryptoVault.encrypt(typeof googleBooksApiKey === 'string' ? googleBooksApiKey.trim() : '');
        setGoogleBooksApiKey(encGb);
        await saveSetting('googleBooksApiKey', encGb);
      }

      const currentUrl = getTaggerServiceUrl ? getTaggerServiceUrl() : 'http://127.0.0.1:5000';
      let taggerServiceUrl = currentUrl;
      let changed = false;
      let workerRestarted = false;
      let warning;

      if (servicePort !== undefined) {
        let currentPort = 5000;
        try {
          const parsedCurrent = new URL(currentUrl);
          currentPort = parseInt(parsedCurrent.port, 10) || (parsedCurrent.protocol === 'https:' ? 443 : 80);
        } catch (_) {}

        if (servicePort !== currentPort) {
          const newUrl = `http://127.0.0.1:${servicePort}`;
          if (setTaggerServiceUrl) setTaggerServiceUrl(newUrl, true);
          await saveSetting('taggerServiceUrl', newUrl);
          taggerServiceUrl = newUrl;
          changed = true;
          try {
            if (stopTaggerWorker) stopTaggerWorker();
            if (startTaggerWorker) await startTaggerWorker();
            workerRestarted = true;
          } catch (e) {
            warning = formatErrorMessage(e, req, 'Port saved but the tagger worker failed to restart');
            if (log) log('WARN', 'CT', `Tagger worker restart failed after port change: ${e.message}`);
          }
        }
      }

      if (scheduleCtRun) scheduleCtRun();
      const payload = { ok: true, changed, taggerServiceUrl };
      if (changed) {
        payload.workerRestarted = workerRestarted;
        if (warning) payload.warning = warning;
      }
      res.json(payload);
    } catch (e) {
      res.status(400).json({ message: formatErrorMessage(e, req, 'Failed to save settings') });
    }
  });

  router.get('/api/v1/tag-comics-now/sources', (req, res) => {
    const allSources = [
      { id: 'src-comicvine', label: 'ComicVine', requiresApiKey: true },
      { id: 'src-metron', label: 'Metron', requiresAuth: true },
      { id: 'src-gcd', label: 'Grand Comics Database (GCD)' },
      { id: 'src-lcg', label: 'League of Comic Geeks (LCG)' },
      { id: 'src-goodreads', label: 'Goodreads' },
      { id: 'src-blackwells', label: "Blackwell's" },
      { id: 'src-waterstones', label: 'Waterstones' },
      { id: 'src-googlebooks', label: 'Google Books', requiresApiKey: true },
      { id: 'src-amazon', label: 'Amazon' },
      { id: 'src-forbiddenplanet', label: 'Forbidden Planet' }
    ];
    const enabled = getTaggerEnabledSources ? getTaggerEnabledSources() : allSources.map(s => s.id);
    res.json({
      sources: allSources.map(s => ({
        ...s,
        enabled: enabled.includes(s.id)
      }))
    });
  });

  router.get('/api/v1/tag-comics-now/naming-rules', (req, res) => {
    const fn = deps.getNamingRules || getNamingRules;
    res.json({ ok: true, rules: fn ? fn() : DEFAULT_NAMING_RULES });
  });

  router.post('/api/v1/tag-comics-now/naming-rules', async (req, res) => {
    try {
      const { rules } = req.body || {};
      if (!rules || !Array.isArray(rules.tokens)) {
        return res.status(400).json({ ok: false, error: 'Invalid naming rules format' });
      }
      const setFn = deps.setNamingRules || setNamingRules;
      const saveFn = deps.saveSetting || defaultSaveSetting;
      if (setFn) setFn(rules);
      if (saveFn) await saveFn('namingRules', rules);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/api/v1/tag-comics-now/folder-rules', (req, res) => {
    const fn = deps.getFolderRules || getFolderRules;
    res.json({ ok: true, rules: fn ? fn() : DEFAULT_FOLDER_RULES });
  });

  router.post('/api/v1/tag-comics-now/folder-rules', async (req, res) => {
    try {
      const { rules } = req.body || {};
      if (!rules || !Array.isArray(rules.hierarchy)) {
        return res.status(400).json({ ok: false, error: 'Invalid folder rules format' });
      }
      const setFn = deps.setFolderRules || setFolderRules;
      const saveFn = deps.saveSetting || defaultSaveSetting;
      if (setFn) setFn(rules);
      if (saveFn) await saveFn('folderRules', rules);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/api/v1/tag-comics-now/naming-preview', (req, res) => {
    try {
      const { metadata = {}, rules } = req.body || {};
      const filename = formatComicFilename(metadata, rules || DEFAULT_NAMING_RULES, '.cbz');
      res.json({ ok: true, filename });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post('/api/v1/tag-comics-now/folder-preview', (req, res) => {
    try {
      const { metadata = {}, rules } = req.body || {};
      const folderPath = formatFolderPath(metadata, rules || DEFAULT_FOLDER_RULES);
      res.json({ ok: true, folderPath });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
};
