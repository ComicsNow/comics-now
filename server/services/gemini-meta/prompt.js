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
Characters: ${winnerMeta.characters || winnerMeta.Characters || ''}
Teams: ${winnerMeta.teams || winnerMeta.Teams || ''}
Locations: ${winnerMeta.locations || winnerMeta.Locations || ''}
Story Arc: ${winnerMeta.story_arc || winnerMeta.StoryArc || ''}
Story Arc Number: ${winnerMeta.story_arc_number || winnerMeta.StoryArcNumber || ''}
Page Count: ${winnerMeta.pages || winnerMeta.page_count || winnerMeta.PageCount || ''}
Age Rating: ${winnerMeta.age_rating || winnerMeta.AgeRating || ''}

--- OTHER CANDIDATE MATCHES (For Cross-Referencing & Enrichment) ---
${JSON.stringify((allCandidates || []).slice(0, 4).map(c => ({
  source: c.source,
  series: c.metadata?.series || c.series,
  title: c.metadata?.title || c.title,
  issue: c.metadata?.issue || c.metadata?.number,
  publisher: c.metadata?.publisher,
  date: c.metadata?.cover_date || c.metadata?.publish_date || c.metadata?.year,
  creators: c.metadata?.creators || c.metadata?.credits || c.metadata?.writer,
  characters: c.metadata?.characters,
  teams: c.metadata?.teams,
  locations: c.metadata?.locations,
  storyArc: c.metadata?.story_arc || c.metadata?.StoryArc,
  storyArcNumber: c.metadata?.story_arc_number || c.metadata?.StoryArcNumber,
  ageRating: c.metadata?.age_rating || c.metadata?.AgeRating,
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

6. CONTENT FIELDS (Characters, Teams, Locations, StoryArc, StoryArcNumber, PageCount, AgeRating):
   - AMALGAMATE across ALL sources: if the winning candidate lacks one of these
     fields but any OTHER candidate above provides it, use that value. Different
     sources are strong at different fields (e.g. Metron/ComicVine carry story
     arcs & characters; GCD rarely does).
   - For StoryArc/StoryArcNumber specifically: these come from METRON ONLY. Use
     StoryArc/StoryArcNumber ONLY from a candidate whose source is "metron" (or
     "src-metron"). IGNORE any arc data from ComicVine, GCD, or any other source —
     if Metron provides no arc, leave StoryArc and StoryArcNumber EMPTY.
   - For all OTHER content fields (Characters, Teams, Locations, Genre, AgeRating,
     PageCount): amalgamate from whichever source has them.
   - ONLY populate from data explicitly present in the candidates above. NEVER
     invent, infer, or hallucinate values.
   - Preserve comma-separated lists exactly as provided by the source.

7. GENRE & TAGS:
   - NEVER include "Comic" or "Comics" in Genre (it is redundant and pointless). If any source lists "Comics" or "Comic" as genre, strip it completely. Only include actual descriptive genres (e.g. "Superhero", "Sci-Fi", "Horror", "Crime", "Fantasy").

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
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingLevel: 'high'
      },
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
          Web: { type: 'STRING', description: 'Primary source reference URL' },
          Characters: { type: 'STRING', description: 'Comma-separated character names — from source only, never invent' },
          Teams: { type: 'STRING', description: 'Comma-separated team names — from source only, never invent' },
          Locations: { type: 'STRING', description: 'Comma-separated location names — from source only, never invent' },
          StoryArc: { type: 'STRING', description: 'Story arc name(s) — from source only, never invent' },
          StoryArcNumber: { type: 'STRING', description: 'Position within the story arc — from source only, never invent' },
          PageCount: { type: 'STRING', description: 'Page count — from source only, never invent' },
          AgeRating: { type: 'STRING', description: 'Content age rating — from source only, never invent' }
        },
        required: ['Series', 'Publisher']
      }
    }
  };
}

module.exports = {
  buildMetadataPrompt
};
