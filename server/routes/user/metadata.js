/**
 * User Metadata Routes
 * 
 * Handles comic metadata retrieval and ComicVine searching.
 */
const { cleanFormatAndEdition, splitVolumeSeriesAndTitle, isTitleSameAsSeries, sanitizeMetadata } = require('../../services/metadata');

module.exports = function attach(router, deps) {
  const {
    dbGet,
    dbAll,
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

  router.get('/api/v1/search/external', async (req, res) => {
    try {
      const { source = 'all', query = '' } = req.query;
      if (!query) {
        return res.status(400).json({ message: 'Query is required' });
      }

      const { getConfig } = require('../../config');
      const config = getConfig();
      const sidecarUrl = config.taggerServiceUrl || 'http://localhost:5000';
      const requestBody = { source, query };
      const cvApiKey = (typeof getComicVineApiKey === 'function' ? getComicVineApiKey() : null) || config.comicVineApiKey || process.env.COMICVINE_API_KEY || '';
      if ((source === 'all' || source === 'comicvine' || source === 'gcd') && cvApiKey) {
        requestBody.comicvine_api_key = cvApiKey;
      }
      if (config.googleBooksApiKey) {
        requestBody.google_books_api_key = config.googleBooksApiKey;
      }
      const metronUser = config.metronUser || (typeof config.getMetronUser === 'function' ? config.getMetronUser() : '') || process.env.METRON_USER || '';
      const metronPass = config.metronPassword || config.metronPass || (typeof config.getMetronPassword === 'function' ? config.getMetronPassword() : '') || process.env.METRON_PASSWORD || process.env.METRON_PASS || '';
      if ((source === 'all' || source === 'metron' || source === 'gcd') && metronUser && metronPass) {
        requestBody.metron_user = metronUser;
        requestBody.metron_pass = metronPass;
      }
      const gcdUser = config.gcdUser || (typeof config.getGcdUser === 'function' ? config.getGcdUser() : '') || process.env.GCD_USER || '';
      const gcdPass = config.gcdPassword || config.gcdPass || (typeof config.getGcdPassword === 'function' ? config.getGcdPassword() : '') || process.env.GCD_PASSWORD || process.env.GCD_PASS || '';
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

  function computeTextSimilarity(a, b) {
    if (!a || !b) return 0;
    const wordsA = new Set(String(a).toLowerCase().match(/\b\w+\b/g) || []);
    const wordsB = new Set(String(b).toLowerCase().match(/\b\w+\b/g) || []);
    if (!wordsA.size || !wordsB.size) return 0;
    let intersect = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersect++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersect / union : 0;
  }

  async function resolveFallbackCoverImage(series, issueNumber, queryContext, reqTargetUrl = '', description = '') {
    const { getConfig } = require('../../config');
    const config = getConfig();
    const sidecarUrl = config.taggerServiceUrl || 'http://localhost:5000';
    const cvApiKey = (typeof getComicVineApiKey === 'function' ? getComicVineApiKey() : null) || config.comicVineApiKey || process.env.COMICVINE_API_KEY || '';
    const metronUser = config.metronUser || (typeof config.getMetronUser === 'function' ? config.getMetronUser() : '') || process.env.METRON_USER || '';
    const metronPass = config.metronPassword || config.metronPass || (typeof config.getMetronPassword === 'function' ? config.getMetronPassword() : '') || process.env.METRON_PASSWORD || process.env.METRON_PASS || '';

    let sName = (series || '').trim();
    let issNum = (issueNumber || '').trim();
    let issueDesc = (description || '').trim();

    if (!sName && queryContext) {
      const m = queryContext.trim().match(/^(.*?)(?:\s*#\s*([\d.]+))?$/);
      if (m) {
        sName = m[1].trim();
        if (!issNum && m[2]) issNum = m[2].trim();
      } else {
        sName = queryContext.trim();
      }
    }

    // If still no series, try extracting GCD issue ID from the targetUrl if it was from comics.org
    if ((!sName || !issueDesc) && reqTargetUrl && reqTargetUrl.includes('comics.org')) {
      const gcdIssueMatch = reqTargetUrl.match(/(?:covers_by_id\/\d+\/(?:w\d+\/)?|issue\/)(\d+)/);
      if (gcdIssueMatch) {
        try {
          const gcdIssueRes = await fetch(`https://www.comics.org/api/issue/${gcdIssueMatch[1]}/`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'ComicsNow/1.0' },
            signal: AbortSignal.timeout(3000)
          });
          if (gcdIssueRes.ok) {
            const gcdIssueData = await gcdIssueRes.json();
            if (!sName && gcdIssueData.series_name) {
              sName = gcdIssueData.series_name;
              if (!issNum && gcdIssueData.number) issNum = String(gcdIssueData.number);
            }
            if (!issueDesc && gcdIssueData.notes) {
              issueDesc = gcdIssueData.notes;
            }
          }
        } catch {}
      }
    }

    if (!sName) return null;

    async function fetchCoverBuffer(imgUrl) {
      if (!imgUrl || typeof imgUrl !== 'string' || imgUrl.includes('comics.org')) return null;
      try {
        const r = await fetch(imgUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(5000)
        });
        if (!r.ok) return null;
        const cType = r.headers.get('content-type') || 'image/jpeg';
        if (!cType.startsWith('image/')) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 100) return null;
        return { buffer: buf, contentType: cType };
      } catch {
        return null;
      }
    }

    // 1. Try ComicVine with series/number match and description closeness
    if (cvApiKey) {
      try {
        const cvQuery = `${sName} ${issNum}`.trim();
        const searchUrl = `${COMICVINE_API_URL}/search/?api_key=${encodeURIComponent(cvApiKey)}&format=json&resources=issue&query=${encodeURIComponent(cvQuery)}&limit=10`;
        const sdata = await cvFetchJson(searchUrl);
        const matches = (sdata?.results || []).filter(m => {
          const vName = m.volume?.name || '';
          const mNum = m.issue_number != null ? String(m.issue_number).trim() : '';
          const vMatch = vName.toLowerCase().includes(sName.toLowerCase()) || sName.toLowerCase().includes(vName.toLowerCase());
          const nMatch = !issNum || mNum === issNum;
          const hasImg = !!(m.image?.medium_url || m.image?.super_url || m.image?.thumb_url);
          return vMatch && nMatch && hasImg;
        });

        if (matches.length > 0) {
          if (issueDesc && matches.length > 1) {
            matches.sort((a, b) => {
              const descA = (a.description || a.deck || '').replace(/<[^>]*>/g, '');
              const descB = (b.description || b.deck || '').replace(/<[^>]*>/g, '');
              return computeTextSimilarity(descB, issueDesc) - computeTextSimilarity(descA, issueDesc);
            });
          }
          const best = matches[0];
          const imgCandidate = best?.image?.medium_url || best?.image?.super_url || best?.image?.thumb_url;
          if (imgCandidate) {
            const resImg = await fetchCoverBuffer(imgCandidate);
            if (resImg) return resImg;
          }
        }

        const volUrl = `${COMICVINE_API_URL}/volumes/?api_key=${encodeURIComponent(cvApiKey)}&format=json&filter=name:${encodeURIComponent(sName)}&limit=1&field_list=image`;
        const vdata = await cvFetchJson(volUrl);
        const vMatch = (vdata?.results || [])[0];
        const vImg = vMatch?.image?.medium_url || vMatch?.image?.super_url || vMatch?.image?.thumb_url;
        if (vImg) {
          const resImg = await fetchCoverBuffer(vImg);
          if (resImg) return resImg;
        }
      } catch {}
    }

    // 2. Try Metron via sidecar with series/number match and description closeness
    if (metronUser && metronPass) {
      try {
        const mQuery = `${sName} ${issNum ? '#' + issNum : ''}`.trim();
        const mRes = await fetch(`${sidecarUrl}/api/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'metron',
            query: mQuery,
            metron_user: metronUser,
            metron_pass: metronPass
          }),
          signal: AbortSignal.timeout(4000)
        });
        if (mRes.ok) {
          const mItems = await mRes.json();
          const candidates = (mItems || []).filter(item => {
            const mCov = item.cover_image_url || item.cover_url;
            return mCov && !mCov.includes('comics.org');
          });
          if (candidates.length > 0) {
            if (issueDesc && candidates.length > 1) {
              candidates.sort((a, b) => {
                const descA = a.description || a.summary || '';
                const descB = b.description || b.summary || '';
                return computeTextSimilarity(descB, issueDesc) - computeTextSimilarity(descA, issueDesc);
              });
            }
            for (const item of candidates) {
              const mCov = item.cover_image_url || item.cover_url;
              const resImg = await fetchCoverBuffer(mCov);
              if (resImg) return resImg;
            }
          }
        }
      } catch {}
    }

    // 3. Try OpenLibrary Search
    try {
      const olSearchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(sName)}&limit=3`;
      const olRes = await fetch(olSearchUrl, { signal: AbortSignal.timeout(3000) });
      if (olRes.ok) {
        const olData = await olRes.json();
        for (const doc of (olData?.docs || [])) {
          if (doc.cover_i) {
            const olCover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
            const resImg = await fetchCoverBuffer(olCover);
            if (resImg) return resImg;
          }
        }
      }
    } catch {}

    return null;
  }

  router.get('/api/v1/proxy/cover', async (req, res) => {
    try {
      const targetUrl = req.query.url;
      if (!targetUrl || typeof targetUrl !== 'string') {
        return res.status(400).end();
      }

      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        return res.status(400).end();
      }

      let parsed;
      try {
        parsed = new URL(targetUrl);
      } catch {
        return res.status(400).end();
      }

      const allowedHosts = [
        'comics.org',
        'files1.comics.org',
        'files.comics.org',
        'comicvine.gamespot.com',
        'metron.cloud',
        'covers.openlibrary.org',
        'books.google.com',
        'googleusercontent.com',
        'media-amazon.com',
        'images.amazon.com',
        'forbiddenplanet.com',
        'waterstones.com',
        'blackwells.co.uk'
      ];

      const isAllowed = allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
      if (!isAllowed) {
        return res.status(403).end();
      }

      const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="112" viewBox="0 0 80 112"><rect width="100%" height="100%" fill="#1f2937"/><rect x="2" y="2" width="76" height="108" fill="none" stroke="#374151" stroke-width="1.5" rx="4"/><text x="50%" y="45%" fill="#9ca3af" font-size="11" font-weight="bold" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">GCD</text><text x="50%" y="62%" fill="#6b7280" font-size="8" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">NO COVER</text></svg>`;

      // If domain is comics.org (GCD):
      // 1. First, try to get cover directly from GCD API/server
      // 2. If cover not available (403/404/failure), do a series/number match with description closeness on Metron or ComicVine
      // 3. If neither available, serve fallback default image
      if (parsed.hostname.includes('comics.org')) {
        let gcdDirectCover = null;
        try {
          const gcdRes = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
              'Referer': 'https://www.comics.org/'
            },
            signal: AbortSignal.timeout(3000)
          });
          if (gcdRes.ok) {
            const ct = gcdRes.headers.get('content-type') || 'image/jpeg';
            if (ct.startsWith('image/')) {
              const ab = await gcdRes.arrayBuffer();
              const buf = Buffer.from(ab);
              if (buf.length > 100) {
                gcdDirectCover = { buffer: buf, contentType: ct };
              }
            }
          }
        } catch (_) {}

        if (gcdDirectCover) {
          res.setHeader('Content-Type', gcdDirectCover.contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(gcdDirectCover.buffer);
        }

        const fallback = await resolveFallbackCoverImage(
          req.query.series,
          req.query.issue || req.query.number,
          req.query.query,
          targetUrl,
          req.query.description || req.query.notes || ''
        );
        if (fallback) {
          res.setHeader('Content-Type', fallback.contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(fallback.buffer);
        }
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(fallbackSvg);
      }

      // For other allowed hosts (ComicVine, Metron, OpenLibrary, Amazon, etc.), fetch directly
      try {
        const fetchRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(5000)
        });
        if (fetchRes.ok) {
          const ct = fetchRes.headers.get('content-type') || 'image/jpeg';
          if (ct.startsWith('image/')) {
            const ab = await fetchRes.arrayBuffer();
            const buf = Buffer.from(ab);
            if (buf.length > 100) {
              res.setHeader('Content-Type', ct);
              res.setHeader('Cache-Control', 'public, max-age=86400');
              return res.send(buf);
            }
          }
        }
      } catch (err) {
        // Direct fetch failed
      }

      // If direct fetch failed, try fallback
      const fallback = await resolveFallbackCoverImage(req.query.series, req.query.issue || req.query.number, req.query.query, targetUrl);
      if (fallback) {
        res.setHeader('Content-Type', fallback.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(fallback.buffer);
      }
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(fallbackSvg);
    } catch {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="112" viewBox="0 0 80 112"><rect width="100%" height="100%" fill="#1f2937"/><text x="50%" y="50%" fill="#9ca3af" font-size="9" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">NO COVER</text></svg>`;
      return res.send(fallbackSvg);
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

  if (typeof router.post === 'function') {
    router.post('/api/v1/metadata/synthesize', async (req, res) => {
    try {
      const { sources, filename, existingMeta } = req.body || {};

      if (!Array.isArray(sources) || sources.length < 2) {
        return res.status(400).json({
          message: 'At least 2 sources are required for synthesis. For a single source, apply it directly.'
        });
      }

      // Check Gemini API key
      const { getConfig } = require('../../config');
      const config = getConfig();
      let geminiApiKey = (process.env.NODE_ENV === 'test' ? '' : process.env.GEMINI_API_KEY) || config.geminiApiKey || '';
      let geminiModel = config.geminiModel || 'gemini-3.5-flash-lite';

      try {
        if (typeof dbGet === 'function') {
          const keyRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiApiKey'");
          if (keyRow?.value) {
            try { geminiApiKey = JSON.parse(keyRow.value); } catch { geminiApiKey = keyRow.value; }
          }
          const modelRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiModel'");
          if (modelRow?.value) {
            try { geminiModel = JSON.parse(modelRow.value); } catch { geminiModel = modelRow.value; }
          }
        }
      } catch (err) {
        // Fallback to config / env
      }

      if (!geminiApiKey) {
        return res.status(400).json({
          message: 'Gemini API key is not configured. Please configure your API key in Settings.'
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

      // Normalize candidate objects for synthesis
      const formattedCandidates = sources.map(s => {
        const meta = s.fullMetadata || s.metadata || s;
        const title = meta.Title || meta.title || s.name || s.title || '';
        const series = meta.Series || meta.series || s.volumeName || s.series || '';
        const issue = meta.Number != null ? String(meta.Number) : (meta.number != null ? String(meta.number) : (meta.issue != null ? String(meta.issue) : (s.issueNumber != null ? String(s.issueNumber) : '')));
        const publisher = meta.Publisher || meta.publisher || s.publisher || '';
        const coverDate = meta['Cover Date'] || meta.cover_date || meta.publish_date || s.coverDate || '';
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

      const { synthesizeMetadataWithGemini } = require('../../services/gemini-metadata');
      const synthesized = await synthesizeMetadataWithGemini({
        winningCandidate: formattedCandidates[0],
        allCandidates: formattedCandidates,
        filename: filename || 'Unknown Comic.cbz',
        existingMeta: existingMeta || {},
        publisherCodex,
        apiKey: geminiApiKey,
        model: geminiModel
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

      // Check Gemini API key
      const { getConfig } = require('../../config');
      const config = getConfig();
      let geminiApiKey = (process.env.NODE_ENV === 'test' ? '' : process.env.GEMINI_API_KEY) || config.geminiApiKey || '';
      let geminiModel = config.geminiModel || 'gemini-3.5-flash-lite';

      try {
        if (typeof dbGet === 'function') {
          const keyRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiApiKey'");
          if (keyRow?.value) {
            try { geminiApiKey = JSON.parse(keyRow.value); } catch { geminiApiKey = keyRow.value; }
          }
          const modelRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiModel'");
          if (modelRow?.value) {
            try { geminiModel = JSON.parse(modelRow.value); } catch { geminiModel = modelRow.value; }
          }
        }
      } catch (_) {}

      if (!geminiApiKey) {
        return res.status(400).json({
          message: 'Gemini API key is not configured. Please configure your API key in Settings.'
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

      const { extractMetadataFromUrl } = require('../../services/url-metadata-extractor');
      const metadata = await extractMetadataFromUrl({
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
};
