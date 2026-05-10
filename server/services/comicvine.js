const { COMICVINE_API_URL } = require('../constants');
const { getConfig } = require('../config');
const { stripHtml, deepFreeze } = require('../utils');

const comicVineCache = new Map();

async function cvFetchJson(url, options = {}) {
  if (comicVineCache.has(url)) {
    const cached = comicVineCache.get(url);
    comicVineCache.delete(url);
    comicVineCache.set(url, cached);
    return deepFreeze(cached);
  }

  const res = await fetch(url, {
    ...options,
    headers: { 'User-Agent': 'Comics Now', ...(options.headers || {}) }
  });

  if (!res.ok) {
    const err = new Error(`ComicVine request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const frozen = deepFreeze(data);
  comicVineCache.set(url, frozen);
  if (comicVineCache.size > 10) {
    const firstKey = comicVineCache.keys().next().value;
    comicVineCache.delete(firstKey);
  }

  return frozen;
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
  const apiKey = config.comicvine_api_key;
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
  const apiKey = config.comicvine_api_key;
  if (!apiKey) throw new Error('ComicVine API key not configured');

  const idNum = normalizeCvId(cvIssueId);
  const url = `${COMICVINE_API_URL}/issue/4000-${idNum}/?api_key=${encodeURIComponent(apiKey)}&format=json&field_list=name,issue_number,description,person_credits,character_credits,team_credits,location_credits,publisher,volume,cover_date,store_date`;
  
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

  let writer = '', penciller = '';
  if (Array.isArray(issue.person_credits)) {
    const roles = issue.person_credits.map(p => ({ name: p.name, role: (p.role || '').toLowerCase() }));
    writer = roles.filter(r => r.role.includes('writer')).map(r => r.name).join(', ');
    penciller = roles.filter(r => r.role.includes('penciller') || r.role.includes('artist')).map(r => r.name).join(', ');
  }

  const characters = (issue.character_credits || []).map(c => c.name).join(', ');
  const teams = (issue.team_credits || []).map(t => t.name).join(', ');
  const locations = (issue.location_credits || []).map(l => l.name).join(', ');

  return {
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
    'Cover Date': issue.cover_date || '',
    'Store Date': issue.store_date || ''
  };
}

module.exports = {
  COMICVINE_API_URL,
  cvFetchJson,
  normalizeCvId,
  searchIssue,
  getIssueDetails
};
