/**
 * Deterministic Multi-Source Metadata Merger
 *
 * Mirrors the Python automated tagger's `merge_best_metadata_fields` logic
 * (`tagger/tagger_app/core/metadata_parts/merger.py`) so staged sources in
 * manual metadata search can be synthesized deterministically when Gemini AI
 * is disabled or unconfigured.
 */

const {
  isForeignPublisher,
  normalizePublisher,
  cleanDescription
} = require('./heuristics');
const {
  cleanFormatAndEdition,
  isTitleSameAsSeries
} = require('./sanitizer');
const { normalizeGeminiMetadata } = require('../gemini-meta/normalizer');

const COMIC_DB_KEYWORDS = [
  'comicvine', 'metron', 'gcd', 'grandcomicsdatabase', 'leagueofcomicgeeks', 'lcg'
];

function isComicDbSource(sourceStr) {
  const s = String(sourceStr || '').toLowerCase();
  return COMIC_DB_KEYWORDS.some(k => s.includes(k));
}

function splitItems(val) {
  if (!val) return [];
  const rawList = Array.isArray(val) ? val : [String(val)];
  const items = [];
  for (const entry of rawList) {
    for (const part of String(entry).split(/[,;&]|\s+and\s+/i)) {
      const cleaned = part.trim();
      if (cleaned && !items.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) {
        items.push(cleaned);
      }
    }
  }
  return items;
}

function scoreDescriptionQuality(desc) {
  const cleaned = cleanDescription(String(desc || '')).trim();
  if (!cleaned || cleaned.length < 15) return -1;
  if (/^(no description|n\/a|tbd|coming soon)/i.test(cleaned)) return -1;
  return Math.min(cleaned.length, 1500);
}

/**
 * Deterministically merges the highest-quality field values across multiple staged candidates.
 *
 * @param {Object} options
 * @param {Array<Object>} options.allCandidates - Normalized candidate objects
 * @param {Object} [options.existingMeta] - Existing metadata on the comic
 * @param {Array<string>} [options.publisherCodex] - User's library publisher codex
 * @returns {Object} Normalized metadata dictionary
 */
