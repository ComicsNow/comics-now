/**
 * User Metadata Routes
 * 
 * Handles comic metadata retrieval and ComicVine searching.
 */
const { cleanFormatAndEdition, splitVolumeSeriesAndTitle, isTitleSameAsSeries, sanitizeMetadata } = require('../../services/metadata');

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
      
      const mappedResults = results.map((item, idx) => {
        const coverUrl = item.cover_image_url || item.cover_url || '';
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
          image: {
            thumb_url: coverUrl,
            medium_url: coverUrl,
            super_url: coverUrl,
            original_url: coverUrl
          },
          fullMetadata
        };
      });

      // Cross-enrich covers: if a candidate (e.g. GCD) has a Cloudflare-blocked cover,
      // borrow an accessible cover from another candidate in this batch (e.g. ComicVine, Metron)
      for (const item of mappedResults) {
        const isBlocked = !item.image?.thumb_url || item.image.thumb_url.includes('comics.org');
        if (isBlocked) {
          const partner = mappedResults.find(other =>
            other !== item &&
            other.image?.thumb_url &&
            !other.image.thumb_url.includes('comics.org') &&
            other.volumeName &&
            item.volumeName &&
            other.volumeName.toLowerCase().trim() === item.volumeName.toLowerCase().trim() &&
            (!item.issueNumber || !other.issueNumber || String(item.issueNumber).trim() === String(other.issueNumber).trim())
          );
          if (partner) {
            item.image = { ...partner.image };
          }
        }
      }

      // If any items are still blocked or missing covers (e.g. GCD results without a batch partner),
      // cross-enrich via OpenLibrary, ComicVine, or Metron
      for (const item of mappedResults) {
        const isBlocked = !item.image?.thumb_url || item.image.thumb_url.includes('comics.org');
        if (isBlocked) {
          const sName = (item.volumeName || query || '').trim();
          const issNum = (item.issueNumber || '').trim();
          const cleanIsbn = (item.fullMetadata?.ISBN || '').replace(/[^0-9X]/gi, '');

          let enrichedCoverUrl = null;

          // 1. Try OpenLibrary if ISBN is present
          if (cleanIsbn) {
            try {
              const olUrl = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(cleanIsbn)}-M.jpg?default=false`;
              const olCheck = await fetch(olUrl, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
              if (olCheck.ok && (olCheck.headers.get('content-type') || '').startsWith('image/')) {
                enrichedCoverUrl = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(cleanIsbn)}-L.jpg`;
              }
            } catch {}
          }

          // 2. Try ComicVine
          if (!enrichedCoverUrl && cvApiKey && sName) {
            try {
              const cvQuery = `${sName} ${issNum}`.trim();
              const cvUrl = `${COMICVINE_API_URL}/search/?api_key=${encodeURIComponent(cvApiKey)}&format=json&resources=issue&query=${encodeURIComponent(cvQuery)}&limit=5`;
              const cvData = await cvFetchJson(cvUrl);
              const matches = cvData?.results || [];
              const bestMatch = matches.find(m => {
                const volName = m.volume?.name || '';
                const mNum = m.issue_number != null ? String(m.issue_number).trim() : '';
                const volMatch = volName.toLowerCase() === sName.toLowerCase();
                const numMatch = !issNum || mNum === issNum;
                return volMatch && numMatch && (m.image?.medium_url || m.image?.super_url || m.image?.thumb_url);
              }) || matches.find(m => m.image?.medium_url || m.image?.super_url || m.image?.thumb_url);

              if (bestMatch?.image) {
                const cvImg = bestMatch.image;
                item.image = {
                  thumb_url: cvImg.thumb_url || cvImg.medium_url,
                  medium_url: cvImg.medium_url || cvImg.super_url || cvImg.thumb_url,
                  super_url: cvImg.super_url || cvImg.medium_url || cvImg.thumb_url,
                  original_url: cvImg.original_url || cvImg.super_url || cvImg.medium_url
                };
                enrichedCoverUrl = item.image.medium_url;
              }
            } catch {}
          }

          // 3. Try Metron via sidecar
          if (!enrichedCoverUrl && metronUser && metronPass && sName) {
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
                const mMatch = (mItems || []).find(m => {
                  const mCov = m.cover_image_url || m.cover_url;
                  return mCov && !mCov.includes('comics.org');
                });
                if (mMatch) {
                  const mCov = mMatch.cover_image_url || mMatch.cover_url;
                  enrichedCoverUrl = mCov;
                  item.image = {
                    thumb_url: mCov,
                    medium_url: mCov,
                    super_url: mCov,
                    original_url: mCov
                  };
                }
              }
            } catch {}
          }

          // 4. Try OpenLibrary Search by title
          if (!enrichedCoverUrl && sName) {
            try {
              const olSearchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(sName)}&limit=3`;
              const olRes = await fetch(olSearchUrl, { signal: AbortSignal.timeout(3000) });
              if (olRes.ok) {
                const olData = await olRes.json();
                const docWithCover = (olData?.docs || []).find(d => d.cover_i);
                if (docWithCover?.cover_i) {
                  const olCover = `https://covers.openlibrary.org/b/id/${docWithCover.cover_i}-M.jpg`;
                  item.image = {
                    thumb_url: olCover,
                    medium_url: `https://covers.openlibrary.org/b/id/${docWithCover.cover_i}-L.jpg`,
                    super_url: `https://covers.openlibrary.org/b/id/${docWithCover.cover_i}-L.jpg`,
                    original_url: `https://covers.openlibrary.org/b/id/${docWithCover.cover_i}-L.jpg`
                  };
                  enrichedCoverUrl = olCover;
                }
              }
            } catch {}
          }

          if (enrichedCoverUrl && !item.image?.thumb_url) {
            item.image = {
              thumb_url: enrichedCoverUrl,
              medium_url: enrichedCoverUrl,
              super_url: enrichedCoverUrl,
              original_url: enrichedCoverUrl
            };
          }
        }
      }

      // For any items still referencing comics.org covers, route through proxy with context
      for (const item of mappedResults) {
        if (item.image?.thumb_url && item.image.thumb_url.includes('comics.org')) {
          const proxied = `/api/v1/proxy/cover?url=${encodeURIComponent(item.image.thumb_url)}&series=${encodeURIComponent(item.volumeName || '')}&issue=${encodeURIComponent(item.issueNumber || '')}&query=${encodeURIComponent(query || '')}`;
          item.image = {
            thumb_url: proxied,
            medium_url: proxied,
            super_url: proxied,
            original_url: proxied
          };
        }
      }

      return res.json({ results: mappedResults, total: mappedResults.length });
    } catch (e) {
      return res.status(500).json({ message: formatErrorMessage(e, req, 'Failed to search external source') });
    }
  });

  async function resolveFallbackCoverImage(series, issueNumber, queryContext, reqTargetUrl = '') {
    const { getConfig } = require('../../config');
    const config = getConfig();
    const sidecarUrl = config.taggerServiceUrl || 'http://localhost:5000';
    const cvApiKey = (typeof getComicVineApiKey === 'function' ? getComicVineApiKey() : null) || config.comicVineApiKey || process.env.COMICVINE_API_KEY || '';
    const metronUser = config.metronUser || (typeof config.getMetronUser === 'function' ? config.getMetronUser() : '') || process.env.METRON_USER || '';
    const metronPass = config.metronPassword || config.metronPass || (typeof config.getMetronPassword === 'function' ? config.getMetronPassword() : '') || process.env.METRON_PASSWORD || process.env.METRON_PASS || '';

    let sName = (series || '').trim();
    let issNum = (issueNumber || '').trim();

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
    if (!sName && reqTargetUrl && reqTargetUrl.includes('comics.org')) {
      const gcdIssueMatch = reqTargetUrl.match(/(?:covers_by_id\/\d+\/(?:w\d+\/)?|issue\/)(\d+)/);
      if (gcdIssueMatch) {
        try {
          const gcdIssueRes = await fetch(`https://www.comics.org/api/issue/${gcdIssueMatch[1]}/`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'ComicsNow/1.0' },
            signal: AbortSignal.timeout(3000)
          });
          if (gcdIssueRes.ok) {
            const gcdIssueData = await gcdIssueRes.json();
            if (gcdIssueData.series_name) {
              sName = gcdIssueData.series_name;
              if (!issNum && gcdIssueData.number) issNum = String(gcdIssueData.number);
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

    // 1. Try ComicVine
    if (cvApiKey) {
      try {
        const cvQuery = `${sName} ${issNum}`.trim();
        const searchUrl = `${COMICVINE_API_URL}/search/?api_key=${encodeURIComponent(cvApiKey)}&format=json&resources=issue&query=${encodeURIComponent(cvQuery)}&limit=5`;
        const sdata = await cvFetchJson(searchUrl);
        const matches = sdata?.results || [];
        const best = matches.find(m => {
          const vName = m.volume?.name || '';
          const mNum = m.issue_number != null ? String(m.issue_number).trim() : '';
          const vMatch = vName.toLowerCase() === sName.toLowerCase();
          const nMatch = !issNum || mNum === issNum;
          return vMatch && nMatch && (m.image?.medium_url || m.image?.super_url || m.image?.thumb_url);
        }) || matches.find(m => m.image?.medium_url || m.image?.super_url || m.image?.thumb_url);

        const imgCandidate = best?.image?.medium_url || best?.image?.super_url || best?.image?.thumb_url;
        if (imgCandidate) {
          const resImg = await fetchCoverBuffer(imgCandidate);
          if (resImg) return resImg;
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

    // 2. Try Metron via sidecar
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
          for (const item of (mItems || [])) {
            const mCov = item.cover_image_url || item.cover_url;
            if (mCov && !mCov.includes('comics.org')) {
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

      // Attempt direct fetch first with Google Search result headers (Referer: https://www.google.com/)
      const googleSearchHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.google.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site'
      };

      let directFetchRes = null;
      try {
        directFetchRes = await fetch(targetUrl, {
          headers: googleSearchHeaders,
          signal: AbortSignal.timeout(4000)
        });
        if (directFetchRes && directFetchRes.ok) {
          const ct = directFetchRes.headers.get('content-type') || '';
          if (ct.startsWith('image/')) {
            const ab = await directFetchRes.arrayBuffer();
            const buf = Buffer.from(ab);
            if (buf.length > 100) {
              res.setHeader('Content-Type', ct);
              res.setHeader('Cache-Control', 'public, max-age=86400');
              return res.send(buf);
            }
          }
        }
      } catch (err) {
        // Direct fetch failed or timed out
      }

      // If direct fetch was blocked (e.g. Cloudflare 403) or failed, attempt dynamic fallback from ComicVine/Metron/OpenLibrary
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
};
