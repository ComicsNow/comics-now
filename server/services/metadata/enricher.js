const xml2js = require('xml2js');
const { normalizePublisher, cleanDescription } = require('./heuristics');
const {
  cleanFormatAndEdition,
  splitVolumeSeriesAndTitle,
  cleanGenreAndTags,
  isTitleSameAsSeries
} = require('./sanitizer');

const COMICINFO_TAGS = {
  Title: 'Title',
  Series: 'Series',
  Number: 'Number',
  Count: 'Count',
  Volume: 'Volume',
  Summary: 'Summary',
  Notes: 'Notes',
  Year: 'Year',
  Month: 'Month',
  Day: 'Day',
  Writer: 'Writer',
  Penciller: 'Penciller',
  Inker: 'Inker',
  Colorist: 'Colorist',
  Letterer: 'Letterer',
  CoverArtist: 'CoverArtist',
  Editor: 'Editor',
  Publisher: 'Publisher',
  Genre: 'Genre',
  Tags: 'Tags',
  Web: 'Web',
  PageCount: 'PageCount',
  LanguageISO: 'LanguageISO',
  Format: 'Format',
  BlackAndWhite: 'BlackAndWhite',
  AgeRating: 'AgeRating',
  Characters: 'Characters',
  Teams: 'Teams',
  Locations: 'Locations',
  ScanInformation: 'ScanInformation',
  SeriesGroup: 'SeriesGroup',
  StoryArc: 'StoryArc',
  'Cover Date': 'CoverDate',
  'Store Date': 'StoreDate',
  StartYear: 'Year'
};

/**
 * Resolves creator roles across a metadata dictionary or ComicInfo object.
 * Disambiguates Writer, Penciller, Inker, Colorist, Letterer, CoverArtist.
 * @param {object} obj
 * @param {Array<string>} [seriesArtists]
 * @returns {object}
 */
