/**
 * Gemini Metadata Synthesizer & Normalizer
 *
 * Takes raw scraped comic candidates across external providers (ComicVine, Metron, GCD, LCG, etc.)
 * plus the comic filename, existing metadata, and the user's library publisher codex, and utilizes
 * Gemini 3.5 Flash-Lite with structured JSON output to synthesize clean, canonical ComicInfo metadata.
 *
 * Strict Rules Enforced:
 * 1. Source Grounding: ONLY use facts explicitly in the provided candidates, archive metadata, or filename. NEVER use external pretraining knowledge or hallucinate storyline details.
 * 2. Series vs. Volume vs. Title:
 *    - Separates volume markers and arc subtitles (e.g. "Batman: Vol 1, The Shining" -> Series: "Batman", Title: "Vol. 1: The Shining", Volume: "1", Number: "1").
 *    - Strips format and edition tags (e.g. TPB, HC, Paperback, digital, Marika-Empire).
 *    - Redundant title rule: If Title is identical to Series, Title is left blank.
 * 3. Publisher Normalization:
 *    - Must match the user's library publisher list (e.g. "Image", NOT "Image Comics"; "Marvel", NOT "Marvel Comics"; "DC Comics", etc.).
 * 4. Creators & Roles:
 *    - Writers, Pencillers, Inkers, Colorists, Letterers, CoverArtists, Editors.
 *    - Preserves existing archive creators if candidate has missing credits.
 * 5. Complete Dual-Cased Output Schema:
 *    - Provides both PascalCase (for ComicInfo.xml and Node metadata) and lowercase (for Python sidecar and tagger.js) keys so no fields are ever dropped.
 */

const STRICT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Builds the prompt and structured output schema for Gemini metadata synthesis.
 */
