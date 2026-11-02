/**
 * Comics Now! - Reading List DAG Layout & Math
 *
 * Topological layout algorithms, lane distribution, and coordinate positioning.
 */

import { getComicById } from '../globals.js';
import { dagState, getBaseUrl } from './state.js';

export const LANE_COLORS = [
  '#f59e0b', // amber (primary spine)
  '#3b82f6', // blue
  '#ec4899', // pink
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6'  // teal
];

/**
 * Fetch DAG data for a specific reading list from API with local fallback
 * @param {string} listId - Reading list ID
 * @param {Object} [cachedDetails] - Optional cached details object
 * @returns {Promise<Object>} DAG data
 */
export async function fetchReadingListDAG(listId, cachedDetails = null) {
  const baseUrl = getBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}/dag`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) return data;
    }
  } catch (err) {
    console.warn('[ReadingListDAG] Network fetch failed, falling back to local builder:', err);
  }

  // Fallback: build from details (offline or API error)
  if (cachedDetails && cachedDetails.items) {
    return buildDAGFromDetails(cachedDetails);
  }
  return null;
}

/**
 * Pure fallback to build DAG data structure from reading list detail record
 * @param {Object} details - Reading list details with list and items
 * @returns {Object} DAG data
 */
export function buildDAGFromDetails(details) {
  const list = details.list || {};
  const rawItems = details.items || [];
  const seriesCounts = new Map();

  const nodes = [];
  rawItems.forEach((item, index) => {
    let comic = typeof getComicById === 'function' ? getComicById(item.comicId) : null;
    let meta = {};
    if (comic && comic.metadata) {
      try { meta = typeof comic.metadata === 'string' ? JSON.parse(comic.metadata) : comic.metadata; } catch {}
    }

    const series = (comic && comic.series) || meta.Series || item.series || 'Single Issue';
    seriesCounts.set(series, (seriesCounts.get(series) || 0) + 1);

    const total = item.totalPages || (comic && comic.totalPages) || 0;
    const last = item.lastReadPage || (comic && comic.lastReadPage) || 0;
    const isComplete = total > 0 && last >= total - 1;
    const isInProgress = last > 0 && !isComplete;
    const readStatus = isComplete ? 'read' : isInProgress ? 'in-progress' : 'unread';
    const progressPercent = total > 0 ? Math.round((last / total) * 100) : (last > 0 ? 50 : 0);

    nodes.push({
      id: item.comicId,
      step: index + 1,
      sortOrder: item.sortOrder ?? index,
      name: (comic && comic.name) || meta.Title || series,
      series,
      number: meta.Number || meta.issue_number || '',
      publisher: (comic && comic.publisher) || meta.Publisher || '',
      thumbnailPath: (comic && comic.thumbnailPath) || item.thumbnailPath || '',
      summary: meta.Summary || meta.Description || '',
      year: meta.Year ? parseInt(meta.Year, 10) : null,
      totalPages: total,
      lastReadPage: last,
      readStatus,
      progressPercent
    });
  });

  const sortedSeries = Array.from(seriesCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

  const seriesLanes = sortedSeries.map((series, idx) => ({
    series,
    lane: idx,
    count: seriesCounts.get(series) || 0,
    color: LANE_COLORS[idx % LANE_COLORS.length]
  }));

  const seriesLaneMap = new Map(seriesLanes.map(l => [l.series, l.lane]));

  nodes.forEach(node => {
    node.lane = seriesLaneMap.get(node.series) ?? 0;
    node.isCore = node.lane === 0;
  });

  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `edge-step-${i}`,
      from: nodes[i].id,
      to: nodes[i + 1].id,
      type: 'reading-order'
    });
  }

  const seriesGroups = new Map();
  nodes.forEach(n => {
    if (!seriesGroups.has(n.series)) seriesGroups.set(n.series, []);
    seriesGroups.get(n.series).push(n);
  });

  seriesGroups.forEach((groupNodes, series) => {
    if (groupNodes.length > 1) {
      for (let i = 0; i < groupNodes.length - 1; i++) {
        const curr = groupNodes[i];
        const next = groupNodes[i + 1];
        if (next.step !== curr.step + 1) {
          edges.push({
            id: `edge-series-${curr.id}-${next.id}`,
            from: curr.id,
            to: next.id,
            type: 'series-track',
            series
          });
        }
      }
    }
  });

  return {
    ok: true,
    list: {
      id: list.id,
      name: list.name,
      description: list.description
    },
    totalIssues: nodes.length,
    readCount: nodes.filter(n => n.readStatus === 'read').length,
    inProgressCount: nodes.filter(n => n.readStatus === 'in-progress').length,
    nodes,
    edges,
    seriesLanes
  };
}

/**
 * Computes 2D layout coordinates for reading list DAG nodes
 * Linear flow along X (stepIndex * X_GAP), lanes distributed along Y.
 */
export function calculateReadingListDAGPositions(dagData) {
  if (!dagData || !dagData.nodes) return;
  const { nodes, seriesLanes } = dagData;
  const X_GAP = 280;
  const Y_OFFSET_STEP = 180;

  // Single series list: clean horizontal spine
  if (!seriesLanes || seriesLanes.length <= 1) {
    nodes.forEach((node, idx) => {
      node.x = idx * X_GAP;
      node.y = 0;
    });
    return;
  }

  // Multi-series lists: spine at Y=0, other lanes alternating above & below
  const laneYMap = new Map();
  seriesLanes.forEach((sl, idx) => {
    if (idx === 0) {
      laneYMap.set(sl.series, 0); // Primary spine
    } else {
      const isAbove = idx % 2 === 1;
      const tier = Math.ceil(idx / 2);
      laneYMap.set(sl.series, (isAbove ? -1 : 1) * tier * Y_OFFSET_STEP);
    }
  });

  nodes.forEach((node, idx) => {
    node.x = idx * X_GAP;
    node.y = laneYMap.get(node.series) ?? 0;
  });
}

/**
 * Center/fit DAG inside the viewport
 */
export function fitDAGToViewport(container, dagData, focusFirstUnread = false) {
  const viewport = container.querySelector('#rl-dag-viewport');
  if (!viewport || !dagData || !dagData.nodes || dagData.nodes.length === 0) return;

  const rect = viewport.getBoundingClientRect();
  const vWidth = rect.width || 800;
  const vHeight = rect.height || 500;

  if (focusFirstUnread) {
    // Find first unread or in-progress node
    const targetNode = dagData.nodes.find(n => n.readStatus !== 'read') || dagData.nodes[0];
    if (targetNode) {
      dagState.graphTransform.scale = 0.85;
      dagState.graphTransform.x = (vWidth / 2) - ((targetNode.x + 100) * dagState.graphTransform.scale);
      dagState.graphTransform.y = (vHeight / 2) - ((targetNode.y + 60) * dagState.graphTransform.scale);
      applyTransform(container);
      return;
    }
  }

  // Otherwise, default start: show beginning of reading list
  dagState.graphTransform.scale = 0.85;
  dagState.graphTransform.x = 60;
  dagState.graphTransform.y = Math.max(120, vHeight / 2 - 40);
  applyTransform(container);
}

export function applyTransform(container) {
  const stage = container.querySelector('#rl-dag-pan-zoom-container');
  if (stage) {
    stage.style.transform = `translate3d(${dagState.graphTransform.x}px, ${dagState.graphTransform.y}px, 0) scale(${dagState.graphTransform.scale})`;
  }
}
