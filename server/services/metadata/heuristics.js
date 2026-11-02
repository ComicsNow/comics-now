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
  // Franco-Belgian / European / Latin-American publishers
  'dargaud', 'les humanoïdes associés', 'les humanoides associes',
  'casterman', 'delcourt', 'dupuis', 'soleil', 'paquet',
  'conrad editora', 'norma editorial', 'cross cult'
]);

function isForeignPublisher(publisherName, codex = null) {
  if (!publisherName) return false;
  const raw = String(publisherName).toLowerCase().trim().replace(/["'`]/g, '').trim();
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

  // 1b. Publisher editorial template (BOOM!/Archaia)
  const aboutMarker = s.match(/WHAT\s+IT(?:['’]S|\s+IS)\s+ABOUT\s*:?\s*|WHAT\s+IT\s+IS\s*:?\s*/i);
  if (aboutMarker && /WHY\s+(?:WE|YOU['’]?LL)\s+LOVE\s+IT/i.test(s)) {
    s = s.slice(aboutMarker.index + aboutMarker[0].length);
  }
  s = s.replace(/\bWHY\s+(?:WE|YOU['’]?LL)\s+LOVE\s+IT\s*:?\s*/gi, ' ');

  // 1c. Anthology credits/table-of-contents dump
  s = s.replace(/(?:^|[\n\r])\s*Story Titles\s*[:\-]?\s*[\s\S]*$/i, ' ');

  // 1d. Cover-credits table dump (GCD)
  s = s.replace(/(?:^|[\n\r.])\s*List of covers and their creators\s*:?[\s\S]*$/i, ' ');

  // 1e. Trailing GCD/ComicVine "Notes:" metadata block
  s = s.replace(/(?:^|[\n\r.])\s*Notes\s*:\s*\d+\s*pages\b[\s\S]*$/i, ' ');

  // 2. Spec table dumps & blocks
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

module.exports = {
  CANONICAL_PUBLISHER_MAP,
  IGNORED_FOREIGN_PUBLISHERS,
  isForeignPublisher,
  isEnglishText,
  normalizePublisher,
  cleanDescription
};
