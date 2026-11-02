/**
 * User Metadata Cover Proxy Route
 *
 * Handles GET /api/v1/proxy/cover with fallback cover resolution.
 */
const cryptoVault = require('../../../utils/crypto-vault');
const { getConfig, getMetronPassword } = require('../../../config');

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

function attachCoverProxyRoutes(router, deps) {
  const {
    getComicVineApiKey,
    cvFetchJson,
    COMICVINE_API_URL
  } = deps;

  async function resolveFallbackCoverImage(series, issueNumber, queryContext, reqTargetUrl = '', description = '') {
    const config = getConfig();
    const sidecarUrl = config.taggerServiceUrl || 'http://localhost:5000';
    const rawCvApiKey = (typeof getComicVineApiKey === 'function' ? getComicVineApiKey() : null) || config.comicVineApiKey || process.env.COMICVINE_API_KEY || '';
    const cvApiKey = (cryptoVault.decrypt(rawCvApiKey) || rawCvApiKey || '').trim();
    const metronUser = config.metronUser || (typeof config.getMetronUser === 'function' ? config.getMetronUser() : '') || process.env.METRON_USER || '';
    const rawMetronPass = (typeof getMetronPassword === 'function' ? getMetronPassword() : null) || config.metronPassword || config.metronPass || process.env.METRON_PASSWORD || process.env.METRON_PASS || '';
    const metronPass = (cryptoVault.decrypt(rawMetronPass) || rawMetronPass || '').trim();

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
}

module.exports = {
  attachCoverProxyRoutes,
  computeTextSimilarity
};
