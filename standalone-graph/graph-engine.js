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
          comics: new Set()
        });
      }
      const node = nodeMap.get(ent);
      node.appearances += 1;
      node.series.add(seriesName);
      node.publishers.add(publisherName);
      node.comics.add(comicId);
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
            comics: new Set()
          });
        }
        const pair = pairMap.get(pairKey);
        pair.weight += 1;
        pair.comics.add(comicId);
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

  // Build formatted node list
  const nodes = validNodes.map(n => ({
    id: n.id,
    label: n.id,
    appearances: n.appearances,
    seriesCount: n.series.size,
    series: Array.from(n.series),
    publishers: Array.from(n.publishers),
    comicCount: n.comics.size
  }));

  // Build links between valid nodes
  const links = [];
  for (const pair of pairMap.values()) {
    if (validNodeIds.has(pair.source) && validNodeIds.has(pair.target)) {
      if (pair.weight >= minWeight) {
        links.push({
          source: pair.source,
          target: pair.target,
          weight: pair.weight,
          comics: Array.from(pair.comics)
        });
      }
    }
  }

  return {
    nodes,
    links,
    meta: {
      totalEntitiesFound: nodeMap.size,
      returnedNodes: nodes.length,
      returnedLinks: links.length,
      entityType,
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