function synthesizeMetadataDeterministic({
  allCandidates = [],
  existingMeta = {},
  publisherCodex = []
}) {
  const candidates = (allCandidates || []).map((c, idx) => {
    const meta = (c && typeof c.metadata === 'object' && c.metadata) ? c.metadata : (c || {});
    const src = c.source || meta.source || '';
    const isComicDb = isComicDbSource(src);
    return {
      raw: c || {},
      meta,
      source: src,
      isComicDb,
      priority: (isComicDb ? 100 : 0) - idx
    };
  });

  if (candidates.length === 0) {
    return normalizeGeminiMetadata({
      parsed: {},
      existingMeta,
      winningCandidate: {},
      publisherCodex
    });
  }

  // Prefer comic DB sources first while preserving staged order within tier
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);
  const primary = ordered[0];
  const merged = {};

  // 1. Series, Issue Number & Volume
  for (const c of ordered) {
    const s = cleanFormatAndEdition(c.meta.series || c.raw.series || '');
    if (s) {
      merged.Series = s;
      break;
    }
  }

  for (const c of ordered) {
    const num = c.meta.number || c.meta.issue || c.raw.issue || '';
    if (String(num).trim()) {
      merged.Number = String(num).trim();
      break;
    }
  }

  for (const c of ordered) {
    const vol = c.meta.volume || c.raw.volume || '';
    if (String(vol).trim()) {
      merged.Volume = String(vol).trim();
      break;
    }
  }

  // 2. Non-redundant Issue Title
  for (const c of ordered) {
    const t = cleanFormatAndEdition(c.meta.title || c.raw.title || '');
    if (t && !isTitleSameAsSeries(t, merged.Series || '')) {
      merged.Title = t;
      break;
    }
  }

  // 3. Best Description / Summary
  let bestDesc = '';
  let bestDescScore = -1;
  for (const c of ordered) {
    const d = c.meta.description || c.raw.description || '';
    const q = scoreDescriptionQuality(d);
    if (q > bestDescScore) {
      bestDescScore = q;
      bestDesc = cleanDescription(d);
    }
  }
  if (bestDesc) {
    merged.Summary = bestDesc;
  }

  // 4. Creators (case-insensitive union across all staged sources)
  const creatorMap = [
    ['Writer', 'writer'],
    ['Penciller', 'penciller'],
    ['Inker', 'inker'],
    ['Colorist', 'colorist'],
    ['Letterer', 'letterer'],
    ['CoverArtist', 'cover_artist'],
    ['Editor', 'editor']
  ];
  for (const [pascalKey, lowerKey] of creatorMap) {
    const names = [];
    for (const c of candidates) {
      const val = c.meta[lowerKey] || c.meta[pascalKey] || '';
      for (const person of splitItems(val)) {
        if (!names.some(existing => existing.toLowerCase() === person.toLowerCase())) {
          names.push(person);
        }
      }
    }
    if (names.length > 0) {
      merged[pascalKey] = names.join(', ');
    }
  }

  // 5. Publisher & Imprint
  for (const comicDbPass of [true, false]) {
    if (merged.Publisher) break;
    for (const c of ordered) {
      if (c.isComicDb !== comicDbPass) continue;
      const pub = normalizePublisher(c.meta.publisher || c.raw.publisher || '', publisherCodex);
      if (pub && !isForeignPublisher(pub, publisherCodex)) {
        merged.Publisher = pub;
        break;
      }
    }
  }
  for (const c of ordered) {
    if (c.meta.imprint) {
      merged.Imprint = String(c.meta.imprint).trim();
      break;
    }
  }

  // 6. Dates (prefer full YYYY-MM-DD, then YYYY-MM, then YYYY)
  for (const c of ordered) {
    const d = String(c.meta.cover_date || c.raw.cover_date || '').trim();
    const mFull = d.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
    if (mFull) {
      merged.Year = mFull[1];
      merged.Month = String(parseInt(mFull[2], 10));
      merged.Day = String(parseInt(mFull[3], 10));
      merged.CoverDate = `${mFull[1]}-${String(parseInt(mFull[2], 10)).padStart(2, '0')}-${String(parseInt(mFull[3], 10)).padStart(2, '0')}`;
      break;
    }
  }
  if (!merged.CoverDate) {
    for (const c of ordered) {
      const d = String(c.meta.cover_date || c.raw.cover_date || '').trim();
      const mYm = d.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])\b/);
      if (mYm) {
        merged.Year = mYm[1];
        merged.Month = String(parseInt(mYm[2], 10));
        merged.CoverDate = `${mYm[1]}-${String(parseInt(mYm[2], 10)).padStart(2, '0')}`;
        break;
      }
    }
  }

  // 7. Lore & Tags (Characters, Teams, Locations, Genre)
  for (const [pascalKey, lowerKey] of [['Characters', 'characters'], ['Teams', 'teams'], ['Locations', 'locations'], ['Genre', 'genre']]) {
    const items = [];
    for (const c of candidates) {
      for (const item of splitItems(c.meta[lowerKey] || c.meta[pascalKey] || '')) {
        if (pascalKey === 'Genre' && /^comics?$/i.test(item)) continue;
        if (!items.some(existing => existing.toLowerCase() === item.toLowerCase())) {
          items.push(item);
        }
      }
    }
    if (items.length > 0) {
      merged[pascalKey] = items.join(', ');
    }
  }

  // 8. StoryArc, StoryArcNumber, PageCount, AgeRating, Web
  for (const c of ordered) {
    if (!merged.StoryArc && c.meta.story_arc) merged.StoryArc = String(c.meta.story_arc).trim();
    if (!merged.StoryArcNumber && c.meta.story_arc_number) merged.StoryArcNumber = String(c.meta.story_arc_number).trim();
    if (!merged.PageCount && c.meta.page_count && /^\d+$/.test(String(c.meta.page_count).trim()) && Number(c.meta.page_count) > 0) {
      merged.PageCount = String(c.meta.page_count).trim();
    }
    if (!merged.AgeRating && c.meta.age_rating) merged.AgeRating = String(c.meta.age_rating).trim();
    if (!merged.Web && c.raw.matching_url) merged.Web = String(c.raw.matching_url).trim();
  }

  return normalizeGeminiMetadata({
    parsed: merged,
    existingMeta,
    winningCandidate: primary.raw,
    publisherCodex
  });
}

module.exports = {
  synthesizeMetadataDeterministic
};
