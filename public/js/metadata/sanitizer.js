const VOL_SPLIT_PATTERN = /^(?<series>.+?)[\s,:;\-–—]+\b(?<vol_token>(?<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?<vol_num>\d+)(?:(?<sub_sep>\s*[:\-–—,;]\s*|\s+)(?<subtitle>.+))?)$/i;
const STANDALONE_VOL_PATTERN = /^(?<vol_token>(?<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?<vol_num>\d+)(?:(?<sub_sep>\s*[:\-–—,;]\s*|\s+)(?<subtitle>.+))?)$/i;
const SERIES_ISSUE_PATTERN = /^(?<series>.+?)(?:[\s,:;\-–—]+|\s*)(?:(?:#|(?:issue|no\.?)\s*#?)\s*0*(?<issue_num>\d+)|[\s,:;\-–—]+0+(?<leading_zero_num>[1-9]\d*))$/i;

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

function splitVolumeSeriesAndTitle(series, title) {
  let s = (series || '').trim();
  let t = (title || '').trim();

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
  const items = String(val).split(',').map(s => s.trim()).filter(Boolean);
  const filtered = items.filter(s => {
    const lower = s.toLowerCase();
    return lower !== 'comic' && lower !== 'comics';
  });
  return filtered.join(', ');
}

function isTitleSameAsSeries(title, series) {
  if (!title) return false;
  const tRaw = cleanFormatAndEdition(String(title)).trim();
  if (!tRaw) return true;

  if (/^(?:(?:#|(?:issue|no\.?|vol(?:ume)?\.?|pt\.?|part|book|bk\.?)\s*#?)\s*\d*|\d+)\s*$/i.test(tRaw)) {
    return true;
  }

  if (!series) return false;
  const sRaw = cleanFormatAndEdition(String(series)).trim();
  if (!sRaw) return false;

  if (tRaw.toLowerCase() === sRaw.toLowerCase()) return true;

  const escapedS = sRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const directPattern = new RegExp(
    `^${escapedS}[:\\s\\-_–—]*(?:#|(?:issue|no\\.?|vol(?:ume)?\\.?|pt\\.?|part|book|bk\\.?)\\s*#?)?\\s*\\d+(?:\\s*(?:of|\\/)\\s*\\d+)?\\s*(?:\\(\\d{4}\\))?\\s*[)\\]}]*$`,
    'i'
  );
  if (directPattern.test(tRaw)) return true;

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

const KEY_ALIAS_TO_CANONICAL = {
  title: 'Title',
  issue_title: 'Title',
  series: 'Series',
  number: 'Number',
  issue: 'Number',
  issue_number: 'Number',
  volume: 'Volume',
  summary: 'Summary',
  description: 'Summary',
  writer: 'Writer',
  penciller: 'Penciller',
  inker: 'Inker',
  colorist: 'Colorist',
  letterer: 'Letterer',
  cover_artist: 'CoverArtist',
  coverartist: 'CoverArtist',
  editor: 'Editor',
  publisher: 'Publisher',
  imprint: 'Imprint',
  genre: 'Genre',
  tags: 'Tags',
  web: 'Web',
  source_url: 'Web',
  page_count: 'PageCount',
  pagecount: 'PageCount',
  characters: 'Characters',
  teams: 'Teams',
  locations: 'Locations',
  story_arc: 'StoryArc',
  storyarc: 'StoryArc',
  story_arc_number: 'StoryArcNumber',
  storyarcnumber: 'StoryArcNumber',
  age_rating: 'AgeRating',
  agerating: 'AgeRating',
  year: 'Year',
  month: 'Month',
  day: 'Day',
  cover_date: 'CoverDate',
  coverdate: 'CoverDate',
  'cover date': 'CoverDate',
  publish_date: 'CoverDate',
  store_date: 'StoreDate',
  storedate: 'StoreDate',
  'store date': 'StoreDate',
  notes: 'Notes',
  isbn: 'ISBN',
  format: 'Format'
};

function sanitizeMetadata(metadata, options = {}) {
  if (!metadata || typeof metadata !== 'object') return metadata;

  if (metadata.Series) {
    metadata.Series = cleanFormatAndEdition(metadata.Series);
  }
  if (metadata.Title) {
    metadata.Title = cleanFormatAndEdition(metadata.Title);
  }

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

  if (!metadata.Number && metadata.Title) {
    const issueMatch = metadata.Title.match(/^(?:.*[\s,:;\-–—]+)?(?:#|(?:issue|no\.?)\s*#?)\s*0*(\d+)/i) ||
                       metadata.Title.match(/^(?:.*[\s,:;\-–—]+)?0*(\d+)$/);
    if (issueMatch) {
      metadata.Number = String(parseInt(issueMatch[1], 10));
    }
  }

  if (!options.preserveTitle && metadata.Title && (isTitleSameAsSeries(metadata.Title, metadata.Series) || (!metadata.Series && isTitleSameAsSeries(metadata.Title, '')))) {
    metadata.Title = '';
  }

  if (metadata.Genre) {
    metadata.Genre = cleanGenreAndTags(metadata.Genre);
  }
  if (metadata.Tags) {
    metadata.Tags = cleanGenreAndTags(metadata.Tags);
  }
  if (metadata.genre) {
    metadata.genre = cleanGenreAndTags(metadata.genre);
  }
  if (metadata.tags) {
    metadata.tags = cleanGenreAndTags(metadata.tags);
  }
  if (Array.isArray(metadata.genres)) {
    metadata.genres = metadata.genres.filter(s => {
      const lower = String(s || '').trim().toLowerCase();
      return lower && lower !== 'comic' && lower !== 'comics';
    });
  }

  for (const [aliasKey, canonicalKey] of Object.entries(KEY_ALIAS_TO_CANONICAL)) {
    if (Object.prototype.hasOwnProperty.call(metadata, aliasKey)) {
      if (metadata[canonicalKey] === undefined || metadata[canonicalKey] === '' || metadata[canonicalKey] === null) {
        if (metadata[aliasKey] !== undefined && metadata[aliasKey] !== '' && metadata[aliasKey] !== null) {
          metadata[canonicalKey] = metadata[aliasKey];
        }
      }
      delete metadata[aliasKey];
    }
  }

  return metadata;
}

export {
  cleanFormatAndEdition,
  splitVolumeSeriesAndTitle,
  cleanGenreAndTags,
  isTitleSameAsSeries,
  sanitizeMetadata
};
