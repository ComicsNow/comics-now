/**
 * URL Metadata Extractor Service
 *
 * Uses Jina Reader (r.jina.ai) to extract clean Markdown from web pages (League of Comic Geeks,
 * DC/Marvel Fandom wikis, Grand Comics Database, store pages, etc.) and synthesizes canonical
 * ComicInfo metadata via Gemini 3.5 Flash-Lite.
 */

const dns = require('dns').promises;
const net = require('net');
const { isTitleSameAsSeries } = require('./metadata');

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function isPrivateOrReservedIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a >= 224) return true; // multicast & reserved
  return false;
}

function isPrivateOrReservedIP(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return true;
  const ip = rawIp.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const version = net.isIP(ip);
  if (version === 4) {
    return isPrivateOrReservedIPv4(ip);
  }
  if (version === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
    if (ip.startsWith('::ffff:')) {
      const mapped = ip.slice('::ffff:'.length);
      if (net.isIPv4(mapped)) {
        return isPrivateOrReservedIPv4(mapped);
      }
      const hexParts = mapped.split(':');
      if (hexParts.length === 2) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isPrivateOrReservedIPv4(v4);
        }
      }
      return true;
    }
    return false;
  }
  return false;
}

/**
 * Validates that candidate web URL does not target loopback, private LAN, or cloud metadata services.
 * Rejects SSRF vectors such as 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, non-HTTP schemes.
 */
function isSafeWebUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = (parsed.hostname || '').toLowerCase();
    if (!hostname) return false;
    const bareHost = hostname.replace(/^\[|\]$/g, '');
    if (
      bareHost === 'localhost' ||
      bareHost.endsWith('.localhost') ||
      bareHost.endsWith('.local') ||
      bareHost.endsWith('.internal')
    ) {
      return false;
    }
    if (net.isIP(bareHost) !== 0 && isPrivateOrReservedIP(bareHost)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function assertSafeResolvedHost(url) {
  if (!isSafeWebUrl(url)) {
    throw new Error(`Invalid or restricted URL target: ${url}`);
  }
  const parsed = new URL(url.trim());
  const bareHost = (parsed.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(bareHost) !== 0) {
    if (isPrivateOrReservedIP(bareHost)) {
      throw new Error(`Restricted private or loopback IP target: ${bareHost}`);
    }
    return;
  }
  const records = await dns.lookup(bareHost, { all: true });
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`Could not resolve host: ${bareHost}`);
  }
  for (const record of records) {
    if (isPrivateOrReservedIP(record.address)) {
      throw new Error(`Restricted private or loopback resolved IP (${record.address}) for ${bareHost}`);
    }
  }
}

/**
 * Fetches target comic URL as clean Markdown using Jina Reader (r.jina.ai).
 * Free, zero-API-key requirement with in-memory HTML fallback.
 */
async function fetchUrlAsMarkdown(url, options = {}) {
  if (!isSafeWebUrl(url)) {
    throw new Error(`Invalid or restricted URL target: ${url}`);
  }

  const timeoutMs = options.timeoutMs || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const jinaUrl = `https://r.jina.ai/${encodeURI(url)}`;

  try {
    const res = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/plain, text/markdown',
        'User-Agent': 'ComicsNow-MetadataExtractor/2.0'
      }
    });

    clearTimeout(timer);

    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 10) {
        return text;
      }
    }
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[UrlMetadataExtractor] Jina fetch failed for ${url}: ${err.message}. Attempting direct fallback...`);
  }

  // Fallback: Direct fetch with DNS rebinding check, disabled redirects, and HTML stripping
  await assertSafeResolvedHost(url);

  try {
    const fallbackRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'manual'
    });
    if (fallbackRes.status >= 300 && fallbackRes.status < 400) {
      throw new Error(`Redirect responses (${fallbackRes.status}) are not permitted during direct fallback`);
    }
    const html = await fallbackRes.text();
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (e) {
    throw new Error(`Failed to fetch comic page from ${url}: ${e.message}`);
  }
}

/**
 * Builds Gemini prompt for extracting ComicInfo metadata from scraped page content.
 */
function buildUrlMetadataPrompt({ url, markdownContent, filename, existingMeta = {}, publisherCodex = [] }) {
  const defaultCodex = [
    'DC Comics', 'Marvel', 'Image', 'Dark Horse Comics', 'Boom! Studios',
    'IDW Publishing', 'Dynamite Entertainment', 'Oni Press', 'Fantagraphics',
    'Europe Comics', 'Humanoids', 'Cinebook', 'Titan Books', 'Aftershock Comics'
  ];
  const effectiveCodex = Array.isArray(publisherCodex) && publisherCodex.length > 0
    ? publisherCodex
    : defaultCodex;

  return `
You are an expert comic book cataloger and archivist.
Extract canonical ComicInfo metadata for the comic described in the provided web page content.

