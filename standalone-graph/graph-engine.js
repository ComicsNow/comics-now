/**
 * Graph Engine for Comic Character & Event Co-Occurrence
 */

/**
 * Parses comma-separated or list-like metadata fields safely into trimmed, deduplicated arrays.
 * @param {string|string[]} val
 * @returns {string[]}
 */
function parseListField(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return Array.from(new Set(val.map(s => String(s).trim()).filter(Boolean)));
  }
  if (typeof val !== 'string') return [];
  const parts = val.split(',').map(s => s.trim()).filter(Boolean);
  return Array.from(new Set(parts));
}

/**
 * Builds a co-occurrence graph (nodes and links) from comic records.
 *
 * @param {Array<Object>} comics - List of comic objects with metadata
 * @param {Object} options
 * @param {'characters'|'teams'|'locations'|'creators'} [options.entityType='characters']
 * @param {string} [options.publisher] - Optional publisher filter
 * @param {string} [options.series] - Optional series filter
 * @param {number} [options.minAppearances=1] - Minimum appearances to include node
 * @param {number} [options.minWeight=1] - Minimum co-occurrences to include link
 * @param {number} [options.maxNodes=250] - Cap on total nodes returned
 * @returns {{ nodes: Array<Object>, links: Array<Object>, meta: Object }}
 */
