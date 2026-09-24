const fs = require('fs');
const path = require('path');
const { openArchive } = require('./archive-utils');
const yauzl = require('yauzl'); // yauzl still needed for writeComicInfoToCbz repacking logic
const xml2js = require('xml2js');
const archiver = require('archiver');
const crypto = require('crypto');
const { log } = require('../logger');
const { getMetadataStorage } = require('../config');
const { trimObjectStrings } = require('../utils');

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

async function getComicInfoFromArchive(comicPath) {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

  // 1. Check for adjacent sidecar ComicInfo.xml first
  const ext = path.extname(comicPath);
  const sidecarPath = path.join(path.dirname(comicPath), path.basename(comicPath, ext) + '.ComicInfo.xml');

  if (fs.existsSync(sidecarPath)) {
    try {
      const xml = await fs.promises.readFile(sidecarPath, 'utf-8');
      const result = await parser.parseStringPromise(xml);
      log('INFO', 'META', `📄 Read ComicInfo.xml metadata from sidecar for ${path.basename(comicPath)}`);
      const info = trimObjectStrings(result.ComicInfo || {});
      if (info.Title && (isTitleSameAsSeries(info.Title, info.Series) || (!info.Series && isTitleSameAsSeries(info.Title, '')))) {
        info.Title = '';
      }
      return info;
    } catch (err) {
      log('ERROR', 'META', `Failed to read ComicInfo.xml sidecar from ${path.basename(sidecarPath)}: ${err.message}`);
    }
  }

  // 2. Fallback to reading from Zip archive
  let archive;
  try {
    archive = await openArchive(comicPath);
    const entries = archive.listEntries();
    const infoEntry = entries.find(name => name.toLowerCase() === 'comicinfo.xml') ||
                      entries.find(name => path.basename(name).toLowerCase() === 'comicinfo.xml');
    
    if (infoEntry) {
      const buffer = await archive.readBuffer(infoEntry);
      const xml = buffer.toString('utf-8');
      try {
        const result = await parser.parseStringPromise(xml);
        const info = trimObjectStrings(result.ComicInfo || {});
        if (info.Title && (isTitleSameAsSeries(info.Title, info.Series) || (!info.Series && isTitleSameAsSeries(info.Title, '')))) {
          info.Title = '';
        }
        return info;
      } catch {
        return {};
      }
    }
  } catch (err) {
    log('ERROR', 'META', `Failed to read ComicInfo.xml from ${path.basename(comicPath)}: ${err.message}`);
  } finally {
    if (archive) archive.close();
  }
  return {};
}

const CANONICAL_PUBLISHER_MAP = {
  'dc': 'DC Comics',
  'dc comics': 'DC Comics',
  'dc universe': 'DC Comics',
  'dc black label': 'DC Comics',
  'vertigo': 'DC Comics',
  'image': 'Image',
  'image comics': 'Image',
  'imagev comics': 'Image',
  'image comics inc': 'Image',
  'image comics, inc': 'Image',
  'image comics, inc.': 'Image',
  'marvel': 'Marvel',
  'marvel comics': 'Marvel',
  'dark horse': 'Dark Horse Comics',
  'dark horse comics': 'Dark Horse Comics',
  'dark horse books': 'Dark Horse Comics',
  'idw': 'IDW Publishing',
  'idw publishing': 'IDW Publishing',
  'boom!': 'Boom! Studios',
  'boom! studios': 'Boom! Studios',
  'boom studios': 'Boom! Studios',
  'oni press': 'Oni Press',
  'oni': 'Oni Press',
  'fantagraphics': 'Fantagraphics',
  'fantagraphics books': 'Fantagraphics',
  'dynamite': 'Dynamite Entertainment',
  'dynamite entertainment': 'Dynamite Entertainment',
  'papercutz': 'Papercutz',
  'europe comics': 'Europe Comics',
  'cinebook': 'Cinebook',
  'aftershock': 'Aftershock Comics',
  'aftershock comics': 'Aftershock Comics',
  'humanoids': 'Humanoids',
  'humanoids inc': 'Humanoids',
  'humanoids, inc': 'Humanoids',
  'humanoids, inc.': 'Humanoids',
  'les humanoides associes': 'Les Humanoïdes Associés',
  'les humanoïdes associés': 'Les Humanoïdes Associés',
  'top shelf': 'Top Shelf',
  'top shelf productions': 'Top Shelf',
  'panini': 'Panini Comics',
  'panini comics': 'Panini Comics',
  'panini verlag': 'Panini Verlag',
  'rebellion': 'Rebellion',
  'rebellion / 2000ad': 'Rebellion',
  '2000 ad': 'Rebellion',
  '2000ad': 'Rebellion',
  '2000ad / rebellion': 'Rebellion',
  'titan': 'Titan Books',
  'titan books': 'Titan Books',
  'titan comics': 'Titan Comics',
  'vault': 'Vault Comics',
  'vault comics': 'Vault Comics',
  'scout': 'Scout Comics',
  'scout comics': 'Scout Comics',
  'mad cave': 'Mad Cave Studios',
  'mad cave studios': 'Mad Cave Studios',
  'ablaze': 'Ablaze',
  'ablaze publishing': 'Ablaze',
  'ahoy': 'Ahoy Comics',
  'ahoy comics': 'Ahoy Comics'
};