function buildMetadataPrompt({
  winningCandidate,
  allCandidates = [],
  filename,
  existingMeta = {},
  publisherCodex = []
}) {
  const winner = winningCandidate || allCandidates[0] || {};
  const winnerMeta = winner.metadata || {};

  // Default fallback library publishers if codex is empty
  const defaultCodex = [
    'Image', 'Marvel', 'DC Comics', 'Dark Horse Comics', 'Boom! Studios',
    'IDW Publishing', 'Dynamite Entertainment', 'Oni Press', 'Fantagraphics',
    'Rebellion', 'Europe Comics', 'Humanoids', 'Titan Books', 'Titan Comics',
    'Vault Comics', 'Mad Cave Studios', 'Ahoy Comics', 'Ablaze', 'Aftershock Comics'
  ];
  const effectiveCodex = Array.isArray(publisherCodex) && publisherCodex.length > 0
    ? publisherCodex
    : defaultCodex;

  const promptText = `
You are an expert comic book cataloger and archivist. Your task is to synthesize canonical ComicInfo metadata for a comic book from the scraped candidates, existing archive metadata, and filename provided.

--- CRITICAL SOURCE GROUNDING CONSTRAINT ---
- NEVER use external pretraining knowledge or assumptions about the comic, storyline, characters, or creative team.
- ONLY synthesize information that is explicitly present in the provided WINNING CANDIDATE METADATA, OTHER CANDIDATE MATCHES, EXISTING METADATA IN ARCHIVE, or COMIC FILE INFORMATION (filename).
- If a field (such as Writer, Penciller, Summary, Cover Date, or Issue Number) is not present in any of the sources, leave it as an EMPTY string (""). Never invent, deduce, or hallucinate facts.

--- COMIC FILE INFORMATION ---
Filename: ${filename || 'Unknown'}
Existing Metadata in Archive: ${JSON.stringify(existingMeta || {})}

--- WINNING CANDIDATE METADATA ---
Title: ${winnerMeta.title || winner.title || ''}
Series: ${winnerMeta.series || winner.series || ''}
Issue/Number: ${winnerMeta.issue || winnerMeta.number || winner.issue || ''}
Volume: ${winnerMeta.volume || winner.volume || ''}
Publisher: ${winnerMeta.publisher || winner.publisher || ''}
Imprint: ${winnerMeta.imprint || ''}
Release/Cover Date: ${winnerMeta.cover_date || winnerMeta.publish_date || winnerMeta.year || ''}
Summary/Description: ${winnerMeta.description || winnerMeta.summary || ''}
Creators: ${JSON.stringify(winnerMeta.creators || winnerMeta.credits || {})}
Writer: ${winnerMeta.writer || ''}
Penciller: ${winnerMeta.penciller || ''}
Inker: ${winnerMeta.inker || ''}
Colorist: ${winnerMeta.colorist || ''}
Letterer: ${winnerMeta.letterer || ''}
Cover Artist: ${winnerMeta.cover_artist || ''}
Editor: ${winnerMeta.editor || ''}
Source URL: ${winner.matching_url || winner.source_url || winner.source || ''}

--- OTHER CANDIDATE MATCHES (For Cross-Referencing & Enrichment) ---
${JSON.stringify((allCandidates || []).slice(0, 4).map(c => ({
  source: c.source,
  series: c.metadata?.series || c.series,
  title: c.metadata?.title || c.title,
  issue: c.metadata?.issue || c.metadata?.number,
  publisher: c.metadata?.publisher,
  date: c.metadata?.cover_date || c.metadata?.publish_date || c.metadata?.year,
  creators: c.metadata?.creators || c.metadata?.credits || c.metadata?.writer,
  summarySnippet: (c.metadata?.description || c.metadata?.summary || '').slice(0, 200)
})), null, 2)}

--- NORMALIZATION RULES ---

1. SERIES vs. VOLUME vs. TITLE:
   - "Series": The clean comic book series title without volume numbers, arc subtitles, year tags, or format labels (e.g. "Batman", NOT "Batman: Vol 1, The Shining"; "Fantastic Four Epic Collection", NOT "Fantastic Four Epic Collection v26 (2026) - Heroes Reborn").
   - Volume and Arc Subtitle Splitting:
     If a candidate or filename contains a volume indicator with an arc title or subtitle — such as "Batman: Vol 1, The Shining", "Batman Vol. 1 - The Shining", "Batman: Volume 1: The Shining", or "Batman v1: The Shining":
     * "Series": Extract ONLY the base series name ("Batman").
     * "Title": Extract the volume token and subtitle formatted cleanly as "Vol. <num>: <subtitle>" (e.g. "Vol. 1: The Shining"). If the token is Volume, use "Volume <num>: <subtitle>".
     * "Volume": The volume number as a string (e.g. "1").
     * "Number": The volume or issue number (e.g. "1").
   - Format and Edition Tag Stripping:
     Strip all format and edition tags from "Series" and "Title" (e.g. bracketed or delimited tokens like "(TPB)", "[HC]", "(Paperback)", "(digital)", "[digital-Empire]", "(Marika-Empire)", "Trade Paperback", "Hardcover", "Graphic Novel", "Digital Edition").
   - Redundant Title Rule:
     If "Title" is identical to "Series" (or is merely the series name plus an issue number, volume suffix, or format tag), "Title" MUST be an EMPTY string (""). Never duplicate the series name in Title.

2. PUBLISHER NORMALIZATION:
   - "Publisher": MUST match the exact canonical naming used in the user's library publisher list below (e.g. use "Image", NOT "Image Comics"; use "Marvel", NOT "Marvel Comics"; "DC Comics", "Dark Horse Comics", "Boom! Studios", "IDW Publishing", etc.).
     USER LIBRARY PUBLISHER LIST:
     ${JSON.stringify(effectiveCodex)}
     If the candidate publisher matches an entry in the list (case-insensitively or after stripping common suffixes like "Comics", "Publishing", "Inc.", "Ltd."), you MUST use the exact string from the user library list.
   - "Imprint": Specific publisher imprint if applicable (e.g. "Vertigo", "Black Label", "Marvel Knights", "MAX", "Wildstorm", "Milestone", "2000 AD").

3. CREATORS & ROLE ASSIGNMENT:
   - Separate multiple creators with commas (e.g. "Jim Lee, Brandon Choi").
   - Strictly sort creators into their specific role fields:
     - Writer
     - Penciller
     - Inker
     - Colorist
     - Letterer
     - CoverArtist
     - Editor
   - Strip role annotations from names (e.g., convert "Jim Lee (Penciller)" to "Jim Lee").
   - Deduplicate names within each field.
   - Check "Existing Metadata in Archive": if the archive already has creators (Writer, Penciller, etc.), PRESERVE and merge them if the winning candidate lacks credits.

4. NARRATIVE SYNOPSIS (SUMMARY):
   - Provide a clean narrative synopsis strictly from the candidate summaries or existing archive description.
   - Strip all marketing boilerplate, solicitation text (e.g. "On sale this Wednesday!", "Rated T+", "Don't miss this thrilling new issue!"), store diamond order codes, page counts, and price tags.
   - Strip all HTML formatting tags, entities, and markdown links.
   - If no summary is found in any candidate or archive, leave as empty string ("").

5. DATES & YEAR:
   - Year: Integer publication year (e.g. 2026, 1996) from candidates, archive metadata, or filename year tags like "(2026)".
   - Month: Integer month (1-12) if known, or null.
   - Day: Integer day (1-31) if known, or null.
   - CoverDate: Standard YYYY-MM string if available from sources.

Return a JSON object adhering exactly to the requested schema.
`;

  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          Series: { type: 'STRING', description: 'Clean series title without volume or year tags' },
          Volume: { type: 'STRING', description: 'Volume number or release year run indicator' },
          Number: { type: 'STRING', description: 'Issue or volume number' },
          Title: { type: 'STRING', description: 'Individual story title or blank if identical to Series' },
          Publisher: { type: 'STRING', description: 'Canonical publisher name from user library list' },
          Imprint: { type: 'STRING', description: 'Publisher imprint if applicable' },
          Writer: { type: 'STRING', description: 'Comma-separated writers' },
          Penciller: { type: 'STRING', description: 'Comma-separated pencillers' },
          Inker: { type: 'STRING', description: 'Comma-separated inkers' },
          Colorist: { type: 'STRING', description: 'Comma-separated colorists' },
          Letterer: { type: 'STRING', description: 'Comma-separated letterers' },
          CoverArtist: { type: 'STRING', description: 'Comma-separated cover artists' },
          Editor: { type: 'STRING', description: 'Comma-separated editors' },
          Summary: { type: 'STRING', description: 'Clean narrative synopsis' },
          Year: { type: 'INTEGER', description: 'Publication year' },
          Month: { type: 'INTEGER', description: 'Publication month (1-12)' },
          Day: { type: 'INTEGER', description: 'Publication day (1-31)' },
          CoverDate: { type: 'STRING', description: 'Cover date string YYYY-MM' },
          Genre: { type: 'STRING', description: 'Comma-separated genres' },
          Web: { type: 'STRING', description: 'Primary source reference URL' }
        },
        required: ['Series', 'Publisher']
      }
    }
  };
}