--- CRITICAL SOURCE GROUNDING RULES ---
- ONLY extract information explicitly present in the SCRAPED SOURCE CONTENT, COMIC FILENAME, or EXISTING ARCHIVE METADATA.
- If a field is not stated in the source, leave it as an empty string ("") or null. NEVER hallucinate or invent facts.
- REDUNDANT TITLE RULE: If the Title is identical to the Series, Title MUST be left blank ("").
- PUBLISHER NORMALIZATION: If the publisher matches one of the canonical publishers in the PUBLISHER CODEX, use the exact name from the codex:
  [${effectiveCodex.join(', ')}]

--- COMIC FILE INFORMATION ---
Filename: ${filename || 'Unknown Comic.cbz'}
Existing Archive Metadata: ${JSON.stringify(existingMeta || {})}
Source Web URL: ${url}

--- SCRAPED SOURCE CONTENT ---
${(markdownContent || '').slice(0, 30000)}

--- OUTPUT JSON SCHEMA ---
Provide strictly valid JSON with these keys:
{
  "Series": "Main series name (e.g. 'Batman', 'Saga')",
  "Number": "Issue number as string (e.g. '1', '50', 'Annual 1')",
  "Title": "Specific story or chapter subtitle if present, otherwise empty string",
  "Volume": "Volume number as string if stated, or empty",
  "Publisher": "Publisher name normalized to codex",
  "Imprint": "Imprint if any (e.g. 'Vertigo', 'Black Label', 'Skybound')",
  "Writer": "Comma-separated list of writers",
  "Penciller": "Comma-separated list of pencillers / artists",
  "Inker": "Comma-separated list of inkers",
  "Colorist": "Comma-separated list of colorists",
  "Letterer": "Comma-separated list of letterers",
  "CoverArtist": "Comma-separated list of cover artists",
  "Editor": "Comma-separated list of editors",
  "Summary": "Plot synopsis or description",
  "Year": 2024,
  "Month": 6,
  "Day": 15,
  "CoverDate": "YYYY-MM-DD or publication date",
  "Characters": "Comma-separated list of featured characters",
  "Teams": "Comma-separated list of teams",
  "Locations": "Comma-separated list of locations",
  "StoryArc": "Story arc name if part of an arc",
  "StoryArcNumber": "Part number within arc (e.g. '1')",
  "PageCount": 32,
  "AgeRating": "Age rating if noted",
  "Genre": "Genre (e.g. 'Superhero', 'Sci-Fi')",
  "Web": "${url}"
}
`;
}

/**
 * Extracts ComicInfo metadata from a URL using Jina Reader and Gemini.
 */
async function extractMetadataFromUrl({
  url,
  filename,
  existingMeta = {},
  publisherCodex = [],
  apiKey,
  model = DEFAULT_MODEL,
  thinkingLevel = 'high'
}) {
  if (!url) {
    throw new Error('URL is required for metadata extraction.');
  }
  if (!apiKey) {
    throw new Error('Gemini API key is required for metadata extraction.');
  }

  // 1. Fetch clean markdown via Jina Reader
  const markdown = await fetchUrlAsMarkdown(url);

  // 2. Build prompt
  const prompt = buildUrlMetadataPrompt({
    url,
    markdownContent: markdown,
    filename,
    existingMeta,
    publisherCodex
  });

  // 3. Call Gemini API
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingLevel: thinkingLevel || 'high'
        },
        temperature: 0.1
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Empty response received from Gemini.');
  }

  const parsed = JSON.parse(rawText);

  // 4. Clean & Normalize
  const CANONICAL_KEYS = [
    'Title', 'Series', 'Number', 'Volume', 'Publisher', 'Imprint',
    'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer', 'CoverArtist', 'Editor',
    'Summary', 'Year', 'Month', 'Day', 'CoverDate', 'Genre', 'Web',
    'Characters', 'Teams', 'Locations', 'StoryArc', 'StoryArcNumber',
    'PageCount', 'AgeRating'
  ];

  const result = {};
  for (const k of CANONICAL_KEYS) {
    if (parsed[k] !== undefined && parsed[k] !== null) {
      result[k] = parsed[k];
    } else {
      result[k] = '';
    }
  }

  // Always retain Web source
  result.Web = parsed.Web || url;

  // Redundant Title Rule: if Title is identical to Series, Title is blank
  if (result.Title && result.Series && isTitleSameAsSeries(result.Title, result.Series)) {
    result.Title = '';
  }

  // Publisher normalization to codex
  if (result.Publisher && Array.isArray(publisherCodex) && publisherCodex.length > 0) {
    const pubLower = result.Publisher.trim().toLowerCase();
    const matched = publisherCodex.find(p => p.toLowerCase() === pubLower);
    if (matched) {
      result.Publisher = matched;
    }
  }

  return result;
}

module.exports = {
  fetchUrlAsMarkdown,
  buildUrlMetadataPrompt,
  extractMetadataFromUrl,
  isSafeWebUrl
};
