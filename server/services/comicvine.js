const { COMICVINE_API_URL } = require('../constants');
const { getConfig } = require('../config');
const { stripHtml, deepFreeze } = require('../utils');

const comicVineCache = new Map();
let rateLimitQueue = Promise.resolve();

// Single fetch with a hard timeout so a stalled connection can never hang forever.
async function cvFetchOnce(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': 'Comics Now', ...(options.headers || {}) }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function cvFetchJson(url, options = {}) {
  if (comicVineCache.has(url)) {
    const cached = comicVineCache.get(url);
    comicVineCache.delete(url);
    comicVineCache.set(url, cached);
    return deepFreeze(cached);
  }

  const run = async () => {
    let res = await cvFetchOnce(url, options);

    if (res.status === 420 || res.status === 429) {
      // Rate limited — back off 60s then retry once
      await new Promise(r => setTimeout(r, 60000));
      res = await cvFetchOnce(url, options);
    }

    if (!res.ok) {
      const err = new Error(`ComicVine request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return deepFreeze(data);
  };

  // Append to the serial queue. The task's own result is what the caller awaits,
  // but the queue continuation ALWAYS resolves (ignoring success/failure) + adds
  // 500ms spacing — so a failed request can never leave the chain in a rejected
  // state, which would otherwise deadlock every subsequent caller.
  const resultPromise = rateLimitQueue.then(run, run);
  rateLimitQueue = resultPromise.then(
    () => new Promise(r => setTimeout(r, 500)),
    () => new Promise(r => setTimeout(r, 500))
  );

  const result = await resultPromise;

  comicVineCache.set(url, result);
  if (comicVineCache.size > 500) {
    const firstKey = comicVineCache.keys().next().value;
    comicVineCache.delete(firstKey);
  }

  return result;
}

function normalizeCvId(raw) {
  const m = String(raw).match(/^(?:\d{4}-)?(\d+)$/);
  return m ? m[1] : String(raw);
}

/**
 * Search for an issue on ComicVine
 */
async function searchIssue(title, year, issueNumber) {
  const config = getConfig();
  const apiKey = config.comicVineApiKey;
  if (!apiKey) throw new Error('ComicVine API key not configured');

  const query = `${title} (${year}) #${issueNumber}`;
  const url = `${COMICVINE_API_URL}/search/?api_key=${encodeURIComponent(apiKey)}&format=json&resources=issue&query=${encodeURIComponent(query)}&limit=20`;
  
  const data = await cvFetchJson(url);
  return data.results || [];
}

/**
 * Get full details for a specific issue
 */
async function getIssueDetails(cvIssueId) {
  const config = getConfig();
  const apiKey = config.comicVineApiKey;
  if (!apiKey) throw new Error('ComicVine API key not configured');

  const idNum = normalizeCvId(cvIssueId);
  const url = `${COMICVINE_API_URL}/issue/4000-${idNum}/?api_key=${encodeURIComponent(apiKey)}&format=json&field_list=name,issue_number,description,person_credits,character_credits,team_credits,location_credits,publisher,volume,cover_date,store_date,story_arc_credits,site_detail_url,page_count`;
  
  const data = await cvFetchJson(url);
  const issue = data.results;

  if (!issue) return null;

  // Normalize to our metadata format
  let publisher = issue.publisher?.name || issue.volume?.publisher?.name || '';
  
  // If publisher still missing, we might need to fetch volume (omitted for brevity here as per user-metadata.js fallback)

  const title = issue.name || issue.volume?.name || 'Unknown';
  const series = issue.volume?.name || '';
  const number = issue.issue_number || '';
  const summary = stripHtml(issue.description || '');

  let writer = '', penciller = '', inker = '', colorist = '', letterer = '', coverArtist = '', editor = '';
  if (Array.isArray(issue.person_credits)) {
    const roles = issue.person_credits.map(p => ({ name: p.name, role: (p.role || '').toLowerCase() }));
    writer = roles.filter(r => r.role.includes('writer')).map(r => r.name).join(', ');
    penciller = roles.filter(r => r.role.includes('penciller') || r.role.includes('artist')).map(r => r.name).join(', ');
    inker = roles.filter(r => r.role.includes('inker')).map(r => r.name).join(', ');
    colorist = roles.filter(r => r.role.includes('colorist')).map(r => r.name).join(', ');
    letterer = roles.filter(r => r.role.includes('letterer')).map(r => r.name).join(', ');
    coverArtist = roles.filter(r => r.role.includes('cover')).map(r => r.name).join(', ');
    editor = roles.filter(r => r.role.includes('editor')).map(r => r.name).join(', ');
  }

  const characters = (issue.character_credits || []).map(c => c.name).join(', ');
  const teams = (issue.team_credits || []).map(t => t.name).join(', ');
  const locations = (issue.location_credits || []).map(l => l.name).join(', ');
  const storyArcs = (issue.story_arc_credits || []).map(a => a.name).join(', ');
  const storyArcList = (issue.story_arc_credits || []).map(a => ({ id: a.id, name: a.name }));

  return {
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
    StoryArc: storyArcs,
    StoryArcs: storyArcList,
    Web: issue.site_detail_url || `https://comicvine.gamespot.com/issue/4000-${idNum}/`,
    PageCount: issue.page_count != null ? String(issue.page_count) : '',
    'Cover Date': issue.cover_date || '',
    'Store Date': issue.store_date || ''
  };
}

/**
 * Get full story arc / crossover event details including issues in reading order
 */
async function getStoryArcDetails(arcId) {
  const config = getConfig();
  const apiKey = config.comicVineApiKey;
  if (!apiKey) throw new Error('ComicVine API key not configured');

  const idNum = normalizeCvId(arcId);
  const url = `${COMICVINE_API_URL}/story_arc/4045-${idNum}/?api_key=${encodeURIComponent(apiKey)}&format=json&field_list=id,name,deck,description,publisher,issues,image`;
  
  const data = await cvFetchJson(url);
  return data.results || null;
}

/**
 * Resolve the reading-order position of a specific issue within a story arc.
 * Fetches the arc's issue list, sorts by cover_date (true reading order), and
 * returns { arcName, position (1-based), total } — or null if the issue isn't in the arc.
 */
async function getStoryArcPosition(arcId, issueId) {
  const arc = await getStoryArcDetails(arcId);
  if (!arc || !Array.isArray(arc.issues) || arc.issues.length === 0) return null;

  const sorted = [...arc.issues].sort((a, b) => {
    const da = a.cover_date || a.store_date || '';
    const db = b.cover_date || b.store_date || '';
    if (da && db && da !== db) return da < db ? -1 : 1;
    return 0;
  });

  const targetId = normalizeCvId(issueId);
  const idx = sorted.findIndex(iss => normalizeCvId(iss.id) === targetId);
  if (idx === -1) return null;

  return { arcName: arc.name || '', position: idx + 1, total: sorted.length };
}

/**
 * Search for story arcs / events on ComicVine
 */
async function searchStoryArcs(query) {
  const config = getConfig();
  const apiKey = config.comicVineApiKey;
  if (!apiKey) throw new Error('ComicVine API key not configured');

  const url = `${COMICVINE_API_URL}/search/?api_key=${encodeURIComponent(apiKey)}&format=json&resources=story_arc&query=${encodeURIComponent(query)}&limit=15`;
  const data = await cvFetchJson(url);
  return data.results || [];
}

module.exports = {
  COMICVINE_API_URL,
  cvFetchJson,
  normalizeCvId,
  searchIssue,
  getIssueDetails,
  getStoryArcDetails,
  getStoryArcPosition,
  searchStoryArcs
};