const COMMON_ENGLISH_WORDS = new Set([
  'the', 'and', 'of', 'to', 'in', 'a', 'is', 'that', 'for', 'it', 'as', 'was',
  'with', 'on', 'by', 'at', 'from', 'this', 'but', 'his', 'they', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so',
  'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make',
  'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into',
  'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
  'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after',
  'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new',
  'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'he', 'has',
  'had', 'comic', 'comics', 'series', 'story', 'stories', 'issue', 'issues', 'hero',
  'batman', 'superman', 'spider', 'man', 'world', 'earth', 'city', 'life', 'death',
  'collects', 'collecting', 'edition', 'graphic', 'novel', 'written', 'illustrated'
]);

const COMMON_FOREIGN_WORDS = new Set([
  // German
  'der', 'die', 'das', 'und', 'den', 'von', 'mit', 'sich', 'des', 'auf', 'für',
  'ist', 'im', 'dem', 'nicht', 'ein', 'eine', 'einer', 'einem', 'einen', 'als',
  'auch', 'es', 'an', 'werden', 'aus', 'hat', 'dass', 'daß', 'nach', 'wird',
  'bei', 'um', 'am', 'sind', 'noch', 'wie', 'über', 'war', 'haben', 'nur',
  'oder', 'aber', 'vor', 'zur', 'bis', 'mehr', 'durch', 'sein', 'wurde',
  'sammelband', 'ausgabe', 'enthält', 'abenteuer', 'deutschland',
  // French
  'le', 'la', 'les', 'des', 'du', 'une', 'dans', 'par', 'sur', 'avec', 'qui',
  'que', 'est', 'son', 'sa', 'ses', 'aux', 'au', 'se', 'pas', 'plus', 'ont',
  'tome', 'bande', 'dessinée', 'dessinee', 'intégrale', 'integrale', 'réunit', 'reunit', 'histoire',
  // Spanish
  'los', 'las', 'del', 'una', 'unos', 'unas', 'para', 'por', 'con', 'que',
  'su', 'sus', 'al', 'más', 'mas', 'este', 'esta', 'estos', 'estas', 'tomo',
  'contiene', 'recopila', 'número', 'numero', 'historia', 'cómic', 'comic', 'edición', 'edicion',
  // Italian
  'gli', 'dello', 'della', 'dei', 'degli', 'delle', 'uno', 'per', 'con', 'su',
  'da', 'che', 'più', 'piu', 'questo', 'questa', 'questi', 'queste', 'contiene', 'albo',
  // Portuguese
  'das', 'uma', 'uns', 'umas', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com',
  'não', 'nao', 'mais', 'edição', 'edicao'
]);

