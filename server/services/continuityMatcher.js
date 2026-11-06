/**
 * Continuity Matcher Service
 *
 * Matches reading order sequences against user comics in library.
 * Computes narrative completeness, missing issue gaps, and ComicInfo metadata.
 */

function normalizeSeries(series) {
  if (!series) return '';
  return series
    .toLowerCase()
    .replace(/\s*\(\d{4}\)/g, '') // remove year e.g. (2006)
    .replace(/[^a-z0-9]/g, ' ')   // normalize punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIssueNum(num) {
  if (!num) return '';
  const str = String(num).trim();
  // Strip leading zeroes e.g. "01" -> "1", but preserve fractional "1.5" or spans "1-5"
  return str.replace(/^0+([1-9])/, '$1');
}

function parseComicMetadata(comic) {
  if (!comic) return {};
  if (typeof comic.metadata === 'object' && comic.metadata !== null) {
    return comic.metadata;
  }
  if (typeof comic.metadata === 'string') {
    try {
      return JSON.parse(comic.metadata);
    } catch {
      return {};
    }
  }
  return {};
}

function createContinuityMatcher({ readingOrdersDb, getComics }) {
  async function getLibraryMap() {
    const raw = typeof getComics === 'function' ? getComics() : [];
    const comics = Array.isArray(raw) ? raw : (await raw) || [];
    const map = new Map();

    for (const c of comics) {
      const meta = parseComicMetadata(c);
      const series = c.series || meta.Series || '';
      const num = meta.Number || c.name?.match(/#?(\d+)/)?.[1] || '';
      const normKey = `${normalizeSeries(series)}:::${normalizeIssueNum(num)}`;
      if (!map.has(normKey)) {
        map.set(normKey, c);
      }
    }
    return map;
  }

  async function getStoryArcsForPublisher(publisher) {
    const orders = readingOrdersDb.getReadingOrders({ publisher });
    const libMap = await getLibraryMap();

    return orders.map(order => {
      const issues = readingOrdersDb.getReadingOrderIssues(order.id);
      let ownedCount = 0;

      for (const iss of issues) {
        const key = `${normalizeSeries(iss.series_name)}:::${normalizeIssueNum(iss.issue_number)}`;
        if (libMap.has(key)) {
          ownedCount++;
        }
      }

      const totalIssues = issues.length || order.total_issues || 0;
      const missingCount = Math.max(0, totalIssues - ownedCount);
      const completenessPercent = totalIssues > 0 ? Math.round((ownedCount / totalIssues) * 100) : 0;

      return {
        id: order.id,
        title: order.title,
        publisher: order.publisher,
        description: order.description,
        coverImage: order.cover_image,
        totalIssues,
        totalCollections: order.total_collections,
        ownedCount,
        missingCount,
        completenessPercent
      };
    });
  }

  async function getStoryArcDetails(arcId) {
    const order = readingOrdersDb.getReadingOrderById(arcId);
    if (!order) return null;

    const rawIssues = readingOrdersDb.getReadingOrderIssues(arcId);
    const collections = readingOrdersDb.getReadingOrderCollections(arcId);
    const libMap = await getLibraryMap();

    const issues = rawIssues.map(iss => {
      const key = `${normalizeSeries(iss.series_name)}:::${normalizeIssueNum(iss.issue_number)}`;
      const ownedComic = libMap.get(key);
      return {
        id: iss.id,
        position: iss.position,
        seriesName: iss.series_name,
        issueNumber: iss.issue_number,
        importance: iss.importance,
        storyParts: iss.story_parts,
        publicationDate: iss.publication_date,
        coverImageUrl: iss.cover_image_url,
        isOwned: Boolean(ownedComic),
        comicId: ownedComic ? ownedComic.id : null
      };
    });

    return {
      id: order.id,
      title: order.title,
      publisher: order.publisher,
      description: order.description,
      coverImage: order.cover_image,
      issues,
      collections
    };
  }

  async function getComicContinuity(seriesName, issueNumber) {
    const arcData = readingOrdersDb.findArcForIssue(seriesName, issueNumber);
    if (!arcData) return null;

    const order = readingOrdersDb.getReadingOrderById(arcData.readingOrderId);
    const libMap = await getLibraryMap();

    function decorateIssue(iss) {
      if (!iss) return null;
      const key = `${normalizeSeries(iss.seriesName)}:::${normalizeIssueNum(iss.issueNumber)}`;
      const owned = libMap.get(key);
      return {
        ...iss,
        isOwned: Boolean(owned),
        comicId: owned ? owned.id : null
      };
    }

    return {
      arcId: arcData.readingOrderId,
      arcTitle: order?.title || arcData.readingOrderId,
      position: arcData.position,
      importance: arcData.importance,
      storyParts: arcData.storyParts,
      previousIssue: decorateIssue(arcData.previousIssue),
      nextIssue: decorateIssue(arcData.nextIssue)
    };
  }

  function getComicInfoMetadata(seriesName, issueNumber) {
    const arcData = readingOrdersDb.findArcForIssue(seriesName, issueNumber);
    if (!arcData) return null;

    const order = readingOrdersDb.getReadingOrderById(arcData.readingOrderId);
    const publisher = order?.publisher || '';
    const seriesGroup = publisher ? `${publisher} Events` : 'Comic Events';

    return {
      StoryArc: order?.title || arcData.readingOrderId,
      StoryArcNumber: String(arcData.position),
      SeriesGroup: seriesGroup
    };
  }

  return {
    getStoryArcsForPublisher,
    getStoryArcDetails,
    getComicContinuity,
    getComicInfoMetadata,
    normalizeSeries,
    normalizeIssueNum
  };
}

module.exports = {
  createContinuityMatcher,
  normalizeSeries,
  normalizeIssueNum
};
