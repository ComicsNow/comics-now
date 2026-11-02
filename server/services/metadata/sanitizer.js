/**
 * Strips edition/format tags (e.g. TP, HB, TPB, HC, SC, GN, Paperback, Hardcover,
 * Hardback, Softcover, Trade Paperback, Digital Edition, etc.) from titles and series.
 * @param {string} text
 * @returns {string}
 */
function cleanFormatAndEdition(text) {
  if (!text) return '';
  let s = String(text);

  // 1. Bracketed format/edition tags: (TPB), [HC], (Paperback), (digital), {HB}, etc.
  s = s.replace(/[\(\[\{]\s*(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital(?:\s+edition)?|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)(?:\s+edition)?\s*[\)\]\}]/gi, ' ');

  // 2. Delimited format tokens: " - TPB", " TPB", " HC", " - Hardcover", ": A Graphic Novel", etc.
  s = s.replace(/(?:^|[\s,:;/|\-\u2010-\u2015]+)(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)(?:\s+edition)?(?=$|[\s,:;/|\-\u2010-\u2015]+$|[\s,:;/|\-\u2010-\u2015]*[\(\[\{]|[\s,:;/|\-\u2010-\u2015]+(?:v(?:ol)?\.?\s*\d+|#\d+|\bpart\b|\bbook\b|\bvolume\b)|[\s,:;/|\-\u2010-\u2015]+(?=[\-_/|:,;]))/gi, ' ');

  // 3. Trailing digital indicator: " - digital" or ", digital" at end of string or before brackets
  s = s.replace(/[\s,:;/|\-\u2010-\u2015]+digital(?=$|[\s,:;/|\-\u2010-\u2015]+$|[\s,:;/|\-\u2010-\u2015]*[\(\[\{])/gi, ' ');

  // 4. Remove empty brackets () [] {}
  s = s.replace(/[\(\[\{]\s*[\)\]\}]/g, ' ');

  // 5. Clean whitespace & trailing/leading/repeated delimiters
  s = s.replace(/\s*[:;\-–—|/,]+\s*[:;\-–—|/,]+/g, ' - ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[\s,:;/|\-\u2010-\u2015]+$/g, '').trim();
  s = s.replace(/^[\s,:;/|\-\u2010-\u2015]+/g, '').trim();
  return s;
}

const VOL_SPLIT_PATTERN = /^(?<series>.+?)[\s,:;\-–—]+\b(?<vol_token>(?<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?<vol_num>\d+)(?:(?<sub_sep>\s*[:\-–—,;]\s*|\s+)(?<subtitle>.+))?)$/i;
const STANDALONE_VOL_PATTERN = /^(?<vol_token>(?<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?<vol_num>\d+)(?:(?<sub_sep>\s*[:\-–—,;]\s*|\s+)(?<subtitle>.+))?)$/i;
const SERIES_ISSUE_PATTERN = /^(?<series>.+?)(?:[\s,:;\-–—]+|\s*)(?:(?:#|(?:issue|no\.?)\s*#?)\s*0*(?<issue_num>\d+)|[\s,:;\-–—]+0+(?<leading_zero_num>[1-9]\d*))$/i;

function splitVolumeSeriesAndTitle(series, title) {
  const s = (series || '').trim();
  const t = (title || '').trim();

  let m = s.match(VOL_SPLIT_PATTERN);
  if (!m && t) {
    m = t.match(VOL_SPLIT_PATTERN);
  }

  if (m && m.groups) {
    const extSeries = m.groups.series.replace(/[\s,:;\-–—]+$/, '').trim();
    const prefix = m.groups.vol_prefix;
    const num = String(parseInt(m.groups.vol_num, 10));
    const sub = (m.groups.subtitle || '').trim();
    let formattedTitle = m.groups.vol_token.trim();
    if (prefix.toLowerCase() === 'v') {
      formattedTitle = sub ? `Vol. ${num}: ${sub}` : `Volume ${num}`;
    }
    return {
      series: extSeries,
      title: formattedTitle,
      number: num,
      volume: num
    };
  }

  const standMatch = t.match(STANDALONE_VOL_PATTERN);
  if (standMatch && standMatch.groups) {
    const prefix = standMatch.groups.vol_prefix;
    const num = String(parseInt(standMatch.groups.vol_num, 10));
    const sub = (standMatch.groups.subtitle || '').trim();
    let formattedTitle = standMatch.groups.vol_token.trim();
    if (prefix.toLowerCase() === 'v') {
      formattedTitle = sub ? `Vol. ${num}: ${sub}` : `Volume ${num}`;
    }
    return {
      series: s,
      title: formattedTitle,
      number: num,
      volume: num
    };
  }

  // Check if series ends with an issue number (e.g. "Batman #1", "Batman #01", "Batman 01", "Batman Issue 1")
  const issueMatch = s.match(SERIES_ISSUE_PATTERN);
  if (issueMatch && issueMatch.groups) {
    const extSeries = issueMatch.groups.series.replace(/[\s,:;\-–—]+$/, '').trim();
    const num = String(parseInt(issueMatch.groups.issue_num || issueMatch.groups.leading_zero_num, 10));
    return {
      series: extSeries,
      title: t,
      number: num,
      volume: null
    };
  }

  return { series: s, title: t, number: null, volume: null };
}

function cleanGenreAndTags(val) {
  if (!val) return '';
  const items = Array.isArray(val) ? val : String(val).split(',');
  return items
    .map(s => String(s || '').trim())
    .filter(s => s && s.toLowerCase() !== 'comic' && s.toLowerCase() !== 'comics')
    .join(', ');
}

/**
 * Determines whether a title is redundant with the series name.
 * If Title is the same as Series (even with issue numbers, #3, 3, volume suffixes, or format tags),
 * Title must be left blank.
 *
 * @param {string} title
 * @param {string} series
 * @returns {boolean}
 */
function isTitleSameAsSeries(title, series) {
  if (!title) return false;
  const tRaw = cleanFormatAndEdition(String(title)).trim();
  if (!tRaw) return true; // Title was just a format tag (e.g. "HC", "TPB") -> blank it!

  // If title is just a generic issue/volume label without subtitle (e.g. "Volume", "Vol. 1", "Issue 3", "#3", "1", "01")
  if (/^(?:(?:#|(?:issue|no\.?|vol(?:ume)?\.?|pt\.?|part|book|bk\.?)\s*#?)\s*\d*|\d+)\s*$/i.test(tRaw)) {
    return true;
  }

  if (!series) return false;
  const sRaw = cleanFormatAndEdition(String(series)).trim();
  if (!sRaw) return false;

  if (tRaw.toLowerCase() === sRaw.toLowerCase()) return true;

  // Direct regex check on raw strings
  const escapedS = sRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const directPattern = new RegExp(
    `^${escapedS}[:\\s\\-_–—]*(?:#|(?:issue|no\\.?|vol(?:ume)?\\.?|pt\\.?|part|book|bk\\.?)\\s*#?)?\\s*\\d+(?:\\s*(?:of|\\/)\\s*\\d+)?\\s*(?:\\(\\d{4}\\))?\\s*[)\\]}]*$`,
    'i'
  );
  if (directPattern.test(tRaw)) return true;

  // Normalized alphanumeric comparison
  const normS = sRaw.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normT = tRaw.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (normT === normS) return true;

  if (normT.startsWith(normS)) {
    const rem = normT.slice(normS.length).trim();
    if (/^(?:#|(?:issue|no|vol|volume|pt|part|book|bk)\s*#?)?\s*\d+(?:\s*(?:of|\/)\s*\d+)?(?:\s*\d{4})?$/i.test(rem)) {
      return true;
    }
  }

  if (normS.startsWith(normT)) {
    const rem = normS.slice(normT.length).trim();
    if (/^(?:#|(?:issue|no|vol|volume|pt|part|book|bk)\s*#?)?\s*\d+(?:\s*(?:of|\/)\s*\d+)?(?:\s*\d{4})?$/i.test(rem)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitizes metadata fields (Series, Title, Number, Volume, Genre, Tags) according to standard rules:
 * 1. Strips format/edition tags (TPB, HC, Softcover, Hardcover, Graphic Novel, etc.) from Series and Title.
 * 2. Strips volume/issue numbers from Series (e.g. "#1", "01", "Vol. 1") and extracts number/volume.
 * 3. Clears Title if it is redundant with Series, just Series + issue number, or a generic issue label.
 * 4. Cleans Genre and Tags to remove redundant "comic" and "comics" values.
 *
 * @param {Object} metadata
 * @returns {Object} Sanitized metadata (modified in-place and returned)
 */
function sanitizeMetadata(metadata, options = {}) {
  if (!metadata || typeof metadata !== 'object') return metadata;

  // 1. Strip format/edition words like TPB, HC, Hardcover, Softcover, Graphic Novel, etc. from Series and Title
  if (metadata.Series) {
    metadata.Series = cleanFormatAndEdition(metadata.Series);
  }
  if (metadata.Title) {
    metadata.Title = cleanFormatAndEdition(metadata.Title);
  }

  // 2. Strip volume/issue numbers from Series
  const volSplit = splitVolumeSeriesAndTitle(metadata.Series, metadata.Title);
  if (volSplit.series && (volSplit.number || volSplit.series !== metadata.Series)) {
    metadata.Series = volSplit.series;
    if (volSplit.title !== undefined) {
      metadata.Title = volSplit.title;
    }
    if (!metadata.Number || metadata.Number === '1' || metadata.Number === '01') {
      if (volSplit.number) metadata.Number = volSplit.number;
    }
    if (!metadata.Volume && volSplit.volume) {
      metadata.Volume = volSplit.volume;
    }
  }
  if (!metadata.Number && metadata.Volume) {
    metadata.Number = metadata.Volume;
  }

  // If Number is still empty, check if Title has an issue number before clearing Title
  if (!metadata.Number && metadata.Title) {
    const issueMatch = metadata.Title.match(/^(?:.*[\s,:;\-–—]+)?(?:#|(?:issue|no\.?)\s*#?)\s*0*(\d+)/i) ||
                       metadata.Title.match(/^(?:.*[\s,:;\-–—]+)?0*(\d+)$/);
    if (issueMatch) {
      metadata.Number = String(parseInt(issueMatch[1], 10));
    }
  }

  // 3. Check isTitleSameAsSeries(Title, Series)
  if (!options.preserveTitle && metadata.Title && (isTitleSameAsSeries(metadata.Title, metadata.Series) || (!metadata.Series && isTitleSameAsSeries(metadata.Title, '')))) {
    metadata.Title = '';
  }

  // 4. Strip redundant "comic" / "comics" from Genre and Tags
  if (metadata.Genre) {
    const cg = cleanGenreAndTags(metadata.Genre);
    if (cg) metadata.Genre = cg;
    else delete metadata.Genre;
  }
  if (metadata.Tags) {
    const ct = cleanGenreAndTags(metadata.Tags);
    if (ct) metadata.Tags = ct;
    else delete metadata.Tags;
  }

  return metadata;
}

module.exports = {
  cleanFormatAndEdition,
  splitVolumeSeriesAndTitle,
  cleanGenreAndTags,
  isTitleSameAsSeries,
  sanitizeMetadata
};
