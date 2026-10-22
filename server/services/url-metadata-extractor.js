/**
 * URL Metadata Extractor Service
 *
 * Uses Jina Reader (r.jina.ai) to extract clean Markdown from web pages (League of Comic Geeks,
 * DC/Marvel Fandom wikis, Grand Comics Database, store pages, etc.) and synthesizes canonical
 * ComicInfo metadata via Gemini 3.5 Flash-Lite.
 */

const { isTitleSameAsSeries } = require('./metadata');

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Fetches target comic URL as clean Markdown using Jina Reader (r.jina.ai).
 * Free, zero-API-key requirement with in-memory HTML fallback.
 */
async function fetchUrlAsMarkdown(url, options = {}) {
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

  // Fallback: Direct fetch with basic HTML stripping
  try {
    const fallbackRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
  model = DEFAULT_MODEL
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
  extractMetadataFromUrl
};
