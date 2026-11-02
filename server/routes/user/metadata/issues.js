/**
 * User Metadata External Search & ComicVine Volume/Issue Detail Routes
 *
 * Handles GET /api/v1/search/external, GET /api/v1/comicvine/volume/:volumeId/issues,
 * GET /api/v1/comicvine/volume/:id, and GET /api/v1/comicvine/issue/:id.
 */
const cryptoVault = require('../../../utils/crypto-vault');
const { getConfig, getGoogleBooksApiKey, getMetronPassword, getGcdPassword } = require('../../../config');
const { sanitizeMetadata } = require('../../../services/metadata');

function attachIssuesRoutes(router, deps) {
  const {
    formatErrorMessage,
    getComicVineApiKey,
    cvFetchJson,
    COMICVINE_API_URL,
    stripHtml,
    normalizeCvId
  } = deps;

  router.get('/api/v1/search/external', async (req, res) => {
    try {
      const { source = 'all', query = '' } = req.query;
      if (!query) {
        return res.status(400).json({ message: 'Query is required' });
      }

      const config = getConfig();
      const sidecarUrl = config.taggerServiceUrl || 'http://localhost:5000';
      const requestBody = { source, query };
      const rawCvApiKey = (typeof getComicVineApiKey === 'function' ? getComicVineApiKey() : null) || config.comicVineApiKey || process.env.COMICVINE_API_KEY || '';
      const cvApiKey = (cryptoVault.decrypt(rawCvApiKey) || rawCvApiKey || '').trim();
      if ((source === 'all' || source === 'comicvine' || source === 'gcd') && cvApiKey) {
        requestBody.comicvine_api_key = cvApiKey;
      }
      const rawGbApiKey = (typeof getGoogleBooksApiKey === 'function' ? getGoogleBooksApiKey() : null) || config.googleBooksApiKey || process.env.GOOGLE_BOOKS_API_KEY || '';
      const gbApiKey = (cryptoVault.decrypt(rawGbApiKey) || rawGbApiKey || '').trim();
      if (gbApiKey) {
        requestBody.google_books_api_key = gbApiKey;
      }
      const metronUser = config.metronUser || (typeof config.getMetronUser === 'function' ? config.getMetronUser() : '') || process.env.METRON_USER || '';
      const rawMetronPass = (typeof getMetronPassword === 'function' ? getMetronPassword() : null) || config.metronPassword || config.metronPass || process.env.METRON_PASSWORD || process.env.METRON_PASS || '';
      const metronPass = (cryptoVault.decrypt(rawMetronPass) || rawMetronPass || '').trim();
      if ((source === 'all' || source === 'metron' || source === 'gcd') && metronUser && metronPass) {
        requestBody.metron_user = metronUser;
        requestBody.metron_pass = metronPass;
      }
      const gcdUser = config.gcdUser || (typeof config.getGcdUser === 'function' ? config.getGcdUser() : '') || process.env.GCD_USER || '';
      const rawGcdPass = (typeof getGcdPassword === 'function' ? getGcdPassword() : null) || config.gcdPassword || config.gcdPass || process.env.GCD_PASSWORD || process.env.GCD_PASS || '';
      const gcdPass = (cryptoVault.decrypt(rawGcdPass) || rawGcdPass || '').trim();
      if ((source === 'all' || source === 'gcd') && gcdUser && gcdPass) {
        requestBody.gcd_user = gcdUser;
        requestBody.gcd_pass = gcdPass;
      }

      const response = await fetch(`${sidecarUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `Sidecar returned status ${response.status}`);
      }

      const results = await response.json();
      
      const filteredResults = Array.isArray(results) ? results.filter(item => {
        const itemSource = item.source || source;
        if (itemSource === 'gcd') {
          const num = String(item.number || item.issue_number || '');
          const title = String(item.title || '');
          if (/#?\[\s*nn\s*\]/i.test(num) || /#?\[\s*nn\s*\]/i.test(title)) {
            return false;
          }
        }
        return true;
      }) : [];

      const mappedResults = filteredResults.map((item, idx) => {
        const rawCover = item.cover_image_url || item.cover_url || '';
        const coverUrl = rawCover || '';
        const itemSource = item.source || source;
        
        const fullMetadata = {
          Title: item.title || '',
          Series: item.series || '',
          Number: item.number || item.issue_number || '',
          Summary: item.description || '',
          Publisher: item.publisher || '',
          Writer: item.writer || (Array.isArray(item.authors) ? item.authors.join(', ') : (item.authors || '')),
          Penciller: item.penciller || '',
          Inker: item.inker || '',
          Colorist: item.colorist || '',
          Letterer: item.letterer || '',
          Editor: item.editor || '',
          Genre: item.genre || (Array.isArray(item.genres) ? item.genres.join(', ') : (item.genres || '')),
          ISBN: item.isbn || '',
          Characters: Array.isArray(item.characters) ? item.characters.join(', ') : (item.characters || ''),
          Teams: Array.isArray(item.teams) ? item.teams.join(', ') : (item.teams || ''),
          Locations: Array.isArray(item.locations) ? item.locations.join(', ') : (item.locations || ''),
          'Cover Date': item.publish_date || '',
          Web: item.source_url || ''
        };

        sanitizeMetadata(fullMetadata);

        return {
          type: 'issue',
          id: `external-${itemSource}-${idx}`,
          source: itemSource,
          name: fullMetadata.Title || fullMetadata.Series || item.title || 'Unknown Title',
          volumeName: fullMetadata.Series || item.series || '',
          issueNumber: fullMetadata.Number || item.number || item.issue_number || '',
          publisher: fullMetadata.Publisher || item.publisher || '',
          coverDate: item.publish_date || '',
          image: coverUrl ? {
            thumb_url: coverUrl,
            medium_url: coverUrl,
            super_url: coverUrl,
            original_url: coverUrl
          } : null,
          fullMetadata
        };
      });

      return res.json({ results: mappedResults, total: mappedResults.length });
    } catch (e) {
      return res.status(500).json({ message: formatErrorMessage(e, req, 'Failed to search external source') });
    }
  });

  router.get('/api/v1/comicvine/volume/:volumeId/issues', async (req, res) => {
    try {
      const apiKey = getComicVineApiKey();
      if (!apiKey) {
        return res.status(400).json({ message: 'API key not set' });
      }

      const { volumeId } = req.params;
      const volIdNum = String(volumeId).replace(/^(?:\d{4}-)?(\d+)$/, '$1');

      // Fetch volume details first to get the publisher name and volume name (or get it from issues)
      const volMetaUrl =
        `${COMICVINE_API_URL}/volume/4050-${volIdNum}/?api_key=${encodeURIComponent(apiKey)}&format=json&field_list=name,publisher`;
      
      let volName = '';
      let publisher = '';
      try {
        const vmeta = await cvFetchJson(volMetaUrl);
        volName   = vmeta?.results?.name || '';
        publisher = vmeta?.results?.publisher?.name || '';
      } catch {}

      const buildIssuesUrl = (filterStr) =>
        `${COMICVINE_API_URL}/issues/?api_key=${encodeURIComponent(apiKey)}&format=json`
        + `&filter=${encodeURIComponent(filterStr)}`
        + `&field_list=id,name,issue_number,cover_date,image,volume`
        + `&sort=cover_date:asc&limit=100`;

      const matchesVolume = (arr, idNum) => {
        if (!Array.isArray(arr)) return false;
        return arr.some(is => {
          const volInIssue = is?.volume?.id ?? is?.volume;
          if (volInIssue == null) return false;
          const normalized = String(volInIssue).replace(/^(?:\d{4}-)?(\d+)$/, '$1');
          return normalized === String(idNum);
        });
      };

      let issuesUrl = buildIssuesUrl(`volume:4050-${volIdNum}`);
      let ij;
      try {
        ij = await cvFetchJson(issuesUrl);
      } catch {
        ij = { results: [] };
      }

      if (!matchesVolume(ij.results, volIdNum)) {
        issuesUrl = buildIssuesUrl(`volume:${volIdNum}`);
        try {
          ij = await cvFetchJson(issuesUrl);
        } catch {
          ij = { results: [] };
        }
      }

      if (!matchesVolume(ij.results, volIdNum)) {
        ij.results = [];
      }

      const issues = (ij.results || []).map(is => ({
        type: 'issue',
        id: is.id,
        name: is.name || (is.volume?.name || volName) || 'Unknown',
        issueNumber: is.issue_number,
        volumeName: is.volume?.name || volName || '',
        publisher,
        coverDate: is.cover_date || '',
        image: is.image || null
      }));

      return res.json(issues);
    } catch (e) {
      return res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'Failed to fetch volume issues') });
    }
  });

  router.get('/api/v1/comicvine/volume/:id', async (req, res) => {
    try {
      const apiKey = getComicVineApiKey();
      if (!apiKey) {
        return res.status(400).json({ message: 'API key not set' });
      }

      const id = req.params.id;
      const volUrl = `${COMICVINE_API_URL}/volume/4050-${encodeURIComponent(id)}/?api_key=${encodeURIComponent(apiKey)}&format=json`;
      const vjson = await cvFetchJson(volUrl);
      const volume = vjson.results;

      const normalized = {
        Title: '',
        Series: volume.name || '',
        Summary: stripHtml(volume.description || ''),
        Publisher: volume.publisher?.name || '',
        StartYear: volume.start_year || '',
        Issues: volume.count_of_issues || ''
      };

      try {
        const firstIssueIdRaw =
          volume?.first_issue?.id ??
          (Array.isArray(volume?.issues) && volume.issues.length ? volume.issues[0].id : null);

        if (firstIssueIdRaw) {
          const idStr = String(firstIssueIdRaw);
          const idNum = (idStr.match(/^(?:\d{4}-)?(\d+)$/) || [])[1] || idStr;

          const issueUrl =
            `${COMICVINE_API_URL}/issue/4000-${encodeURIComponent(idNum)}/`
            + `?api_key=${encodeURIComponent(apiKey)}&format=json&field_list=`
            + ['person_credits','character_credits','team_credits','location_credits'].join(',');

          const { results: issue } = await cvFetchJson(issueUrl);

          const roles = Array.isArray(issue?.person_credits)
            ? issue.person_credits.map(p => ({ name: p.name, role: String(p.role || '').toLowerCase() }))
            : [];

          const writers      = roles.filter(r => r.role.includes('writer')).map(r => r.name);
          const pencillers   = roles.filter(r => r.role.includes('penciller') || r.role.includes('artist')).map(r => r.name);
          const inkers       = roles.filter(r => r.role.includes('inker')).map(r => r.name);
          const colorists    = roles.filter(r => r.role.includes('colorist')).map(r => r.name);
          const letterers    = roles.filter(r => r.role.includes('letterer')).map(r => r.name);
          const coverArtists = roles.filter(r => r.role.includes('cover')).map(r => r.name);
          const editors      = roles.filter(r => r.role.includes('editor')).map(r => r.name);

          if (writers.length)      normalized.Writer      = writers.join(', ');
          if (pencillers.length)   normalized.Penciller   = pencillers.join(', ');
          if (inkers.length)       normalized.Inker       = inkers.join(', ');
          if (colorists.length)    normalized.Colorist    = colorists.join(', ');
          if (letterers.length)    normalized.Letterer    = letterers.join(', ');
          if (coverArtists.length) normalized.CoverArtist = coverArtists.join(', ');
          if (editors.length)      normalized.Editor      = editors.join(', ');

          const characters = (issue?.character_credits || []).map(c => c.name).join(', ');
          const teams      = (issue?.team_credits || []).map(t => t.name).join(', ');
          const locations  = (issue?.location_credits || []).map(l => l.name).join(', ');
          if (characters) normalized.Characters = characters;
          if (teams)      normalized.Teams      = teams;
          if (locations)  normalized.Locations  = locations;
        }
      } catch (enrichErr) {
        // Creator enrichment failed
      }

      sanitizeMetadata(normalized);
      return res.json(normalized);
    } catch (e) {
      return res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'Failed to fetch volume details') });
    }
  });

  router.get('/api/v1/comicvine/issue/:id', async (req, res) => {
    try {
      const apiKey = getComicVineApiKey();
      if (!apiKey) {
        return res.status(400).json({ message: 'API key not set' });
      }

      const idNum = normalizeCvId(req.params.id);

      const issueUrl =
        `${COMICVINE_API_URL}/issue/4000-${encodeURIComponent(idNum)}/`
        + `?api_key=${encodeURIComponent(apiKey)}`
        + `&format=json&field_list=` + [
          'name','issue_number','description',
          'person_credits','character_credits','team_credits','location_credits',
          'publisher','volume','cover_date','store_date'
        ].join(',');

      const data = await cvFetchJson(issueUrl);
      const issue = data?.results;

      let publisher =
        issue?.publisher?.name ||
        issue?.volume?.publisher?.name ||
        '';

      let volUrl = null;
      if (!publisher && issue?.volume?.id) {
        const volIdNum = normalizeCvId(issue.volume.id);
        volUrl =
          `${COMICVINE_API_URL}/volume/4050-${encodeURIComponent(volIdNum)}/`
          + `?api_key=${encodeURIComponent(apiKey)}&format=json`;
        try {
          const vjson = await cvFetchJson(volUrl);
          if (vjson?.results?.publisher?.name) {
            publisher = vjson.results.publisher.name;
          }
        } catch (err) {
          // Fallback failed
        }
      }

      const title = issue?.name || '';
      const series = issue?.volume?.name || '';
      const number = issue?.issue_number || '';
      const summary = stripHtml(issue?.description || '');

      let writer = '', penciller = '', inker = '', colorist = '', letterer = '', coverArtist = '', editor = '';
      if (Array.isArray(issue?.person_credits)) {
        const roles = issue.person_credits.map(p => ({ name: p.name, role: (p.role || '').toLowerCase() }));
        writer      = roles.filter(r => r.role.includes('writer')).map(r => r.name).join(', ');
        penciller   = roles.filter(r => r.role.includes('penciller') || r.role.includes('artist')).map(r => r.name).join(', ');
        inker       = roles.filter(r => r.role.includes('inker')).map(r => r.name).join(', ');
        colorist    = roles.filter(r => r.role.includes('colorist')).map(r => r.name).join(', ');
        letterer    = roles.filter(r => r.role.includes('letterer')).map(r => r.name).join(', ');
        coverArtist = roles.filter(r => r.role.includes('cover')).map(r => r.name).join(', ');
        editor      = roles.filter(r => r.role.includes('editor')).map(r => r.name).join(', ');
      }

      const characters = (issue?.character_credits || []).map(c => c.name).join(', ');
      const teams      = (issue?.team_credits || []).map(t => t.name).join(', ');
      const locations  = (issue?.location_credits || []).map(l => l.name).join(', ');

      const issueMeta = {
        Title: title,
        Series: series,
        Number: number,
        Summary: summary,
        Writer: writer,
        Penciller: penciller,
        Inker: inker,
        Colorist: colorist,
        Letterer: letterer,
        CoverArtist: coverArtist,
        Editor: editor,
        Publisher: publisher,
        Characters: characters,
        Teams: teams,
        Locations: locations,
        'Cover Date': issue?.cover_date || '',
        'Store Date': issue?.store_date || ''
      };

      sanitizeMetadata(issueMeta);

      res.json(issueMeta);
    } catch (e) {
      res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'Failed to fetch issue details') });
    }
  });
}

module.exports = {
  attachIssuesRoutes
};