const IGNORED_FOREIGN_PUBLISHERS = new Set([
  'panini', 'panini comics', 'panini verlag', 'panini españa', 'panini espana',
  'panini france', 'panini brasil', 'panini spa', 'panini uk', 'panini manga',
  'panini comics (france)', 'panini comics (germany)', 'panini comics (italy)',
  'panini comics (spain)', 'planeta deagostini', 'planeta cómic', 'planeta comic',
  'editorial planeta deagostini', 'editorial televisa', 'televisa', 'abril',
  'editora abril', 'dino comics', 'urban comics', 'ecc ediciones', 'ecc',
  'egmont', 'egmont ehapa',
  'semic', 'edizioni bd', 'rw edizioni', 'salvat',
  'editorial salvat', 'eaglemoss', 'carlsen', 'carlsen verlag', 'glénat',
  'glenat',
  // Franco-Belgian / European / Latin-American publishers (added from TypeSafe
  // oracle findings — these were slipping through the English filter).
  // NB: deliberately excludes "Humanoids" (US English-language imprint of Les
  // Humanoïdes Associés) and "Europe Comics" (English digital translations).
  'dargaud', 'les humanoïdes associés', 'les humanoides associes',
  'casterman', 'delcourt', 'dupuis', 'soleil', 'paquet',
  'conrad editora', 'norma editorial', 'cross cult'
]);

