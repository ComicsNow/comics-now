/**
 * User Metadata Synthesis & URL Extraction Routes
 *
 * Handles POST /api/v1/metadata/synthesize and POST /api/v1/metadata/extract-from-url.
 */
const cryptoVault = require('../../../utils/crypto-vault');
const { getConfig } = require('../../../config');
const geminiQuota = require('../../../services/gemini-quota');
const geminiMetadata = require('../../../services/gemini-metadata');
const { synthesizeMetadataDeterministic } = require('../../../services/metadata/merger');
const urlExtractor = require('../../../services/url-metadata-extractor');

function attachComicInfoRoutes(router, deps) {
  const {
    dbGet,
    dbRun,
    dbAll,
    formatErrorMessage
  } = deps;

  if (typeof router.post !== 'function') return;

  async function resolveGeminiConfig() {
    const config = getConfig() || {};
    let enabled = config.geminiCoverMatchEnabled !== false;
    let geminiApiKey = (process.env.NODE_ENV === 'test' ? '' : process.env.GEMINI_API_KEY) || config.geminiApiKey || '';
    let geminiModel = config.geminiModel || 'gemini-3.5-flash-lite';
    let dailyCap = parseInt(config.geminiCoverDailyCap || '450', 10);

    try {
      if (typeof dbGet === 'function') {
        const keyRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiApiKey'");
        if (keyRow?.value) {
          try { geminiApiKey = JSON.parse(keyRow.value); } catch { geminiApiKey = keyRow.value; }
        }
        const enabledRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiCoverMatchEnabled'");
        if (enabledRow && enabledRow.value !== undefined && enabledRow.value !== null) {
          let rawEnabled = enabledRow.value;
          try { rawEnabled = JSON.parse(enabledRow.value); } catch { rawEnabled = enabledRow.value; }
          enabled = rawEnabled !== false && rawEnabled !== 'false' && rawEnabled !== 0 && rawEnabled !== '0';
        }
        const modelRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiModel'");
        if (modelRow?.value) {
          try { geminiModel = JSON.parse(modelRow.value); } catch { geminiModel = modelRow.value; }
        }
        const capRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiCoverDailyCap'");
        if (capRow?.value) {
          try { dailyCap = parseInt(JSON.parse(capRow.value), 10); } catch { dailyCap = parseInt(capRow.value, 10); }
        }
      }
    } catch (_) {}

    geminiApiKey = (cryptoVault.decrypt(geminiApiKey) || geminiApiKey || '').trim();
    return { enabled, geminiApiKey, geminiModel, dailyCap };
  }

  router.post('/api/v1/metadata/synthesize', async (req, res) => {
    try {
      const { sources, filename, existingMeta } = req.body || {};

      if (!Array.isArray(sources) || sources.length < 2) {
        return res.status(400).json({
          message: 'At least 2 sources are required for synthesis. For a single source, apply it directly.'
        });
      }

      const { enabled, geminiApiKey, geminiModel, dailyCap } = await resolveGeminiConfig();
      const useGemini = Boolean(enabled && geminiApiKey);

      if (useGemini) {
        const quotaResult = await geminiQuota.incrementDailyUsage({ dbGet, dbRun }, dailyCap);
        if (!quotaResult.allowed) {
          return res.status(429).json({
            message: `Daily Gemini API request cap (${dailyCap}) reached. Requests will reset at midnight Pacific Time.`
          });
        }
      }

      // Publisher codex from library
      let publisherCodex = [];
      try {
        if (typeof dbAll === 'function') {
          const rows = await dbAll("SELECT DISTINCT publisher FROM comics WHERE publisher IS NOT NULL AND publisher != '' AND publisher != 'Unknown Publisher'");
          publisherCodex = (rows || []).map(r => r.publisher).filter(Boolean);
        }
      } catch (_) {}

      // Normalize candidate objects for synthesis
      const formattedCandidates = sources.map(s => {
        const meta = s.fullMetadata || s.metadata || s;
        const title = meta.Title || meta.title || s.name || s.title || '';
        const series = meta.Series || meta.series || s.volumeName || s.series || '';
        const issue = meta.Number != null ? String(meta.Number) : (meta.number != null ? String(meta.number) : (meta.issue != null ? String(meta.issue) : (s.issueNumber != null ? String(s.issueNumber) : '')));
        const publisher = meta.Publisher || meta.publisher || s.publisher || '';
        const coverDate = meta['Cover Date'] || meta.CoverDate || meta.cover_date || meta.publish_date || s.coverDate || '';
        const description = meta.Summary || meta.summary || meta.description || s.summary || '';

        return {
          source: s.source || meta.source || 'external',
          title,
          series,
          issue,
          publisher,
          cover_date: coverDate,
          description,
          matching_url: meta.Web || s.source_url || s.matching_url || '',
          cover_url: meta.cover_image_url || s.image?.medium_url || s.image?.thumb_url || s.coverUrl || '',
          metadata: {
            title,
            series,
            issue,
            number: issue,
            publisher,
            imprint: meta.Imprint || meta.imprint || '',
            cover_date: coverDate,
            description,
            writer: meta.Writer || meta.writer || '',
            penciller: meta.Penciller || meta.penciller || '',
            inker: meta.Inker || meta.inker || '',
            colorist: meta.Colorist || meta.colorist || '',
            letterer: meta.Letterer || meta.letterer || '',
            cover_artist: meta.CoverArtist || meta.cover_artist || '',
            editor: meta.Editor || meta.editor || '',
            characters: meta.Characters || meta.characters || '',
            teams: meta.Teams || meta.teams || '',
            locations: meta.Locations || meta.locations || '',
            story_arc: meta.StoryArc || meta.story_arc || '',
            story_arc_number: meta.StoryArcNumber || meta.story_arc_number || '',
            page_count: meta.PageCount || meta.page_count || '',
            age_rating: meta.AgeRating || meta.age_rating || '',
            genre: meta.Genre || meta.genre || '',
            cover_image_url: meta.cover_image_url || s.image?.medium_url || s.image?.thumb_url || s.coverUrl || ''
          }
        };
      });

      const synthesized = useGemini
        ? await geminiMetadata.synthesizeMetadataWithGemini({
            winningCandidate: formattedCandidates[0],
            allCandidates: formattedCandidates,
            filename: filename || 'Unknown Comic.cbz',
            existingMeta: existingMeta || {},
            publisherCodex,
            apiKey: geminiApiKey,
            model: geminiModel
          })
        : synthesizeMetadataDeterministic({
            allCandidates: formattedCandidates,
            existingMeta: existingMeta || {},
            publisherCodex
          });

      // Return clean canonical ComicInfo metadata without redundant lowercase/snake_case duplicate keys
      const cleanCanonical = {};
      const CANONICAL_KEYS = [
        'Title', 'Series', 'Number', 'Volume', 'Publisher', 'Imprint',
        'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer', 'CoverArtist', 'Editor',
        'Summary', 'Year', 'Month', 'Day', 'CoverDate', 'Genre', 'Web',
        'Characters', 'Teams', 'Locations', 'StoryArc', 'StoryArcNumber',
        'PageCount', 'AgeRating', 'Notes'
      ];

      for (const k of CANONICAL_KEYS) {
        if (synthesized[k] !== undefined && synthesized[k] !== null && synthesized[k] !== '') {
          cleanCanonical[k] = synthesized[k];
        }
      }

      if (!cleanCanonical.CoverDate && (synthesized.cover_date || synthesized.publish_date)) {
        cleanCanonical.CoverDate = synthesized.cover_date || synthesized.publish_date;
      }
      if (synthesized.cover_image_url) {
        cleanCanonical.cover_image_url = synthesized.cover_image_url;
      }

      return res.json({
        success: true,
        mode: useGemini ? 'gemini' : 'deterministic',
        metadata: cleanCanonical
      });
    } catch (e) {
      return res.status(500).json({ message: formatErrorMessage(e, req, 'Failed to synthesize metadata with Gemini') });
    }
  });

  router.post('/api/v1/metadata/extract-from-url', async (req, res) => {
    try {
      const { url, filename, existingMeta } = req.body || {};

      if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) {
        return res.status(400).json({
          message: 'A valid http/https URL is required for web metadata extraction.'
        });
      }

      if (!urlExtractor.isSafeWebUrl(url)) {
        return res.status(400).json({
          message: 'Invalid or restricted URL target.'
        });
      }

      const { enabled, geminiApiKey, geminiModel, dailyCap } = await resolveGeminiConfig();
      if (!enabled) {
        return res.status(400).json({
          message: 'Gemini is disabled in settings. Enable Gemini in Tag Comics Now! -> Gemini AI to extract metadata from URL.'
        });
      }

      if (!geminiApiKey) {
        return res.status(400).json({
          message: 'Gemini API key is not configured. Please configure your API key in Settings.'
        });
      }

      const quotaResult = await geminiQuota.incrementDailyUsage({ dbGet, dbRun }, dailyCap);
      if (!quotaResult.allowed) {
        return res.status(429).json({
          message: `Daily Gemini API request cap (${dailyCap}) reached. Requests will reset at midnight Pacific Time.`
        });
      }

      // Publisher codex from library
      let publisherCodex = [];
      try {
        if (typeof dbAll === 'function') {
          const rows = await dbAll("SELECT DISTINCT publisher FROM comics WHERE publisher IS NOT NULL AND publisher != '' AND publisher != 'Unknown Publisher'");
          publisherCodex = (rows || []).map(r => r.publisher).filter(Boolean);
        }
      } catch (_) {}

      const metadata = await urlExtractor.extractMetadataFromUrl({
        url: url.trim(),
        filename: filename || 'Unknown Comic.cbz',
        existingMeta: existingMeta || {},
        publisherCodex,
        apiKey: geminiApiKey,
        model: geminiModel
      });

      return res.json({
        success: true,
        metadata
      });
    } catch (e) {
      return res.status(500).json({
        message: formatErrorMessage(e, req, 'Failed to extract metadata from URL')
      });
    }
  });
}

module.exports = {
  attachComicInfoRoutes
};
