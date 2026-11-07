/**
 * ReadingOrders.com HTML Parser Service
 *
 * Extracts structured reading orders, single issues, and collected edition metadata.
 */
const cheerio = require('cheerio');

const BASE_URL = 'https://readingorders.com';

/**
 * Parses series name and issue number from an issue title string.
 * e.g., "Civil War: Front Line #5" -> { seriesName: "Civil War: Front Line", issueNumber: "5" }
 * e.g., "Black Panther #19-20" -> { seriesName: "Black Panther", issueNumber: "19-20" }
 */
function parseIssueTitleAndNumber(rawTitle) {
  if (!rawTitle) return { seriesName: '', issueNumber: '' };
  const str = rawTitle.trim();
  const hashIdx = str.lastIndexOf('#');
  if (hashIdx === -1) {
    return { seriesName: str, issueNumber: '' };
  }
  const seriesName = str.substring(0, hashIdx).trim();
  const issueNumber = str.substring(hashIdx + 1).trim();
  return { seriesName, issueNumber };
}

/**
 * Parses semicolon-separated contents list in collected editions.
 * e.g., "Civil War Files (2006) #1; Penance: Relentless (2007) #1-5"
 */
function parseCollectedContents(rawContents) {
  if (!rawContents) return [];
  const parts = rawContents.split(';').map(p => p.trim()).filter(Boolean);
  const results = [];

  for (const part of parts) {
    const hashIdx = part.lastIndexOf('#');
    if (hashIdx !== -1) {
      results.push({
        seriesName: part.substring(0, hashIdx).trim(),
        issueRange: part.substring(hashIdx + 1).trim()
      });
    } else {
      results.push({
        seriesName: part,
        issueRange: ''
      });
    }
  }
  return results;
}

function detectPublisher($, title = '', slug = '', issues = []) {
  const dcLinks = $('a[href*="/timeline/dc"], a[href*="dc.com"], a[href*="all-in"]');
  const marvelLinks = $('a[href*="/timeline/marvel"], a[href*="marvel.com"]');
  if (dcLinks.length > 0) return 'DC Comics';
  if (marvelLinks.length > 0) return 'Marvel Comics';

  let hasDcText = false;
  let hasMarvelText = false;
  $('a, span.badge, div').slice(0, 40).each((_, el) => {
    const t = $(el).text().trim();
    if (t === 'DC' || t === 'DC Comics' || t === 'DC Comics Events timeline') hasDcText = true;
    if (t === 'Marvel' || t === 'Marvel Comics' || t === 'Marvel Comics Events timeline') hasMarvelText = true;
  });
  if (hasDcText && !hasMarvelText) return 'DC Comics';
  if (hasMarvelText && !hasDcText) return 'Marvel Comics';

  const lowerSlug = String(slug || '').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();
  if (/^(dc-|batman|superman|crisis|flash|green-lantern|justice-league|dark-nights|all-in|dc\b)/.test(lowerSlug) ||
      /\b(dc|batman|superman|justice league|darkseid|flashpoint|all in)\b/i.test(lowerTitle)) {
    return 'DC Comics';
  }
  if (/^(marvel|spider-man|x-men|avengers|secret-wars|civil-war|hulk|thor|iron-man)/.test(lowerSlug) ||
      /\b(marvel|spider-man|avengers|x-men|secret wars|civil war)\b/i.test(lowerTitle)) {
    return 'Marvel Comics';
  }

  // Check issue series
  let dcCount = 0;
  let marvelCount = 0;
  const dcKeywords = /\b(batman|superman|action comics|detective comics|wonder woman|flash|green lantern|justice league|dc |titans|nightwing|darkseid)\b/i;
  const marvelKeywords = /\b(spider-man|avengers|x-men|iron man|captain america|thor|hulk|wolverine|fantastic four|daredevil|deadpool)\b/i;

  for (const iss of issues.slice(0, 15)) {
    const name = iss.seriesName || '';
    if (dcKeywords.test(name)) dcCount++;
    if (marvelKeywords.test(name)) marvelCount++;
  }
  if (dcCount > marvelCount) return 'DC Comics';
  if (marvelCount > dcCount) return 'Marvel Comics';

  return 'Other';
}

/**
 * Parses reading order single-issues HTML page.
 */