function isForeignPublisher(publisherName, codex = null) {
  if (!publisherName) return false;
  let raw = String(publisherName).toLowerCase().trim().replace(/["'`]/g, '').trim();
  if (!raw) return false;

  // If this publisher exists in the user's library codex, do not treat as ignored
  if (Array.isArray(codex) && codex.length > 0) {
    const codexSet = new Set(codex.map(c => String(c).toLowerCase().trim()));
    if (codexSet.has(raw)) return false;
  }

  if (IGNORED_FOREIGN_PUBLISHERS.has(raw)) return true;
  for (const fp of IGNORED_FOREIGN_PUBLISHERS) {
    if (raw === fp || raw.startsWith(`${fp} `) || raw.endsWith(` ${fp}`) || ` ${raw} `.includes(` ${fp} `)) {
      return true;
    }
  }
  return false;
}

function isEnglishText(text) {
  if (!text) return true;
  const clean = String(text).replace(/<[^>]+>/g, ' ');
  const words = (clean.match(/\b[a-zA-Z\u00C0-\u017F]+\b/g) || []).map(w => w.toLowerCase());
  if (words.length < 5) return true;

  let engCount = 0;
  let foreignCount = 0;
  for (const w of words) {
    if (COMMON_ENGLISH_WORDS.has(w)) engCount++;
    if (COMMON_FOREIGN_WORDS.has(w)) foreignCount++;
  }

  if (foreignCount >= 2 && foreignCount > engCount) return false;
  if (engCount === 0 && foreignCount >= 2) return false;
  return true;
}

/**
 * Normalizes publisher names using a canonical mapping and optional DB publisher codex.
 * @param {string} publisherName 
 * @param {string[]} [codex] 
 * @returns {string}
 */
function normalizePublisher(publisherName, codex = null) {
  if (!publisherName) return '';
  let raw = String(publisherName).trim();
  raw = raw.replace(/["'`]/g, '').trim();
  if (!raw || raw.toLowerCase() === 'unknown publisher') return raw;

  // Strip country/corporate suffixes (e.g. ',US', ', U.S.', ', Inc.', ' Ltd', etc.)
  const stripped = raw.replace(/[\s,]+(?:US|U\.S\.|USA|U\.S\.A\.|UK|U\.K\.|GB|France|Germany|Spain|Italy|Inc\.?|LLC\.?|Ltd\.?|Limited)$/i, '').trim();

  const rawLower = raw.toLowerCase();
  const strippedLower = stripped.toLowerCase();

  // 1. Canonical map direct check
  if (CANONICAL_PUBLISHER_MAP[rawLower]) return CANONICAL_PUBLISHER_MAP[rawLower];
  if (CANONICAL_PUBLISHER_MAP[strippedLower]) return CANONICAL_PUBLISHER_MAP[strippedLower];

  // 2. Database codex matching (if provided)
  if (Array.isArray(codex) && codex.length > 0) {
    const codexMap = {};
    for (const c of codex) {
      if (c && String(c).trim() && String(c) !== 'Unknown Publisher') {
        codexMap[String(c).trim().toLowerCase()] = String(c).trim();
      }
    }
    if (codexMap[rawLower]) return codexMap[rawLower];
    if (codexMap[strippedLower]) return codexMap[strippedLower];

    const stemStripped = stripped.replace(/[\s,]+(?:Publishing|Comics|Press|Books|Studios|Entertainment|Productions)$/i, '').trim();
    const stemLower = stemStripped.toLowerCase();
    if (codexMap[stemLower]) return codexMap[stemLower];
  }

  return stripped;
}

/**
 * Sanitizes book/comic descriptions by stripping spec dumps, bookstore ads, and placeholders.
 * @param {string} desc 
 * @returns {string}
 */
function cleanDescription(desc) {
  if (!desc) return '';
  let s = String(desc);

  // 1. Strip HTML tags and normalize entities
  s = s.replace(/<[^<>]+>/g, ' ');
  const entityMap = { '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
  s = s.replace(/&(?:quot|#39|lt|gt|amp);/g, m => entityMap[m] || m);

  // 1b. Publisher editorial template (BOOM!/Archaia): "WHY WE LOVE IT: ...
  //     WHY YOU'LL LOVE IT: ... WHAT IT'S ABOUT: <real synopsis>". Keep only the
  //     synopsis after the "WHAT IT'S ABOUT / WHAT IT IS" marker.
  const aboutMarker = s.match(/WHAT\s+IT(?:['’]S|\s+IS)\s+ABOUT\s*:?\s*|WHAT\s+IT\s+IS\s*:?\s*/i);
  if (aboutMarker && /WHY\s+(?:WE|YOU['’]?LL)\s+LOVE\s+IT/i.test(s)) {
    s = s.slice(aboutMarker.index + aboutMarker[0].length);
  }
  // Any leftover "WHY WE/YOU LOVE IT:" label at the head of a block.
  s = s.replace(/\bWHY\s+(?:WE|YOU['’]?LL)\s+LOVE\s+IT\s*:?\s*/gi, ' ');

  // 1c. Anthology credits/table-of-contents dump: a "Story Titles" heading
  //     followed by a "<Title> - Written/illustrated by ..." list. Drop from
  //     the heading to the end (it is never part of the synopsis).
  s = s.replace(/(?:^|[\n\r])\s*Story Titles\s*[:\-]?\s*[\s\S]*$/i, ' ');

  // 1d. Cover-credits table dump (GCD): "List of covers and their creators:"
  //     followed by a glued Cover/Name/Creator table. Always trails the synopsis.
  s = s.replace(/(?:^|[\n\r.])\s*List of covers and their creators\s*:?[\s\S]*$/i, ' ');

  // 1e. Trailing GCD/ComicVine "Notes:" metadata block when it opens with a
  //     page-count spec (e.g. "Notes:72 pages with no ads. Reprinted in ...").
  //     Bounded to the "Notes:<n> pages" form so it can't swallow real prose.
  s = s.replace(/(?:^|[\n\r.])\s*Notes\s*:\s*\d+\s*pages\b[\s\S]*$/i, ' ');

  // 2. Spec table dumps & blocks (glued or line-separated)
  s = s.replace(/(?:Publisher\s+information\s*)?Publisher\s*:\s*[^\n\r]+?(?:ISBN(?:-1[03])?\s*:\s*[\d\-X]+)[^\n\r]*(?:Number of pages|Dimensions|Weight|Language|Publication)[^\n\r]*/gi, ' ');
  s = s.replace(/Publisher\s+information[\s\S]*?(?:Language\s*:\s*\w+|Dimensions\s*:\s*[\dx\s\w]+|Weight\s*:\s*[\d\w\s]+|ISBN\s*:\s*[\d\-X]+|Number of pages\s*:\s*\d+)/gi, ' ');

  // 3. Strip individual spec lines or tokens
  const specLinePatterns = [
    /(?:^|[\n\r])\s*(?:Publisher\s+information|Specification|Product Details|Book Details)\s*(?::|$)/gi,
    /(?:^|[\n\r])\s*Publisher\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*ISBN(?:-1[03])?\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*(?:Number of pages|Page count|Pages)\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*Dimensions\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*Weight\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*Language\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*Format\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*Dewey\s*(?:edition)?\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*Illustrations note\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*Country of Publication\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*Publication City\/Country\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*BIC\s*:\s*[^\n\r]+/gi,
    /(?:^|[\n\r])\s*BISAC\s*:\s*[^\n\r]+/gi,
    /Item:\s*.*?\|\s*Publisher:\s*.*?\|\s*Cover Artist:.*/gi,
    /ISBN(?:-1[03])?\s*:\s*[\d\-X]+/gi,
    /Number of pages\s*:\s*\d+/gi,
    /Dimensions\s*:\s*\d+\s*x\s*\d+[^\n\r,.]*/gi,
    /Weight\s*:\s*\d+\s*(?:g|kg|lbs?|oz)/gi,
    /Language\s*:\s*(?:English|French|German|Spanish|Italian|Japanese)/gi,
    /Publisher information\s*/gi
  ];
  for (const p of specLinePatterns) {
    s = s.replace(p, ' ');
  }

  // 4. Strip bookstore ads and boilerplates
  const adPatterns = [
    /Read reviews and discussion of\s+.*?(?:from\s+.*?)?(?:published by\s+.*?)(?:\.|$)/gi,
    /Read reviews and discussion of\s+.*/gi,
    /(?:Available\s+(?:now\s+)?(?:at|from)|Order\s+(?:now\s+)?(?:at|from|online\s+at)|Buy\s+(?:now\s+)?(?:at|from))\s+(?:Waterstones|Blackwell'?s?|Amazon|Barnes\s*&\s*Noble)[^\n\r.]*(?:\.|$)?/gi,
    /Why choose Blackwell'?s?\??[^\n\r.]*(?:\.|$)?/gi,
    /Free (?:UK )?delivery on orders over [^\n\r.]*(?:\.|$)?/gi,
    /(?:Click\s*&\s*Collect|Reserve in store|Add to (?:basket|cart|wishlist|wish list)|Check stock|Check availability)[^\n\r.]*(?:\.|$)?/gi
  ];
  for (const p of adPatterns) {
    s = s.replace(p, ' ');
  }

  // 5. Strip prefix labels
  s = s.replace(/^(?:SUMMARY|Summary|PRODUCT DESCRIPTION|Product Description|BOOK DESCRIPTION|Book Description|SYNOPSIS|Synopsis|OVERVIEW|Overview|DESCRIPTION|Description)\s*[:\-–—]\s*/i, '');

  // 6. Normalize whitespace
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n\s*\n+/g, '\n\n').trim();

  // 7. Check for placeholder descriptions
  const placeholders = new Set([
    'no description available.',
    'no description available',
    'no synopsis available.',
    'no synopsis available',
    'no overview available.',
    'no overview available',
    'no description.',
    'no description',
    'n/a',
    'none'
  ]);
  if (placeholders.has(s.toLowerCase())) {
    return '';
  }

  // 8. English language safeguard
  if (!isEnglishText(s)) {
    return '';
  }

  return s;
}

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
  s = s.replace(/[\(\[\{]\s*(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital(?:\s+edition)?|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)\s*[\)\]\}]/gi, ' ');

  // 2. Delimited format tokens: " - TPB", " TPB", " HC", " - Hardcover", ": A Graphic Novel", etc.
  s = s.replace(/(?:^|[\s,:;/|\-\u2010-\u2015]+)(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital\s+edition|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)(?=$|[\s,:;/|\-\u2010-\u2015]+$|[\s,:;/|\-\u2010-\u2015]*[\(\[\{]|[\s,:;/|\-\u2010-\u2015]+(?:v(?:ol)?\.?\s*\d+|#\d+|\bpart\b|\bbook\b|\bvolume\b)|[\s,:;/|\-\u2010-\u2015]+(?=[\-_/|:,;]))/gi, ' ');

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

const VOL_SPLIT_PATTERN = /^(?<series>.+?)[\s,:;\-–—]+\b(?<vol_token>(?<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?<vol_num>\d+)(?:(?<sub_sep>\s*[:\-–—]\s*|\s+)(?<subtitle>.+))?)$/i;
const STANDALONE_VOL_PATTERN = /^(?<vol_token>(?<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?<vol_num>\d+)(?:(?<sub_sep>\s*[:\-–—]\s*|\s+)(?<subtitle>.+))?)$/i;

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

  return { series: s, title: t, number: null, volume: null };
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

  // If title is just a generic issue/volume label without subtitle (e.g. "Volume", "Vol. 1", "Issue 3", "#3")
  if (/^(?:#|(?:issue|no\.?|vol(?:ume)?\.?|pt\.?|part|book|bk\.?)\s*#?)\s*\d*\s*$/i.test(tRaw)) {
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
 * Resolves creator roles across a metadata dictionary or ComicInfo object.
 * Disambiguates Writer, Penciller, Inker, Colorist, Letterer, CoverArtist.
 * Ensures:
 * 1. Artists/colorists are not dumped into Writer.
 * 2. Prunes known artists from Writer if multiple writers exist.
 * 3. Extracts explicit creator credits from Summary / Description if present.
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
  let inkers = toNameList(obj.Inker || obj.inker);
  let colorists = toNameList(obj.Colorist || obj.colorist);
  let letterers = toNameList(obj.Letterer || obj.letterer);
  let coverArtists = toNameList(obj.CoverArtist || obj.cover_artist || obj.coverArtist);
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
function buildComicInfoXml(metadataObj) {
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

  // Rule: If Title is the same as Series (even with issue numbers, #3, 3, volume, or format tags), do NOT add Title and keep Series
  if (safeObj.Title && (isTitleSameAsSeries(safeObj.Title, safeObj.Series) || (!safeObj.Series && isTitleSameAsSeries(safeObj.Title, '')))) {
    delete safeObj.Title;
  }

  // Disambiguate creator roles (Writer, Penciller, Inker, Colorist, Letterer)
  resolveCreatorRoles(safeObj);

  if (Object.keys(safeObj).length === 0) {
    return null;
  }

  const builder = new xml2js.Builder({
    rootName: 'ComicInfo',
    xmldec: { version: '1.0', encoding: 'UTF-8' }
  });
  return builder.buildObject(safeObj);
}

async function getExistingComicInfoPath(cbzPath) {
  let archive;
  try {
    archive = await openArchive(cbzPath);
    const entries = archive.listEntries();
    const infoEntry = entries.find(name => name.toLowerCase() === 'comicinfo.xml') ||
                      entries.find(name => path.basename(name).toLowerCase() === 'comicinfo.xml');
    if (infoEntry) {
      return infoEntry;
    }
  } catch (err) {
    // ignore
  } finally {
    if (archive) archive.close();
  }
  return null;
}

function writeComicInfoNative(cbzPath, metadataXml) {
  const os = require('os');
  const { execFile } = require('child_process');

  return new Promise(async (resolve, reject) => {
    // Find if there is an existing ComicInfo.xml path (case-insensitive) in the ZIP
    const existingPath = await getExistingComicInfoPath(cbzPath);

    const tempDir = os.tmpdir();
    const uniqueSubDir = path.join(tempDir, `comicinfo-${crypto.randomBytes(8).toString('hex')}`);

    fs.mkdir(uniqueSubDir, { recursive: true }, (dirErr) => {
      if (dirErr) return reject(dirErr);

      const tempXmlPath = path.join(uniqueSubDir, 'ComicInfo.xml');

      fs.writeFile(tempXmlPath, metadataXml, 'utf8', (err) => {
        if (err) {
          fs.rm(uniqueSubDir, { recursive: true, force: true }, () => {});
          return reject(err);
        }

        const runZipAdd = () => {
          // -j ignores directory paths, storing ComicInfo.xml at the root
          execFile('zip', ['-j', '--', cbzPath, tempXmlPath], (zipErr, stdout, stderr) => {
            // Clean up temp folder recursively
            fs.rm(uniqueSubDir, { recursive: true, force: true }, () => {});

            if (zipErr) {
              return reject(zipErr);
            }
            resolve();
          });
        };

        if (existingPath) {
          // Delete the existing entry first to prevent duplicate files with different casing/paths
          execFile('zip', ['-d', '--', cbzPath, existingPath], (delErr) => {
            // Even if delete fails, try to add
            runZipAdd();
          });
        } else {
          runZipAdd();
        }
      });
    });
  });
}

async function writeComicInfoToCbz(cbzPath, metadataXml) {
  // Try native zip utility first for blistering speed (copies compressed streams in C)
  try {
    await writeComicInfoNative(cbzPath, metadataXml);
    log('INFO', 'META', `✅ Updated ComicInfo.xml in ${path.basename(cbzPath)} using native zip`);
    return;
  } catch (nativeErr) {
    log('INFO', 'META', `Native zip update failed/unavailable; falling back to JS repacking: ${nativeErr.message}`);
  }

  // Use a unique temporary filename to prevent race conditions and collisions
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const tempPath = cbzPath + '.tmp.' + randomSuffix;

  try {
    await new Promise((resolve, reject) => {
      yauzl.open(cbzPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(err);

        const output = fs.createWriteStream(tempPath);
        const archive = archiver('zip', { zlib: { level: 9 }, forceZip64: true });

        let hasComicInfo = false;

        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          // Case-insensitive check for ComicInfo.xml anywhere in the path
          if (path.basename(entry.fileName).toLowerCase() === 'comicinfo.xml') {
            hasComicInfo = true;
            archive.append(metadataXml, { name: entry.fileName });
            zipfile.readEntry();
          } else if (entry.fileName.endsWith('/')) {
            archive.append(null, { name: entry.fileName });
            zipfile.readEntry();
          } else {
            zipfile.openReadStream(entry, (e, readStream) => {
              if (e) return reject(e);
              archive.append(readStream, { name: entry.fileName });
              readStream.on('end', () => zipfile.readEntry());
            });
          }
        });

        zipfile.on('end', () => {
          if (!hasComicInfo) {
            archive.append(metadataXml, { name: 'ComicInfo.xml' });
          }
          zipfile.close();
          archive.finalize();
        });

        zipfile.on('error', reject);
      });
    });

    await fs.promises.rename(tempPath, cbzPath);
    log('INFO', 'META', `✅ Updated ComicInfo.xml in ${path.basename(cbzPath)}`);
  } catch (err) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      await fs.promises.unlink(tempPath).catch(() => {});
    }
    throw err;
  }
}

async function saveMetadataToComic(comicPath, metadataObj) {
  const storageMode = getMetadataStorage();
  const ext = path.extname(comicPath).toLowerCase();

  if (storageMode === 'db') {
    log('INFO', 'META', `Metadata storage mode is DB-only; skipping disk write for ${path.basename(comicPath)}`);
    return;
  }

  try {
    log('INFO', 'META', `Writing ComicInfo.xml for ${path.basename(comicPath)}`);

    const metadataXml = buildComicInfoXml(trimObjectStrings(metadataObj));
    if (!metadataXml) {
      log('INFO', 'META', `No valid metadata for ${path.basename(comicPath)}; skipping save.`);
      return;
    }

    if (storageMode === 'sidecar') {
      const sidecarPath = path.join(path.dirname(comicPath), path.basename(comicPath, ext) + '.ComicInfo.xml');
      await fs.promises.writeFile(sidecarPath, metadataXml, 'utf-8');
      log('INFO', 'META', `✅ Saved ComicInfo.xml sidecar for ${path.basename(comicPath)}`);
    } else {
      // mode is 'archive'
      if (ext === '.cbr') {
        log('INFO', 'META', `File is CBR; skipping internal ZIP write and fallback to DB-only for ${path.basename(comicPath)}`);
        return;
      }
      await module.exports.writeComicInfoToCbz(comicPath, metadataXml);
      log('INFO', 'META', `✅ Saved ComicInfo.xml internally in ${path.basename(comicPath)}`);
    }
  } catch (err) {
    log('ERROR', 'META', `ComicInfo write-back failed for ${path.basename(comicPath)}: ${err.message}`);
  }
}

module.exports = {
  COMICINFO_TAGS,
  CANONICAL_PUBLISHER_MAP,
  IGNORED_FOREIGN_PUBLISHERS,
  isForeignPublisher,
  isEnglishText,
  getComicInfoFromArchive,
  saveMetadataToComic,
  writeComicInfoToCbz,
  buildComicInfoXml,
  cleanFormatAndEdition,
  normalizePublisher,
  cleanDescription,
  splitVolumeSeriesAndTitle,
  isTitleSameAsSeries,
  resolveCreatorRoles
};

