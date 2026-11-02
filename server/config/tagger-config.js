const cryptoVault = require('../utils/crypto-vault');
const { DEFAULT_NAMING_RULES, DEFAULT_FOLDER_RULES } = require('../constants');

function createTaggerConfigAccessors(config, saveConfigToDisk) {
  function getComicVineApiKey() {
    return cryptoVault.decrypt(config.comicVineApiKey) || '';
  }

  function setComicVineApiKey(key, skipSave = false) {
    config.comicVineApiKey = key || '';
    if (!skipSave) {
      saveConfigToDisk();
    }
  }

  function getCtScheduleMinutes() {
    return config.ctScheduleMinutes || 0;
  }

  function setCtScheduleMinutes(minutes, skipSave = false) {
    const sanitized = Math.max(0, parseInt(minutes, 10) || 0);
    config.ctScheduleMinutes = sanitized;
    if (!skipSave) {
      saveConfigToDisk();
    }
  }

  function setTaggerMode() {
    config.taggerMode = 'new';
    return 'new';
  }

  function getTaggerServiceUrl() {
    return config.taggerServiceUrl || 'http://127.0.0.1:5000';
  }

  function setTaggerServiceUrl(value, skipSave = false) {
    config.taggerServiceUrl = value || 'http://127.0.0.1:5000';
    if (!skipSave) {
      saveConfigToDisk();
    }
  }

  function getTaggerLowerThreshold() {
    return config.taggerLowerThreshold !== undefined ? config.taggerLowerThreshold : 0.80;
  }

  function setTaggerLowerThreshold(value, skipSave = false) {
    const num = parseFloat(value);
    config.taggerLowerThreshold = isNaN(num) ? 0.80 : Math.min(1.0, Math.max(0.1, num));
    if (!skipSave) saveConfigToDisk();
  }

  function getTaggerUpperThreshold() {
    return config.taggerUpperThreshold !== undefined ? config.taggerUpperThreshold : 0.90;
  }

  function setTaggerUpperThreshold(value, skipSave = false) {
    const num = parseFloat(value);
    config.taggerUpperThreshold = isNaN(num) ? 0.90 : Math.min(1.0, Math.max(0.1, num));
    if (!skipSave) saveConfigToDisk();
  }

  function getTaggerEnabledSources() {
    return Array.isArray(config.taggerEnabledSources) ? config.taggerEnabledSources : ['src-comicvine', 'src-metron', 'src-gcd', 'src-lcg', 'src-goodreads', 'src-blackwells', 'src-waterstones', 'src-googlebooks', 'src-amazon', 'src-forbiddenplanet'];
  }

  function setTaggerEnabledSources(sources, skipSave = false) {
    if (Array.isArray(sources)) {
      config.taggerEnabledSources = sources;
      if (!skipSave) saveConfigToDisk();
    }
  }

  function getMetronUser() {
    return config.metronUser || '';
  }

  function setMetronUser(val, skipSave = false) {
    config.metronUser = typeof val === 'string' ? val.trim() : '';
    if (!skipSave) saveConfigToDisk();
  }

  function getMetronPassword() {
    return cryptoVault.decrypt(config.metronPassword) || '';
  }

  function setMetronPassword(val, skipSave = false) {
    config.metronPassword = typeof val === 'string' ? val.trim() : '';
    if (!skipSave) saveConfigToDisk();
  }

  function getGcdUser() {
    return config.gcdUser || '';
  }

  function setGcdUser(val, skipSave = false) {
    config.gcdUser = typeof val === 'string' ? val.trim() : '';
    if (!skipSave) saveConfigToDisk();
  }

  function getGcdPassword() {
    return cryptoVault.decrypt(config.gcdPassword) || '';
  }

  function setGcdPassword(val, skipSave = false) {
    config.gcdPassword = typeof val === 'string' ? val.trim() : '';
    if (!skipSave) saveConfigToDisk();
  }

  function getGoogleBooksApiKey() {
    return cryptoVault.decrypt(config.googleBooksApiKey) || '';
  }

  function setGoogleBooksApiKey(key, skipSave = false) {
    config.googleBooksApiKey = typeof key === 'string' ? key.trim() : '';
    if (!skipSave) saveConfigToDisk();
  }

  function getTaggerForceReprocess() {
    return config.taggerForceReprocess !== undefined ? !!config.taggerForceReprocess : false;
  }

  function setTaggerForceReprocess(val, skipSave = false) {
    config.taggerForceReprocess = !!val;
    if (!skipSave) saveConfigToDisk();
  }

  function getNamingRules() {
    return config.namingRules || DEFAULT_NAMING_RULES;
  }

  function setNamingRules(rules, skipSave = false) {
    config.namingRules = rules;
    if (!skipSave) saveConfigToDisk();
  }

  function getFolderRules() {
    return config.folderRules || DEFAULT_FOLDER_RULES;
  }

  function setFolderRules(rules, skipSave = false) {
    config.folderRules = rules;
    if (!skipSave) saveConfigToDisk();
  }

  function getGeminiApiKey() {
    return cryptoVault.decrypt(config.geminiApiKey) || '';
  }

  function setGeminiApiKey(key, skipSave = false) {
    config.geminiApiKey = key ? String(key).trim() : '';
    if (!skipSave) saveConfigToDisk();
  }

  function getGeminiModel() {
    return config.geminiModel || 'gemini-3.5-flash-lite';
  }

  function setGeminiModel(model, skipSave = false) {
    config.geminiModel = model ? String(model).trim() : 'gemini-3.5-flash-lite';
    if (!skipSave) saveConfigToDisk();
  }

  function getGeminiCoverMatchEnabled() {
    return config.geminiCoverMatchEnabled !== false;
  }

  function setGeminiCoverMatchEnabled(val, skipSave = false) {
    config.geminiCoverMatchEnabled = val !== false;
    if (!skipSave) saveConfigToDisk();
  }

  function getGeminiCoverDailyCap() {
    return config.geminiCoverDailyCap || 450;
  }

  function setGeminiCoverDailyCap(cap, skipSave = false) {
    config.geminiCoverDailyCap = parseInt(cap, 10) || 450;
    if (!skipSave) saveConfigToDisk();
  }

  function getGeminiTermsAccepted() {
    return config.geminiTermsAccepted === true;
  }

  function setGeminiTermsAccepted(val, skipSave = false) {
    config.geminiTermsAccepted = val === true;
    if (!skipSave) saveConfigToDisk();
  }

  return {
    getComicVineApiKey,
    setComicVineApiKey,
    getCtScheduleMinutes,
    setCtScheduleMinutes,
    setTaggerMode,
    getTaggerServiceUrl,
    setTaggerServiceUrl,
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
    getGoogleBooksApiKey,
    setGoogleBooksApiKey,
    getTaggerForceReprocess,
    setTaggerForceReprocess,
    getNamingRules,
    setNamingRules,
    getFolderRules,
    setFolderRules,
    getGeminiApiKey,
    setGeminiApiKey,
    getGeminiModel,
    setGeminiModel,
    getGeminiCoverMatchEnabled,
    setGeminiCoverMatchEnabled,
    getGeminiCoverDailyCap,
    setGeminiCoverDailyCap,
    getGeminiTermsAccepted,
    setGeminiTermsAccepted
  };
}

module.exports = {
  createTaggerConfigAccessors
};