function parseReadingOrderPage(html, slug) {
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || slug;
  const description = $('p.description, meta[name="description"]').first().text() ||
                      $('meta[name="description"]').attr('content') || '';

  const issues = [];

  // Each issue card on readingorders.com
  $('div.rounded-xl.border, div.rounded-lg.border').each((_, card) => {
    const $card = $(card);
    const heading = $card.find('h3').first().text().trim();
    if (!heading) return;

    const { seriesName, issueNumber } = parseIssueTitleAndNumber(heading);

    // Position index, importance, and date
    let position = null;
    let importance = 'Regular';
    let publicationDate = '';

    $card.find('span.text-xs').each((__, span) => {
      const text = $(span).text().trim();
      if (!text) return;
      if (/^\d+$/.test(text) && position === null) {
        position = parseInt(text, 10);
      } else if (/^(essential|recommended|core|tie-in)$/i.test(text)) {
        importance = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
      } else if (/[A-Z][a-z]{2}\s+\d{4}/.test(text)) {
        publicationDate = text;
      }
    });

    // Sub-parts / Storyline arcs
    const storyParts = $card.find('div.text-muted-foreground.text-sm, div.leading-tight.text-sm')
      .first().text().trim();

    // Collected in reference
    let collectedIn = '';
    const collectedText = $card.text();
    const collectedMatch = collectedText.match(/collected in:\s*([^B\n]+)/i);
    if (collectedMatch) {
      collectedIn = collectedMatch[1].replace(/Buy on:.*/i, '').trim();
    }

    // Cover image
    let coverImageUrl = $card.find('img').first().attr('src') || '';
    if (coverImageUrl && coverImageUrl.startsWith('/')) {
      coverImageUrl = `${BASE_URL}${coverImageUrl}`;
    }

    issues.push({
      position: position || (issues.length + 1),
      seriesName,
      issueNumber,
      importance,
      publicationDate,
      storyParts,
      collectedIn,
      coverImageUrl
    });
  });

  const publisher = detectPublisher($, title, slug, issues);

  return {
    slug,
    title,
    publisher,
    description,
    issues
  };
}

/**
 * Parses collected editions (/collected-editions) HTML page.
 */
function parseCollectedEditionsPage(html, slug) {
  const $ = cheerio.load(html);
  const collections = [];

  $('div.border.bg-card, div.border.rounded-lg').each((_, card) => {
    const $card = $(card);
    const title = $card.find('h3').first().text().trim();
    if (!title) return;

    const subtitle = $card.find('p.text-xl, p.text-2xl, p.text-muted-foreground').first().text().trim();

    let pageCount = 0;
    let releaseYear = 0;

    $card.find('div, span, p').each((__, el) => {
      const text = $(el).text().trim();
      const pageMatch = text.match(/^(\d+)\s*pages?$/i) || text.match(/(\d+)\s*pages?/i);
      if (pageMatch && !pageCount) {
        pageCount = parseInt(pageMatch[1], 10);
      }
      const yearMatch = text.match(/^(19\d\d|20\d\d)$/);
      if (yearMatch && !releaseYear) {
        releaseYear = parseInt(yearMatch[1], 10);
      }
    });

    const description = $card.find('p.text-sm').not(':contains("Contents:")').first().text().trim();

    let contentsRaw = '';
    $card.find('h4:contains("Contents:"), div:contains("Contents:")').each((__, h) => {
      const sibling = $(h).next('p');
      if (sibling.length) {
        contentsRaw = sibling.text().trim();
      }
    });

    let coverImageUrl = $card.find('img').first().attr('src') || '';
    if (coverImageUrl && coverImageUrl.startsWith('/')) {
      coverImageUrl = `${BASE_URL}${coverImageUrl}`;
    }

    collections.push({
      position: collections.length + 1,
      title,
      subtitle,
      pageCount,
      releaseYear,
      description,
      contentsRaw,
      parsedContents: parseCollectedContents(contentsRaw),
      coverImageUrl
    });
  });

  return {
    slug,
    collections
  };
}

module.exports = {
  detectPublisher,
  parseIssueTitleAndNumber,
  parseCollectedContents,
  parseReadingOrderPage,
  parseCollectedEditionsPage
};