function resolveCreatorRoles(obj, seriesArtists = []) {
  if (!obj || typeof obj !== 'object') return obj;

  const toNameList = (val) => {
    if (!val) return [];
    const items = Array.isArray(val) ? val : [val];
    const names = [];
    for (const item of items) {
      const parts = String(item).split(/[,;&]|\s+and\s+/i);
      for (const part of parts) {
        const p = part.trim();
        if (p && !names.some(n => n.toLowerCase() === p.toLowerCase())) {
          names.push(p);
        }
      }
    }
    return names;
  };

  let writers = toNameList(obj.Writer || obj.writer);
  let pencillers = toNameList(obj.Penciller || obj.penciller);
  const inkers = toNameList(obj.Inker || obj.inker);
  const colorists = toNameList(obj.Colorist || obj.colorist);
  const letterers = toNameList(obj.Letterer || obj.letterer);
  const coverArtists = toNameList(obj.CoverArtist || obj.cover_artist || obj.coverArtist);
  const authors = toNameList(obj.authors || obj.Authors);

  const desc = obj.Summary || obj.Description || obj.summary || obj.description || '';
  const allPool = [...writers, ...pencillers, ...inkers, ...colorists, ...letterers, ...coverArtists, ...authors, ...seriesArtists];

  if (desc) {
    const wPattern = /\b(?:writer|written by|script(?: by)?)\s+([A-Z][a-zA-Z\.\'\-\s]+?)(?=\s*[\(\,\.\n]| and | & | artist | while |\bjoins\b|\btest\b|$)/gi;
    const aPattern = /\b(?:artist|art by|illustrated by|drawn by|penciller|penciler)\s+([A-Z][a-zA-Z\.\'\-\s]+?)(?=\s*[\(\,\.\n]| and | & | writer | while |\bjoins\b|\btest\b|\bexplore\b|$)/gi;
    const cPattern = /\b(?:colorist|colors by|colourist|colours by)\s+([A-Z][a-zA-Z\.\'\-\s]+?)(?=\s*[\(\,\.\n]| and | & |\bjoins\b|$)/gi;
    const lPattern = /\b(?:letterer|letters by)\s+([A-Z][a-zA-Z\.\'\-\s]+?)(?=\s*[\(\,\.\n]| and | & |\bjoins\b|$)/gi;

    let m;
    while ((m = wPattern.exec(desc)) !== null) {
      const cand = allPool.find(n => n.toLowerCase() === m[1].trim().toLowerCase()) || m[1].trim();
      if (!writers.some(w => w.toLowerCase() === cand.toLowerCase())) writers.push(cand);
    }
    while ((m = aPattern.exec(desc)) !== null) {
      const cand = allPool.find(n => n.toLowerCase() === m[1].trim().toLowerCase()) || m[1].trim();
      if (!pencillers.some(p => p.toLowerCase() === cand.toLowerCase())) pencillers.push(cand);
    }
    while ((m = cPattern.exec(desc)) !== null) {
      const cand = allPool.find(n => n.toLowerCase() === m[1].trim().toLowerCase()) || m[1].trim();
      if (!colorists.some(c => c.toLowerCase() === cand.toLowerCase())) colorists.push(cand);
    }
    while ((m = lPattern.exec(desc)) !== null) {
      const cand = allPool.find(n => n.toLowerCase() === m[1].trim().toLowerCase()) || m[1].trim();
      if (!letterers.some(l => l.toLowerCase() === cand.toLowerCase())) letterers.push(cand);
    }
  }

  const knownArtists = new Set([
    ...pencillers,
    ...inkers,
    ...colorists,
    ...letterers,
    ...coverArtists,
    ...seriesArtists
  ].map(p => p.toLowerCase()));

  // If writers has known artists from series/pool, move them to pencillers if pencillers lacks them
  for (const w of writers) {
    if (seriesArtists.some(sa => sa.toLowerCase() === w.toLowerCase()) && !pencillers.some(p => p.toLowerCase() === w.toLowerCase())) {
      pencillers.push(w);
      knownArtists.add(w.toLowerCase());
    }
  }

  // If writers is empty and authors exists, populate writers excluding known artists
  if (writers.length === 0 && authors.length > 0) {
    writers = authors.filter(a => !knownArtists.has(a.toLowerCase()));
    if (writers.length === 0) {
      if (authors.length === 2 && pencillers.length === 0) {
        writers = [authors[0]];
        pencillers = [authors[1]];
        knownArtists.add(authors[1].toLowerCase());
      } else {
        writers = [...authors];
      }
    }
  }

  // Prune known artists from writers if at least one writer remains
  if (writers.length > 1 && knownArtists.size > 0) {
    const filtered = writers.filter(w => !knownArtists.has(w.toLowerCase()));
    if (filtered.length > 0) {
      writers = filtered;
    }
  }

  const setRole = (tagKey, lowerKey, arr) => {
    const val = arr.join(', ');
    const hasTag = obj[tagKey] !== undefined;
    const hasLower = obj[lowerKey] !== undefined;
    if (hasTag || hasLower || val) {
      if (hasTag || (!hasLower && val)) {
        if (val) obj[tagKey] = val; else delete obj[tagKey];
      }
      if (hasLower) {
        if (val) obj[lowerKey] = val; else delete obj[lowerKey];
      }
    }
  };

  setRole('Writer', 'writer', writers);
  setRole('Penciller', 'penciller', pencillers);
  setRole('Inker', 'inker', inkers);
  setRole('Colorist', 'colorist', colorists);
  setRole('Letterer', 'letterer', letterers);
  setRole('CoverArtist', 'cover_artist', coverArtists);

  return obj;
}

/**
 * Builds a ComicInfo.xml string from a metadata object
 * @param {object} metadataObj
 * @returns {string|null} XML string or null if no valid metadata
 */
function buildComicInfoXml(metadataObj, options = {}) {
  const safeObj = {};

  for (const [key, val] of Object.entries(metadataObj || {})) {
    const tag = COMICINFO_TAGS[key];
    if (!tag) continue;
    if (val == null || val === '') continue;

    if (Array.isArray(val)) {
      const joined = val.map(v => (v != null ? String(v).trim() : '')).filter(Boolean).join(', ');
      if (joined) {
        safeObj[tag] = joined;
      }
    } else {
      safeObj[tag] = val;
    }
  }

  // Clean format/edition tags from Title and Series
  if (safeObj.Title) {
    safeObj.Title = cleanFormatAndEdition(safeObj.Title);
    if (!safeObj.Title) delete safeObj.Title;
  }
  if (safeObj.Series) {
    safeObj.Series = cleanFormatAndEdition(safeObj.Series);
    if (!safeObj.Series) delete safeObj.Series;
  }

  // Normalize Publisher & Summary
  if (safeObj.Publisher) {
    safeObj.Publisher = normalizePublisher(safeObj.Publisher);
    if (!safeObj.Publisher) delete safeObj.Publisher;
  }
  if (safeObj.Summary) {
    safeObj.Summary = cleanDescription(safeObj.Summary);
    if (!safeObj.Summary) delete safeObj.Summary;
  }

  // Split volume info from Series/Title if applicable
  const volSplit = splitVolumeSeriesAndTitle(safeObj.Series, safeObj.Title);
  if (volSplit.series && volSplit.number) {
    safeObj.Series = volSplit.series;
    safeObj.Title = volSplit.title;
    if (!safeObj.Number || safeObj.Number === '1' || safeObj.Number === '01') {
      safeObj.Number = volSplit.number;
    }
    if (!safeObj.Volume) {
      safeObj.Volume = volSplit.volume;
    }
  }
  if (!safeObj.Number && safeObj.Volume) {
    safeObj.Number = safeObj.Volume;
  }

  // Rule: If Title is the same as Series, do NOT add Title and keep Series
  if (!options.preserveTitle && safeObj.Title && (isTitleSameAsSeries(safeObj.Title, safeObj.Series) || (!safeObj.Series && isTitleSameAsSeries(safeObj.Title, '')))) {
    delete safeObj.Title;
  }

  // Disambiguate creator roles (Writer, Penciller, Inker, Colorist, Letterer)
  resolveCreatorRoles(safeObj);

  // Clean Genre and Tags to remove redundant "comic" and "comics"
  if (safeObj.Genre) {
    const cg = cleanGenreAndTags(safeObj.Genre);
    if (cg) safeObj.Genre = cg;
    else delete safeObj.Genre;
  }
  if (safeObj.Tags) {
    const ct = cleanGenreAndTags(safeObj.Tags);
    if (ct) safeObj.Tags = ct;
    else delete safeObj.Tags;
  }

  if (Object.keys(safeObj).length === 0) {
    return null;
  }

  const builder = new xml2js.Builder({
    rootName: 'ComicInfo',
    xmldec: { version: '1.0', encoding: 'UTF-8' }
  });
  return builder.buildObject(safeObj);
}

module.exports = {
  COMICINFO_TAGS,
  resolveCreatorRoles,
  buildComicInfoXml
};
