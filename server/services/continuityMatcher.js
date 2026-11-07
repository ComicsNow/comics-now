/**
 * Continuity Matcher Service
 *
 * Matches reading order sequences against user comics in library.
 * Computes narrative completeness, missing issue gaps, and ComicInfo metadata.
 */

function normalizeSeries(series) {
  if (!series) return '';
  let str = String(series).trim();
  str = str.replace(/[’‘]/g, "'");
  str = str.replace(/\s*\(\d{4}\)/g, '');
  str = str.replace(/^(?:dc\s*k\.?o\.?|civil\s*war|blackest\s*night)\s*[:\-–—]?\s*/i, '');
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIssueInRange(comicNum, arcNumStr) {
  if (comicNum === null || comicNum === undefined || arcNumStr === null || arcNumStr === undefined) return false;
  const cMatches = String(comicNum).trim().match(/\d+(?:\.\d+)?/);
  if (!cMatches) return false;
  const cVal = parseFloat(cMatches[0]);
  if (isNaN(cVal)) return false;

  const arcStr = String(arcNumStr).trim();
  if (arcStr.includes('-')) {
    const parts = arcStr.split('-');
    const lowMatch = parts[0].match(/\d+(?:\.\d+)?/);
    const highMatch = parts[1].match(/\d+(?:\.\d+)?/);
    if (lowMatch && highMatch) {
      const low = parseFloat(lowMatch[0]);
      const high = parseFloat(highMatch[0]);
      if (!isNaN(low) && !isNaN(high)) {
        return cVal >= low && cVal <= high;
      }
    }
  }

  const aMatches = arcStr.match(/\d+(?:\.\d+)?/);
  if (!aMatches) return false;
  const aVal = parseFloat(aMatches[0]);
  return !isNaN(aVal) && cVal === aVal;
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
    const seriesMap = new Map();

    for (const c of comics) {
      const meta = parseComicMetadata(c);
      const series = c.series || meta.Series || '';
      const num = meta.Number || c.name?.match(/#?(\d+)/)?.[1] || '';
      const normS = normalizeSeries(series);
      const normN = normalizeIssueNum(num);
      const normKey = `${normS}:::${normN}`;
      if (!map.has(normKey)) {
        map.set(normKey, c);
      }
      if (!seriesMap.has(normS)) {
        seriesMap.set(normS, []);
      }
      seriesMap.get(normS).push({ ...c, issueNum: num });
    }
    return { map, seriesMap };
  }

  function findOwnedComic(iss, libData) {
    if (!iss || !libData) return null;
    const sName = iss.series_name || iss.seriesName || '';
    const iNum = iss.issue_number || iss.issueNumber || '';
    const normS = normalizeSeries(sName);
    const directKey = `${normS}:::${normalizeIssueNum(iNum)}`;
    if (libData.map && libData.map.has(directKey)) {
      return libData.map.get(directKey);
    }
    if (libData.seriesMap) {
      const seriesList = libData.seriesMap.get(normS);
      if (seriesList && seriesList.length > 0) {
        return seriesList.find(c => isIssueInRange(c.issueNum, iNum)) || null;
      }
    }
    return null;
  }

  async function getStoryArcsForPublisher(publisher) {
    const orders = readingOrdersDb.getReadingOrders({ publisher });
    const libData = await getLibraryMap();

    return orders.map(order => {
      const issues = readingOrdersDb.getReadingOrderIssues(order.id);
      let ownedCount = 0;

      for (const iss of issues) {
        if (findOwnedComic(iss, libData)) {
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
    const libData = await getLibraryMap();

    const issues = rawIssues.map(iss => {
      const ownedComic = findOwnedComic(iss, libData);
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
    const libData = await getLibraryMap();

    function decorateIssue(iss) {
      if (!iss) return null;
      const owned = findOwnedComic(iss, libData);
      return {
        ...iss,
        isOwned: Boolean(owned),
        comicId: owned ? owned.id : null
      };
    }

    const cleanTitle = (order?.title || arcData.readingOrderId).replace(/\s+Reading\s+Order$/i, '').trim();

    return {
      arcId: arcData.readingOrderId,
      arcTitle: cleanTitle,
      position: arcData.position,
      importance: arcData.importance,
      storyParts: arcData.storyParts,
      previousIssue: decorateIssue(arcData.previousIssue),
      nextIssue: decorateIssue(arcData.nextIssue)
    };
  }

  function getComicInfoMetadata(seriesName, issueNumber, comic = null) {
    let arcData = null;
    if (comic && typeof readingOrdersDb.findArcForCollection === 'function') {
      arcData = readingOrdersDb.findArcForCollection(comic);
    }
    if (!arcData) {
      arcData = readingOrdersDb.findArcForIssue(seriesName, issueNumber);
    }
    if (!arcData && typeof readingOrdersDb.findArcForCollection === 'function') {
      arcData = readingOrdersDb.findArcForCollection({ series: seriesName, name: `${seriesName} #${issueNumber}` });
    }
    if (!arcData) return null;

    const order = readingOrdersDb.getReadingOrderById(arcData.readingOrderId);
    const publisher = order?.publisher || '';
    const seriesGroup = publisher ? `${publisher} Events` : 'Comic Events';
    const cleanArcTitle = (order?.title || arcData.readingOrderId).replace(/\s+Reading\s+Order$/i, '').trim();

    return {
      StoryArc: cleanArcTitle,
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
    normalizeIssueNum,
    isIssueInRange
  };
}

module.exports = {
  createContinuityMatcher,
  normalizeSeries,
  normalizeIssueNum,
  isIssueInRange
};
