/**
 * User Metadata Search & Comic Info Routes
 *
 * Handles GET /api/v1/comics/info and GET /api/v1/search/comicvine.
 */

function attachSearchRoutes(router, deps) {
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
    COMICVINE_API_URL
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
        const hasAccess = await checkComicAccess({
          userId: req.user.userId,
          userRole: req.user.role,
          comicPath: p,
          publisher: comic.publisher,
          series: comic.series,
          rootFolders: getComicsDirectories(),
          comicId: comic.id
        });
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
                     + `&filter=${encodeURIComponent(volFilter)}&limit=10&field_list=id,publisher,start_year`;

          const vdata = await cvFetchJson(volUrl);
          const volumes = vdata.results || [];
          const volumePublisherMap = {};
          const volumeYearMap = {};
          for (const vol of volumes) {
            const volId = String(vol.id).replace(/^(?:\d{4}-)?(\d+)$/, '$1');
            volumePublisherMap[volId] = vol.publisher?.name || '';
            volumeYearMap[volId] = vol.start_year || '';
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
                const startYearVal = volId ? volumeYearMap[volId] : '';
                results.push({
                  type: 'issue',
                  id: item.id,
                  name: item.name || item.volume?.name || 'Unknown',
                  volumeName: item.volume?.name || null,
                  volumeId: volId,
                  issueNumber: item.issue_number || null,
                  coverDate: item.cover_date || item.date_added || null,
                  startYear: startYearVal,
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

      // Helper function to enrich issue search results with publisher names and volume start years in batch (exactly 1 API call, no N+1 bottleneck!)
      async function enrichIssuesWithPublisher(resList, apiKey) {
        const issuesMissingDetails = resList.filter(r => r.type === 'issue' && r.volumeId && (!r.publisher || !r.startYear));
        if (issuesMissingDetails.length === 0) return;

        const uniqueVolIds = [...new Set(issuesMissingDetails.map(r => r.volumeId))];
        if (uniqueVolIds.length === 0) return;

        try {
          const volUrl = `${COMICVINE_API_URL}/volumes/?api_key=${encodeURIComponent(apiKey)}&format=json`
                       + `&filter=id:${encodeURIComponent(uniqueVolIds.join('|'))}&field_list=id,publisher,start_year`;

          const vdata = await cvFetchJson(volUrl);
          const volPubMap = {};
          const volYearMap = {};
          for (const vol of (vdata.results || [])) {
            const normalizedId = String(vol.id).replace(/^(?:\d{4}-)?(\d+)$/, '$1');
            volPubMap[normalizedId] = vol.publisher?.name || '';
            volYearMap[normalizedId] = vol.start_year || '';
          }

          for (const r of resList) {
            if (r.type === 'issue' && r.volumeId) {
              if (!r.publisher) r.publisher = volPubMap[r.volumeId] || '';
              if (!r.startYear) r.startYear = volYearMap[r.volumeId] || '';
            }
          }
        } catch (err) {
          // Ignore enrichment errors gracefully to avoid breaking search
        }
      }

      // Enrich issue results with publisher names and start years in batch FIRST so we can filter by them
      await enrichIssuesWithPublisher(results, apiKey);

      // Apply in-memory year and issue number filters to guarantee strict correctness across both fallback fuzzy searches and structured searches
      if (year) {
        const yearStr = String(year).trim();
        results = results.filter(item => {
          if (item.type === 'volume') {
            return String(item.startYear).trim() === yearStr;
          } else if (item.type === 'issue') {
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

      return res.json({
        total: totalResults || results.length,
        results
      });
    } catch (e) {
      return res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'ComicVine search failed') });
    }
  });
}

module.exports = {
  attachSearchRoutes
};