/**
 * Calls Gemini 3.5 Flash-Lite to synthesize and normalize comic metadata.
 *
 * @param {Object} options
 * @param {Object} options.winningCandidate - The selected match candidate
 * @param {Array<Object>} [options.allCandidates] - All candidates scraped from external sources
 * @param {string} options.filename - The comic file name
 * @param {Object} [options.existingMeta] - Any metadata already in the archive
 * @param {Array<string>} [options.publisherCodex] - User's library publisher names
 * @param {string} options.apiKey - Gemini API key
 * @returns {Promise<Object>} Normalized metadata dictionary with both PascalCase and lowercase keys
 */
async function synthesizeMetadataWithGemini({
  winningCandidate,
  allCandidates = [],
  filename,
  existingMeta = {},
  publisherCodex = [],
  apiKey
}) {
  if (!apiKey) {
    throw new Error('No Gemini API key provided for metadata synthesis');
  }

  const payload = buildMetadataPrompt({
    winningCandidate,
    allCandidates,
    filename,
    existingMeta,
    publisherCodex
  });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(STRICT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini metadata synthesis error (HTTP ${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Empty response from Gemini metadata synthesis');
  }

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned);

  // Preserve existing notes if present
  if (existingMeta?.Notes || existingMeta?.notes) {
    parsed.Notes = existingMeta.Notes || existingMeta.notes;
  }

  // Preserve cover image URL from winning candidate
  const winMeta = winningCandidate?.metadata || winningCandidate || {};
  parsed.cover_image_url = winMeta.cover_image_url || winMeta.cover_url || winningCandidate?.coverUrl || null;
  parsed.source_url = parsed.Web || winMeta.source_url || winningCandidate?.matching_url || '';

  // Local programmatic rule enforcement layer (guarantees consistency with library rules)
  let cleanSeries = parsed.Series || '';
  let cleanTitle = parsed.Title || '';
  let cleanNumber = parsed.Number != null ? String(parsed.Number).trim() : '';
  let cleanVolume = parsed.Volume != null ? String(parsed.Volume).trim() : '';

  try {
    const {
      cleanFormatAndEdition,
      splitVolumeSeriesAndTitle,
      normalizePublisher,
      isTitleSameAsSeries,
      cleanDescription,
      resolveCreatorRoles
    } = require('../services/metadata');

    cleanSeries = cleanFormatAndEdition(cleanSeries);
    cleanTitle = cleanFormatAndEdition(cleanTitle);

    // Apply volume/subtitle splitting rules (e.g. "Batman: Vol 1, The Shining")
    const volSplit = splitVolumeSeriesAndTitle(cleanSeries, cleanTitle);
    if (volSplit.series && volSplit.number) {
      cleanSeries = volSplit.series;
      cleanTitle = volSplit.title;
      if (!cleanNumber || cleanNumber === '1' || cleanNumber === '01') {
        cleanNumber = volSplit.number;
      }
      if (!cleanVolume) {
        cleanVolume = volSplit.volume;
      }
    }

    if (cleanTitle && (isTitleSameAsSeries(cleanTitle, cleanSeries) || (!cleanSeries && isTitleSameAsSeries(cleanTitle, '')))) {
      cleanTitle = '';
    }

    parsed.Publisher = normalizePublisher(parsed.Publisher, publisherCodex);
    parsed.Summary = cleanDescription(parsed.Summary || '');

    // Disambiguate creator roles
    const creatorsObj = {
      Writer: parsed.Writer || existingMeta?.Writer || existingMeta?.writer || '',
      Penciller: parsed.Penciller || existingMeta?.Penciller || existingMeta?.penciller || '',
      Inker: parsed.Inker || existingMeta?.Inker || existingMeta?.inker || '',
      Colorist: parsed.Colorist || existingMeta?.Colorist || existingMeta?.colorist || '',
      Letterer: parsed.Letterer || existingMeta?.Letterer || existingMeta?.letterer || '',
      CoverArtist: parsed.CoverArtist || existingMeta?.CoverArtist || existingMeta?.cover_artist || '',
      Editor: parsed.Editor || existingMeta?.Editor || existingMeta?.editor || '',
      Summary: parsed.Summary
    };
    resolveCreatorRoles(creatorsObj);
    parsed.Writer = parsed.Writer || existingMeta?.Writer || existingMeta?.writer || creatorsObj.Writer || '';
    parsed.Penciller = parsed.Penciller || existingMeta?.Penciller || existingMeta?.penciller || creatorsObj.Penciller || '';
    parsed.Inker = parsed.Inker || existingMeta?.Inker || existingMeta?.inker || creatorsObj.Inker || '';
    parsed.Colorist = parsed.Colorist || existingMeta?.Colorist || existingMeta?.colorist || creatorsObj.Colorist || '';
    parsed.Letterer = parsed.Letterer || existingMeta?.Letterer || existingMeta?.letterer || creatorsObj.Letterer || '';
    parsed.CoverArtist = parsed.CoverArtist || existingMeta?.CoverArtist || existingMeta?.cover_artist || creatorsObj.CoverArtist || '';
    parsed.Editor = parsed.Editor || existingMeta?.Editor || existingMeta?.editor || creatorsObj.Editor || '';
  } catch (_) {}

  parsed.Series = cleanSeries;
  parsed.Title = cleanTitle;
  parsed.Number = cleanNumber;
  parsed.Volume = cleanVolume;

  const yearStr = parsed.Year != null ? String(parsed.Year) : (existingMeta?.Year || existingMeta?.year || '');
  const monthStr = parsed.Month != null ? String(parsed.Month) : (existingMeta?.Month || existingMeta?.month || '');
  const dayStr = parsed.Day != null ? String(parsed.Day) : (existingMeta?.Day || existingMeta?.day || '');
  const coverDateStr = parsed.CoverDate || (yearStr ? `${yearStr}${monthStr ? '-' + monthStr.padStart(2, '0') : ''}` : '');

  // Construct dual-cased dictionary: both PascalCase (for ComicInfo.xml) and lowercase (for Python sidecar / tagger.js)
  const normalized = {
    // PascalCase
    Title: parsed.Title || '',
    Series: parsed.Series || '',
    Number: parsed.Number || '',
    Volume: parsed.Volume || '',
    Publisher: parsed.Publisher || '',
    Imprint: parsed.Imprint || '',
    Writer: parsed.Writer || '',
    Penciller: parsed.Penciller || '',
    Inker: parsed.Inker || '',
    Colorist: parsed.Colorist || '',
    Letterer: parsed.Letterer || '',
    CoverArtist: parsed.CoverArtist || '',
    Editor: parsed.Editor || '',
    Summary: parsed.Summary || '',
    Year: yearStr,
    Month: monthStr,
    Day: dayStr,
    CoverDate: coverDateStr,
    Genre: parsed.Genre || '',
    Web: parsed.Web || parsed.source_url || '',
    Notes: parsed.Notes || existingMeta?.Notes || existingMeta?.notes || '',

    // Lowercase / standard keys
    title: parsed.Title || '',
    series: parsed.Series || '',
    number: parsed.Number || '',
    issue: parsed.Number || '',
    issue_number: parsed.Number || '',
    issue_title: parsed.Title || '',
    volume: parsed.Volume || '',
    publisher: parsed.Publisher || '',
    imprint: parsed.Imprint || '',
    description: parsed.Summary || '',
    summary: parsed.Summary || '',
    year: yearStr,
    month: monthStr,
    day: dayStr,
    cover_date: coverDateStr,
    publish_date: coverDateStr,
    writer: parsed.Writer || '',
    penciller: parsed.Penciller || '',
    inker: parsed.Inker || '',
    colorist: parsed.Colorist || '',
    letterer: parsed.Letterer || '',
    cover_artist: parsed.CoverArtist || '',
    editor: parsed.Editor || '',
    genre: parsed.Genre || '',
    genres: parsed.Genre ? parsed.Genre.split(',').map(s => s.trim()).filter(Boolean) : [],
    cover_image_url: parsed.cover_image_url || null,
    source_url: parsed.source_url || parsed.Web || '',
    notes: parsed.Notes || existingMeta?.Notes || existingMeta?.notes || ''
  };

  return normalized;
}

module.exports = {
  STRICT_MODEL,
  buildMetadataPrompt,
  synthesizeMetadataWithGemini
};
