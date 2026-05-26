/**
 * User Metadata Routes
 * 
 * Handles comic metadata retrieval and ComicVine searching.
 */
module.exports = function attach(router, deps) {
  const {
    dbGet,
    log,
    formatErrorMessage,
    isPathSafe,
    resolvePath,
    checkComicAccess,
    getComicsDirectories,
    createId,
    getComicVineApiKey,
    cvFetchJson,
    COMICVINE_API_URL,
    stripHtml,
    normalizeCvId
  } = deps;

  router.get('/api/v1/comics/info', async (req, res) => {
    try {
      const pB64 = req.query.path || '';
      const rawPath = Buffer.from(pB64, 'base64').toString('utf-8');
      const p = resolvePath(rawPath);
      if (!p) return res.status(400).json({ message: 'No path' });

      // Security: Validate path is within allowed directories
      if (!isPathSafe(p)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Security: Validate user has access to this specific comic
      const comic = await dbGet('SELECT id, publisher, series FROM comics WHERE path = ?', [p]);
      if (comic) {
        const hasAccess = await checkComicAccess(
          req.user.userId,
          req.user.role,
          p,
          comic.publisher,
          comic.series,
          getComicsDirectories(),
          comic.id
        );
        if (!hasAccess) {
          log('WARN', 'SECURITY', `User ${req.user.userId} denied access to comic info: ${p}`);
          return res.status(403).json({ message: 'Access denied' });
        }
      }

      const id = createId(p);
      const row = await dbGet('SELECT metadata FROM comics WHERE id = ?', [id]);
      let meta = {};
      try { meta = JSON.parse(row?.metadata || '{}'); } catch {}
      return res.json(meta);
    } catch (e) {
      return res.status(500).json({ message: formatErrorMessage(e, req, 'Failed to fetch comic info') });
    }
  });

  router.get('/api/v1/search/comicvine', async (req, res) => {
    try {
      const apiKey = getComicVineApiKey();
      if (!apiKey) {
        return res.status(400).json({ message: 'API key not set' });
      }

      const {
        query = '',
        resources = 'issue',
        page = 1,
        limit = 20,
        sort = '',
        filter = '',
        issueNumber = '',
        year = ''
      } = req.query;

      const limitNum = parseInt(limit) || 20;
      const pageNum = parseInt(page) || 1;
      const offset = (pageNum - 1) * limitNum;

      let results = [];
      let totalResults = 0;
      let usedFallback = false;

      // 1. Volumes search
      if (resources === 'volume') {
        if (query) {
          // Structured search via `/volumes`
          let volFilter = `name:${query}`;
          if (year) {
            volFilter += `,start_year:${year}`;
          }

          let volUrl = `${COMICVINE_API_URL}/volumes/?api_key=${encodeURIComponent(apiKey)}&format=json`
                     + `&filter=${encodeURIComponent(volFilter)}`
                     + `&limit=${limitNum}`
                     + `&offset=${offset}`
                     + `&field_list=id,name,publisher,image,start_year,date_added`;

          // Pass sort natively if valid for volumes (name, date_added, start_year)
          if (sort && !sort.startsWith('cover_date:')) {
            volUrl += `&sort=${encodeURIComponent(sort)}`;
          }

          const vdata = await cvFetchJson(volUrl);
          totalResults = vdata.number_of_total_results || 0;

          for (const item of (vdata.results || [])) {
            results.push({
              type: 'volume',
              id: item.id,
              name: item.name || 'Unknown',
              volumeName: null,
              issueNumber: null,
              coverDate: item.date_added || null,
              startYear: item.start_year || '',
              publisher: item.publisher?.name || '',
              image: item.image || null
            });
          }
        } else {
          // Fallback to fuzzy search if no query provided
          usedFallback = true;
        }
      } 
      // 2. Issue search
      else if (resources === 'issue') {
        if (query && issueNumber) {
          // Precise two-stage resolution: search volumes first, then query issues
          let volFilter = `name:${query}`;
          if (year) {
            volFilter += `,start_year:${year}`;
          }

          let volUrl = `${COMICVINE_API_URL}/volumes/?api_key=${encodeURIComponent(apiKey)}&format=json`
                     + `&filter=${encodeURIComponent(volFilter)}&limit=10&field_list=id,publisher`;

          const vdata = await cvFetchJson(volUrl);
          const volumes = vdata.results || [];
          const volumePublisherMap = {};
          for (const vol of volumes) {
            const volId = String(vol.id).replace(/^(?:\d{4}-)?(\d+)$/, '$1');
            volumePublisherMap[volId] = vol.publisher?.name || '';
          }

          if (volumes.length > 0) {
            const volIds = volumes.map(v => v.id);
            let idata = null;

            // Try with 4050-id format first
            try {
              const filter1 = `volume:${volIds.map(id => `4050-${id}`).join('|')},issue_number:${issueNumber}`;
              let url = `${COMICVINE_API_URL}/issues/?api_key=${encodeURIComponent(apiKey)}&format=json`
                      + `&filter=${encodeURIComponent(filter1)}&limit=${limitNum}&offset=${offset}`
                      + `&field_list=id,name,issue_number,cover_date,image,volume`;
              if (sort) url += `&sort=${encodeURIComponent(sort)}`;
              idata = await cvFetchJson(url);
            } catch {}

            // Try with raw id format as fallback
            if (!idata || !idata.results || idata.results.length === 0) {
              try {
                const filter2 = `volume:${volIds.join('|')},issue_number:${issueNumber}`;
                let url = `${COMICVINE_API_URL}/issues/?api_key=${encodeURIComponent(apiKey)}&format=json`
                        + `&filter=${encodeURIComponent(filter2)}&limit=${limitNum}&offset=${offset}`
                        + `&field_list=id,name,issue_number,cover_date,image,volume`;
                if (sort) url += `&sort=${encodeURIComponent(sort)}`;
                idata = await cvFetchJson(url);
              } catch {}
            }

            if (idata && idata.results) {
              totalResults = idata.number_of_total_results || 0;
              for (const item of idata.results) {
                const volId = item.volume?.id ? String(item.volume.id).replace(/^(?:\d{4}-)?(\d+)$/, '$1') : null;
                const publisherName = volId ? volumePublisherMap[volId] : '';
                results.push({
                  type: 'issue',
                  id: item.id,
                  name: item.name || item.volume?.name || 'Unknown',
                  volumeName: item.volume?.name || null,
                  volumeId: volId,
                  issueNumber: item.issue_number || null,
                  coverDate: item.cover_date || item.date_added || null,
                  startYear: '',
                  publisher: publisherName || item.publisher?.name || item.volume?.publisher?.name || '',
                  image: item.image || null
                });
              }
            } else {
              usedFallback = true;
            }
          } else {
            usedFallback = true;
          }
        } else {
          // Missing structured search params (no issueNumber or no query)
          usedFallback = true;
        }
      }

      // 3. Fuzzy search fallback
      if (usedFallback || (resources !== 'volume' && resources !== 'issue')) {
        let searchUrl = `${COMICVINE_API_URL}/search/?api_key=${encodeURIComponent(apiKey)}&format=json`
                      + `&query=${encodeURIComponent(query)}`
                      + `&resources=${encodeURIComponent(resources)}`
                      + `&page=${pageNum}`
                      + `&limit=${limitNum}`;
        if (sort)   searchUrl += `&sort=${encodeURIComponent(sort)}`;
        if (filter) searchUrl += `&filter=${encodeURIComponent(filter)}`;

        const sdata = await cvFetchJson(searchUrl);
        totalResults = sdata.number_of_total_results || 0;

        for (const item of (sdata.results || [])) {
          const type = item.api_detail_url?.includes('/issue/') ? 'issue' : 'volume';
          const volId = item.volume?.id ? String(item.volume.id).replace(/^(?:\d{4}-)?(\d+)$/, '$1') : null;
          results.push({
            type,
            id: item.id,
            name: item.name || item.volume?.name || 'Unknown',
            volumeName: item.volume?.name || null,
            volumeId: volId,
            issueNumber: item.issue_number || null,
            coverDate: item.cover_date || item.date_added || null,
            startYear: item.start_year || item.startYear || '',
            publisher: item.publisher?.name || item.volume?.publisher?.name || '',
            image: item.image || null
          });
        }

        // Apply in-memory fallback sorting since ComicVine's /search endpoint ignores the sort parameter
        if (sort) {
          const [field, direction] = sort.split(':');
          const isAsc = direction === 'asc';

          results.sort((a, b) => {
            let valA, valB;
            if (field === 'name') {
              valA = (a.name || '').toLowerCase();
              valB = (b.name || '').toLowerCase();
            } else if (field === 'cover_date' || field === 'date_added') {
              valA = a.coverDate || '';
              valB = b.coverDate || '';
            } else {
              return 0;
            }

            if (valA < valB) return isAsc ? -1 : 1;
            if (valA > valB) return isAsc ? 1 : -1;
            return 0;
          });
        }
      }

      // Helper function to enrich issue search results with publisher names in batch (exactly 1 API call, no N+1 bottleneck!)
      async function enrichIssuesWithPublisher(resList, apiKey) {
        const issuesMissingPublisher = resList.filter(r => r.type === 'issue' && r.volumeId && !r.publisher);
        if (issuesMissingPublisher.length === 0) return;

        const uniqueVolIds = [...new Set(issuesMissingPublisher.map(r => r.volumeId))];
        if (uniqueVolIds.length === 0) return;

        try {
          const volUrl = `${COMICVINE_API_URL}/volumes/?api_key=${encodeURIComponent(apiKey)}&format=json`
                       + `&filter=id:${encodeURIComponent(uniqueVolIds.join('|'))}&field_list=id,publisher`;

          const vdata = await cvFetchJson(volUrl);
          const volPubMap = {};
          for (const vol of (vdata.results || [])) {
            const normalizedId = String(vol.id).replace(/^(?:\d{4}-)?(\d+)$/, '$1');
            volPubMap[normalizedId] = vol.publisher?.name || '';
          }

          for (const r of resList) {
            if (r.type === 'issue' && r.volumeId && !r.publisher) {
              r.publisher = volPubMap[r.volumeId] || '';
            }
          }
        } catch (err) {
          // Ignore enrichment errors gracefully to avoid breaking search
        }
      }

      // Apply in-memory year and issue number filters to guarantee strict correctness across both fallback fuzzy searches and structured searches
      if (year) {
        const yearStr = String(year).trim();
        results = results.filter(item => {
          if (item.type === 'volume') {
            return String(item.startYear).trim() === yearStr;
          }
          return true;
        });
      }

      if (issueNumber && resources === 'issue') {
        const numStr = String(issueNumber).trim();
        results = results.filter(item => {
          if (item.type === 'issue') {
            return String(item.issueNumber).trim() === numStr;
          }
          return true;
        });
      }

      // Enrich issue results with publisher names in batch
      await enrichIssuesWithPublisher(results, apiKey);

      return res.json({
        total: totalResults || results.length,
        results
      });
    } catch (e) {
      return res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'ComicVine search failed') });
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
        Title: volume.name || 'Unknown',
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

          const writers    = roles.filter(r => r.role.includes('writer')).map(r => r.name);
          const pencillers = roles.filter(r => r.role.includes('penciller') || r.role.includes('artist')).map(r => r.name);

          if (writers.length)    normalized.Writer    = writers.join(', ');
          if (pencillers.length) normalized.Penciller = pencillers.join(', ');

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

      let publisherFrom = '';
      let publisher =
        (issue?.publisher?.name && (publisherFrom = 'issue.publisher')) && issue.publisher.name ||
        (issue?.volume?.publisher?.name && (publisherFrom = 'issue.volume.publisher')) && issue.volume.publisher.name ||
        '';

      let volStatus = null;
      let volUrl = null;
      if (!publisher && issue?.volume?.id) {
        const volIdNum = normalizeCvId(issue.volume.id);
        volUrl =
          `${COMICVINE_API_URL}/volume/4050-${encodeURIComponent(volIdNum)}/`
          + `?api_key=${encodeURIComponent(apiKey)}&format=json`;
        try {
          const vjson = await cvFetchJson(volUrl);
          volStatus = 200;
          if (vjson?.results?.publisher?.name) {
            publisher = vjson.results.publisher.name;
            publisherFrom = 'volume.publisher (fallback)';
          }
        } catch (err) {
          volStatus = err.status;
        }
      }

      const title = issue?.name || issue?.volume?.name || 'Unknown';
      const series = issue?.volume?.name || '';
      const number = issue?.issue_number || '';
      const summary = stripHtml(issue?.description || '');

      let writer = '', penciller = '';
      if (Array.isArray(issue?.person_credits)) {
        const roles = issue.person_credits.map(p => ({ name: p.name, role: (p.role || '').toLowerCase() }));
        writer    = roles.filter(r => r.role.includes('writer')).map(r => r.name).join(', ');
        penciller = roles.filter(r => r.role.includes('penciller') || r.role.includes('artist')).map(r => r.name).join(', ');
      }

      const characters = (issue?.character_credits || []).map(c => c.name).join(', ');
      const teams      = (issue?.team_credits || []).map(t => t.name).join(', ');
      const locations  = (issue?.location_credits || []).map(l => l.name).join(', ');

      res.json({
        Title: title,
        Series: series,
        Number: number,
        Summary: summary,
        Writer: writer,
        Penciller: penciller,
        Publisher: publisher,
        Characters: characters,
        Teams: teams,
        Locations: locations,
        'Cover Date': issue?.cover_date || '',
        'Store Date': issue?.store_date || ''
      });
    } catch (e) {
      res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'Failed to fetch issue details') });
    }
  });
};
