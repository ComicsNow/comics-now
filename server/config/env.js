function applyEnvOverrides(config) {
  if (process.env.PORT) config.port = parseInt(process.env.PORT, 10);
  if (process.env.BASE_URL) config.baseUrl = process.env.BASE_URL;
  if (process.env.COMICS_LOCATION) config.comicsLocation = process.env.COMICS_LOCATION;
  if (process.env.SCAN_INTERVAL_MINUTES) config.scanIntervalMinutes = parseInt(process.env.SCAN_INTERVAL_MINUTES, 10);
  if (process.env.COMICVINE_API_KEY) config.comicVineApiKey = process.env.COMICVINE_API_KEY;
  if (process.env.GOOGLE_BOOKS_API_KEY) config.googleBooksApiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (process.env.GEMINI_API_KEY) config.geminiApiKey = process.env.GEMINI_API_KEY;
  if (process.env.GEMINI_MODEL) config.geminiModel = process.env.GEMINI_MODEL;
  if (process.env.GEMINI_COVER_DAILY_CAP) config.geminiCoverDailyCap = parseInt(process.env.GEMINI_COVER_DAILY_CAP, 10);
  if (process.env.GEMINI_COVER_MATCH_ENABLED !== undefined) {
    config.geminiCoverMatchEnabled = process.env.GEMINI_COVER_MATCH_ENABLED === 'true' || process.env.GEMINI_COVER_MATCH_ENABLED === '1';
  }
  if (process.env.CT_SCHEDULE_MINUTES) config.ctScheduleMinutes = parseInt(process.env.CT_SCHEDULE_MINUTES, 10);
  if (process.env.ALLOWED_FORMATS) config.allowed_formats = process.env.ALLOWED_FORMATS;
  if (process.env.METADATA_STORAGE) config.metadata_storage = process.env.METADATA_STORAGE;
  if (process.env.TRUST_PROXY) {
    const tp = process.env.TRUST_PROXY;
    config.trustProxy = (tp === 'true') ? true : 
                        (tp === 'false') ? false : 
                        (!isNaN(Number(tp))) ? Number(tp) : tp;
  }
  if (process.env.TAGGER_SERVICE_URL) config.taggerServiceUrl = process.env.TAGGER_SERVICE_URL;
  if (process.env.TAGGER_LOWER_THRESHOLD) config.taggerLowerThreshold = parseFloat(process.env.TAGGER_LOWER_THRESHOLD);
  if (process.env.TAGGER_UPPER_THRESHOLD) config.taggerUpperThreshold = parseFloat(process.env.TAGGER_UPPER_THRESHOLD);
  if (process.env.METRON_USER) config.metronUser = process.env.METRON_USER;
  if (process.env.METRON_PASSWORD) config.metronPassword = process.env.METRON_PASSWORD;

  if (process.env.CORS_ENABLED) {
    if (!config.cors) config.cors = {};
    config.cors.enabled = process.env.CORS_ENABLED === 'true';
  }
  if (process.env.CORS_ALLOWED_ORIGINS) {
    if (!config.cors) config.cors = {};
    config.cors.allowedOrigins = process.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim());
  }
}

module.exports = {
  applyEnvOverrides
};