function buildCoOccurrenceGraph(comics, options = {}) {
  const entityType = options.entityType || 'characters';
  const publisherFilter = options.publisher ? options.publisher.trim().toLowerCase() : null;
  const seriesFilter = options.series ? options.series.trim().toLowerCase() : null;
  const minAppearances = typeof options.minAppearances === 'number' ? options.minAppearances : 1;
  const minWeight = typeof options.minWeight === 'number' ? options.minWeight : 1;
  const maxNodes = typeof options.maxNodes === 'number' ? options.maxNodes : 250;
  const maxLinks = typeof options.maxLinks === 'number' ? options.maxLinks : null;
  const includeComicIds = options.includeComicIds !== false;

  const nodeMap = new Map(); // entityName -> { appearances, series: Set, publishers: Set, comics: Set }
  const pairMap = new Map(); // key 'A|B' (sorted) -> { weight, comics: Set }

  for (const comic of comics) {
    if (!comic) continue;

    // Apply publisher filter
    if (publisherFilter && (comic.publisher || '').toLowerCase() !== publisherFilter) {
      continue;
    }
    // Apply series filter
    if (seriesFilter && (comic.series || '').toLowerCase() !== seriesFilter) {
      continue;
    }

    let meta = {};
    if (comic.metadata) {
      if (typeof comic.metadata === 'object') {
        meta = comic.metadata;
      } else if (typeof comic.metadata === 'string') {
        try {
          meta = JSON.parse(comic.metadata);
        } catch (_) {
          meta = {};
        }
      }
    }

    let rawList = null;
    if (entityType === 'characters') {
      rawList = meta.Characters || meta.characters;
    } else if (entityType === 'teams') {
      rawList = meta.Teams || meta.teams;
    } else if (entityType === 'locations') {
      rawList = meta.Locations || meta.locations;
    } else if (entityType === 'creators') {
      const writers = parseListField(meta.Writer || meta.writer);
      const pencillers = parseListField(meta.Penciller || meta.penciller);
      const artists = parseListField(meta.CoverArtist || meta.coverArtist);
      rawList = [...writers, ...pencillers, ...artists];
    }

    const entities = parseListField(rawList);
    if (entities.length === 0) continue;

    // Extract publication year
    let year = null;
    if (meta.Year) {
      const y = parseInt(meta.Year, 10);
      if (!isNaN(y) && y >= 1900 && y <= 2100) year = y;
    } else if (meta['Cover Date'] || meta.cover_date) {
      const cd = String(meta['Cover Date'] || meta.cover_date);
      const match = cd.match(/\b(19\d{2}|20\d{2})\b/);
      if (match) year = parseInt(match[1], 10);
    }

    const comicId = comic.id;
    const seriesName = comic.series || meta.Series || 'Unknown Series';
    const publisherName = comic.publisher || meta.Publisher || 'Unknown Publisher';

    // Track node appearances
    for (const ent of entities) {
      if (!nodeMap.has(ent)) {
        nodeMap.set(ent, {
          id: ent,
          appearances: 0,
          series: new Set(),
          publishers: new Set(),
          comics: new Set(),
          years: new Set(),
          appearancesByYear: {}
        });
      }
      const node = nodeMap.get(ent);
      node.appearances += 1;
      node.series.add(seriesName);
      node.publishers.add(publisherName);
      node.comics.add(comicId);
      if (year) {
        node.years.add(year);
        node.appearancesByYear[year] = (node.appearancesByYear[year] || 0) + 1;
      }
    }

    // Track pairs (co-occurrences)
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const entA = entities[i];
        const entB = entities[j];
        const pairKey = entA < entB ? `${entA}|||${entB}` : `${entB}|||${entA}`;

        if (!pairMap.has(pairKey)) {
          pairMap.set(pairKey, {
            source: entA < entB ? entA : entB,
            target: entA < entB ? entB : entA,
            weight: 0,
            comics: new Set(),
            years: new Set(),
            publishers: new Set()
          });
        }
        const pair = pairMap.get(pairKey);
        pair.weight += 1;
        pair.comics.add(comicId);
        if (year) pair.years.add(year);
        if (publisherName) pair.publishers.add(publisherName);
      }
    }
  }

  // Filter nodes by minAppearances and sort descending by appearances
  let validNodes = Array.from(nodeMap.values())
    .filter(n => n.appearances >= minAppearances)
    .sort((a, b) => b.appearances - a.appearances);

  // Cap to maxNodes
  if (validNodes.length > maxNodes) {
    validNodes = validNodes.slice(0, maxNodes);
  }

  const validNodeIds = new Set(validNodes.map(n => n.id));

  // Build formatted node list with chronology & continuity friction metrics
  const nodes = validNodes.map(n => {
    const yearsArr = Array.from(n.years).sort((a, b) => a - b);
    const firstYear = yearsArr.length > 0 ? yearsArr[0] : null;
    const lastYear = yearsArr.length > 0 ? yearsArr[yearsArr.length - 1] : null;
    const publishersArr = Array.from(n.publishers);
    const seriesArr = Array.from(n.series);

    // Calculate Continuity Friction
    let score = 0;
    const reasons = [];

    if (publishersArr.length > 1) {
      score += Math.min(50, publishersArr.length * 25);
      reasons.push(`Crosses ${publishersArr.length} publishers: ${publishersArr.join(', ')}`);
    }

    if (seriesArr.length >= 3) {
      const seriesRatio = (seriesArr.length / Math.max(1, n.appearances));
      const seriesBonus = Math.min(35, Math.round(seriesRatio * 30 + seriesArr.length * 2));
      score += seriesBonus;
      reasons.push(`Spans ${seriesArr.length} distinct series`);
    }

    if (firstYear && lastYear && (lastYear - firstYear >= 10)) {
      const span = lastYear - firstYear;
      score += Math.min(25, Math.round(span / 1.5));
      reasons.push(`Timeline span of ${span} years (${firstYear}–${lastYear})`);
    }

    const frictionScore = Math.min(100, Math.max(10, Math.round(score)));
    let frictionLevel = 'Canon Anchor';
    if (frictionScore >= 70) {
      frictionLevel = 'Multiverse Nexus';
    } else if (frictionScore >= 40) {
      frictionLevel = 'Cross-Series Bridge';
    }

    return {
      id: n.id,
      label: n.id,
      appearances: n.appearances,
      seriesCount: n.series.size,
      series: seriesArr,
      publishers: publishersArr,
      comicCount: n.comics.size,
      firstYear,
      lastYear,
      years: yearsArr,
      appearancesByYear: n.appearancesByYear,
      frictionScore,
      frictionLevel,
      frictionReasons: reasons
    };
  });

  // Collect global year bounds
  const allYears = [];
  for (const n of nodes) {
    if (n.years && n.years.length > 0) {
      allYears.push(...n.years);
    }
  }
  const minYear = allYears.length > 0 ? Math.min(...allYears) : 1970;
  const maxYear = allYears.length > 0 ? Math.max(...allYears) : 2026;

  // Build links between valid nodes with friction attributes
  let links = [];
  for (const pair of pairMap.values()) {
    if (validNodeIds.has(pair.source) && validNodeIds.has(pair.target)) {
      if (pair.weight >= minWeight) {
        const linkYears = Array.from(pair.years).sort((a, b) => a - b);
        const srcNode = nodeMap.get(pair.source);
        const tgtNode = nodeMap.get(pair.target);
        const srcPubs = srcNode ? Array.from(srcNode.publishers) : [];
        const tgtPubs = tgtNode ? Array.from(tgtNode.publishers) : [];

        const hasCommonPub = srcPubs.some(p => tgtPubs.includes(p));
        const isCrossPublisher = (srcPubs.length > 0 && tgtPubs.length > 0 && (srcPubs[0] !== tgtPubs[0] || !hasCommonPub || srcPubs.length > 1 || tgtPubs.length > 1)) || (pair.publishers.size > 1);
        const isCrossSeries = (srcNode && tgtNode && (srcNode.series.size > 1 || tgtNode.series.size > 1));
        const friction = isCrossPublisher || (linkYears.length > 1 && (linkYears[linkYears.length - 1] - linkYears[0] >= 15));

        const linkObj = {
          source: pair.source,
          target: pair.target,
          weight: pair.weight,
          comicCount: pair.comics.size,
          firstYear: linkYears.length > 0 ? linkYears[0] : null,
          lastYear: linkYears.length > 0 ? linkYears[linkYears.length - 1] : null,
          years: linkYears,
          isCrossPublisher,
          isCrossSeries,
          friction
        };

        if (includeComicIds) {
          linkObj.comics = Array.from(pair.comics);
        }

        links.push(linkObj);
      }
    }
  }

  // Adaptive link pruning: prioritize cross-publisher/continuity friction bridges, then heaviest co-occurrences
  if (maxLinks && links.length > maxLinks) {
    links.sort((a, b) => {
      if (a.friction !== b.friction) return b.friction ? 1 : -1;
      return b.weight - a.weight;
    });
    links = links.slice(0, maxLinks);
  }

  return {
    nodes,
    links,
    meta: {
      totalEntitiesFound: nodeMap.size,
      returnedNodes: nodes.length,
      returnedLinks: links.length,
      entityType,
      yearRange: {
        min: minYear,
        max: maxYear
      },
      filter: {
        publisher: publisherFilter,
        series: seriesFilter,
        minAppearances,
        minWeight
      }
    }
  };
}

module.exports = {
  parseListField,
  buildCoOccurrenceGraph
};
