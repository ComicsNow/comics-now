/**
 * Comics Now! - Reading List Continuity & Narrative DAG View
 *
 * Implements an interactive Directed Acyclic Graph (DAG) visualization for curated
 * reading lists, showing the multi-series reading order flow, series continuity tracks,
 * reading progress, and instant issue launch.
 */

import { state, escapeHtml, getComicById } from './globals.js';

let currentDAGData = null;
let graphTransform = { x: 60, y: 220, scale: 0.85 };
let isDraggingGraph = false;
let dragStart = { x: 0, y: 0 };
let activeFilterMode = 'all'; // 'all' | 'unread' | 'read'
let searchQuery = '';
let activeSelectedNodeId = null;
let activeSeriesFilter = null;
let activeContextList = null;

function getBaseUrl() {
  if (state.API_BASE_URL) return state.API_BASE_URL.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.API_BASE_URL) return window.API_BASE_URL.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.baseUrl) {
    return window.APP_CONFIG.baseUrl.replace(/\/$/, '');
  }
  const baseTag = document.querySelector('base');
  if (baseTag && baseTag.href) {
    try {
      const url = new URL(baseTag.href, window.location.origin);
      return url.pathname.replace(/\/$/, '');
    } catch (e) {}
  }
  return '';
}

const LANE_COLORS = [
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
      graphTransform.scale = 0.85;
      graphTransform.x = (vWidth / 2) - ((targetNode.x + 100) * graphTransform.scale);
      graphTransform.y = (vHeight / 2) - ((targetNode.y + 60) * graphTransform.scale);
      applyTransform(container);
      return;
    }
  }

  // Otherwise, default start: show beginning of reading list
  graphTransform.scale = 0.85;
  graphTransform.x = 60;
  graphTransform.y = Math.max(120, vHeight / 2 - 40);
  applyTransform(container);
}

function applyTransform(container) {
  const stage = container.querySelector('#rl-dag-pan-zoom-container');
  if (stage) {
    stage.style.transform = `translate3d(${graphTransform.x}px, ${graphTransform.y}px, 0) scale(${graphTransform.scale})`;
  }
}

/**
 * Main render function for the Reading List DAG
 * @param {HTMLElement} mountContainer - The parent element to mount the DAG in
 * @param {Object} dagData - The DAG data
 * @param {Object} options - Options including listId, listName, onComicSelect
 */
export function renderReadingListDAG(mountContainer, dagData, options = {}) {
  if (!mountContainer) return;
  currentDAGData = dagData;
  activeContextList = { id: options.listId, name: options.listName };
  activeSelectedNodeId = null;
  activeFilterMode = 'all';
  searchQuery = '';
  activeSeriesFilter = null;

  if (!dagData || !dagData.nodes || dagData.nodes.length === 0) {
    mountContainer.innerHTML = `
      <div class="py-16 text-center text-gray-400 bg-gray-900/40 rounded-2xl border border-gray-800 p-8 max-w-md mx-auto my-8">
        <span class="text-4xl mb-3 inline-block">📚</span>
        <h3 class="text-lg font-bold text-white mb-1">No Comics in this List</h3>
        <p class="text-xs text-gray-400">Add comics to this reading list to explore its interactive continuity graph.</p>
      </div>
    `;
    return;
  }

  calculateReadingListDAGPositions(dagData);

  const percent = dagData.totalIssues > 0 ? Math.round((dagData.readCount / dagData.totalIssues) * 100) : 0;
  const seriesColorMap = new Map((dagData.seriesLanes || []).map(sl => [sl.series, sl.color]));

  mountContainer.innerHTML = `
    <div class="rl-dag-wrapper flex flex-col h-[76vh] sm:h-[82vh] min-h-[500px] bg-gray-950 rounded-2xl border border-gray-800/80 overflow-hidden relative shadow-2xl select-none">
      <!-- DAG Toolbar -->
      <div class="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-900/90 border-b border-gray-800 backdrop-blur-md z-20">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs px-2.5 py-1 bg-purple-950/70 border border-purple-500/40 text-purple-300 rounded-full font-semibold flex items-center gap-1.5">
              <span>🔀</span>
              <span>Continuity DAG</span>
            </span>
            <span class="text-xs text-gray-400 font-medium hidden sm:inline">
              ${dagData.totalIssues} issues • ${dagData.readCount} read (${percent}%)
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <!-- Live Search -->
          <div class="relative">
            <input type="text" id="rl-dag-search" placeholder="Filter issues..." class="bg-gray-800 text-white text-xs px-3 py-1.5 pl-8 rounded-lg border border-gray-700 focus:outline-hidden focus:border-purple-500 w-32 sm:w-44 transition-all">
            <svg class="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>

          <!-- Filter Pills -->
          <div class="flex items-center bg-gray-800 rounded-lg p-0.5 border border-gray-700 text-xs">
            <button class="rl-dag-filter-btn px-2.5 py-1 rounded bg-purple-600 text-white font-medium transition-colors" data-filter="all">All</button>
            <button class="rl-dag-filter-btn px-2.5 py-1 rounded bg-gray-700 text-gray-300 font-medium hover:text-white transition-colors" data-filter="unread">Unread</button>
            <button class="rl-dag-filter-btn px-2.5 py-1 rounded bg-gray-700 text-gray-300 font-medium hover:text-white transition-colors" data-filter="read">Read</button>
          </div>

          <!-- Center on Next Unread -->
          <button id="rl-dag-focus-unread-btn" class="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-purple-300 transition-colors text-xs flex items-center gap-1 border border-gray-700" title="Center on next unread issue">
            <span>🎯</span>
            <span class="hidden md:inline text-[11px]">Next Unread</span>
          </button>

          <!-- Reset / Fit Viewport -->
          <button id="rl-dag-reset-btn" class="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors text-xs flex items-center gap-1 border border-gray-700" title="Reset view">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          </button>
        </div>
      </div>

      <!-- Series Lanes Legend Bar -->
      ${(dagData.seriesLanes && dagData.seriesLanes.length > 1) ? `
        <div class="px-3 py-1.5 bg-gray-900/60 border-b border-gray-800/80 flex items-center gap-2 overflow-x-auto text-xs z-10 scrollbar-none">
          <span class="text-[10px] uppercase font-bold tracking-wider text-gray-500 shrink-0">Series:</span>
          ${dagData.seriesLanes.map(sl => `
            <button class="rl-series-legend-chip px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 transition-all border flex items-center gap-1.5"
                    style="border-color: ${sl.color}40; background-color: ${sl.color}15; color: ${sl.color};"
                    data-series="${escapeHtml(sl.series)}">
              <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${sl.color};"></span>
              <span class="truncate max-w-[140px]">${escapeHtml(sl.series)}</span>
              <span class="text-[10px] opacity-70">(${sl.count})</span>
            </button>
          `).join('')}
        </div>
      ` : ''}

      <!-- Interactive Canvas Area -->
      <div id="rl-dag-viewport" class="flex-1 w-full h-full overflow-hidden relative cursor-grab bg-[radial-gradient(#374151_1px,transparent_1px)] [background-size:24px_24px]">
        <div id="rl-dag-pan-zoom-container" class="absolute inset-0 origin-top-left will-change-transform">
          <!-- SVG Connections Layer -->
          <svg id="rl-dag-svg-layer" class="absolute overflow-visible w-full h-full pointer-events-none z-0"></svg>
          <!-- HTML Nodes Layer -->
          <div id="rl-dag-nodes-layer" class="absolute inset-0 z-10 pointer-events-auto"></div>
        </div>
      </div>

      <!-- Node Inspector Bottom Drawer -->
      <div id="rl-dag-inspector" class="hidden absolute bottom-0 left-0 right-0 z-30 transition-all"></div>
    </div>
  `;

  fitDAGToViewport(mountContainer, dagData, false);
  renderVisuals(mountContainer);
  bindInteractions(mountContainer);
}

/**
 * Renders SVG curves and HTML node cards based on current filter & search
 */
function renderVisuals(container) {
  if (!currentDAGData) return;
  const { nodes, edges, seriesLanes } = currentDAGData;
  const svg = container.querySelector('#rl-dag-svg-layer');
  const nodesContainer = container.querySelector('#rl-dag-nodes-layer');
  if (!svg || !nodesContainer) return;

  const baseUrl = getBaseUrl();
  const seriesColorMap = new Map((seriesLanes || []).map(sl => [sl.series, sl.color]));

  // Filter nodes
  const visibleNodes = nodes.filter(node => {
    if (activeFilterMode === 'read' && node.readStatus !== 'read') return false;
    if (activeFilterMode === 'unread' && node.readStatus === 'read') return false;
    if (activeSeriesFilter && node.series !== activeSeriesFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match = (node.name || '').toLowerCase().includes(q) ||
                    (node.series || '').toLowerCase().includes(q) ||
                    (node.number || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));

  // Render SVG Edges
  let edgeHtml = '';
  edges.forEach(edge => {
    const fromNode = nodes.find(n => n.id === edge.from);
    const toNode = nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) return;

    const isVisible = visibleNodeIds.has(fromNode.id) && visibleNodeIds.has(toNode.id);
    const isHighlight = activeSelectedNodeId && (activeSelectedNodeId === fromNode.id || activeSelectedNodeId === toNode.id);

    const startX = fromNode.x + 200;
    const startY = fromNode.y + 64;
    const endX = toNode.x - 6;
    const endY = toNode.y + 64;
    const dx = Math.max(50, (endX - startX) / 2);

    const pathData = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
    
    const edgeColor = isHighlight ? '#38bdf8' : (edge.type === 'reading-order' ? '#a855f7' : (seriesColorMap.get(edge.series) || '#6b7280'));
    const strokeWidth = isHighlight ? 4 : (edge.type === 'reading-order' ? 3 : 2);
    const strokeDash = edge.type === 'series-track' ? 'stroke-dasharray="6 4"' : '';
    const opacity = isVisible ? (isHighlight ? 1 : (edge.type === 'reading-order' ? 0.8 : 0.5)) : 0.12;

    const arrowHtml = `<polygon points="${endX},${endY} ${endX - 8},${endY - 4} ${endX - 8},${endY + 4}" fill="${edgeColor}" opacity="${opacity}"/>`;

    edgeHtml += `
      <path d="${pathData}" fill="none" stroke="${edgeColor}" stroke-width="${strokeWidth}" ${strokeDash} opacity="${opacity}" class="transition-all duration-300"/>
      ${arrowHtml}
    `;
  });

  svg.innerHTML = edgeHtml;

  // Render HTML Cards
  let nodesHtml = '';
  nodes.forEach(node => {
    const isVisible = visibleNodeIds.has(node.id);
    const isSelected = activeSelectedNodeId === node.id;
    const thumbUrl = node.thumbnailPath
      ? `${baseUrl}/thumbnails/${encodeURIComponent(node.thumbnailPath)}`
      : `${baseUrl}/background.png`;

    const statusBorder = node.readStatus === 'read' ? 'border-green-500/80 shadow-green-950/40' :
                         node.readStatus === 'in-progress' ? 'border-purple-500/80 shadow-purple-950/40' :
                         'border-gray-700/80 shadow-black/40';

    const statusBadge = node.readStatus === 'read' ? '<span class="text-[10px] px-1.5 py-0.5 bg-green-900/80 text-green-300 rounded font-semibold">✓ Read</span>' :
                        node.readStatus === 'in-progress' ? '<span class="text-[10px] px-1.5 py-0.5 bg-purple-900/80 text-purple-300 rounded font-semibold">⏳ In Progress</span>' :
                        '<span class="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">Unread</span>';

    const seriesColor = seriesColorMap.get(node.series) || '#a855f7';

    nodesHtml += `
      <div id="rl-dag-node-${node.id}" class="rl-dag-node absolute select-none cursor-pointer transition-transform duration-150 ease-out group"
           style="transform: translate3d(${node.x}px, ${node.y}px, 0); opacity: ${isVisible ? 1 : 0.2};"
           data-node-id="${node.id}">
        <div class="w-48 bg-gray-900/90 backdrop-blur-md rounded-xl border ${isSelected ? 'border-purple-400 ring-2 ring-purple-500 shadow-2xl' : statusBorder} overflow-hidden shadow-xl hover:scale-105 hover:z-30 transition-all duration-200">
          <div class="h-28 relative overflow-hidden bg-black/60">
            <img src="${thumbUrl}" alt="${escapeHtml(node.name)}" class="w-full h-full object-cover object-top opacity-85 group-hover:opacity-100 transition-opacity" loading="lazy">
            <div class="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent"></div>
            <div class="absolute top-2 left-2 flex gap-1">
              <span class="text-[10px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded shadow backdrop-blur-xs font-mono"
                    style="background-color: ${seriesColor}30; color: ${seriesColor}; border: 1px solid ${seriesColor}50;">
                Step #${node.step}
              </span>
            </div>
            ${node.number ? `
              <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-bold text-amber-300 font-mono shadow">
                #${escapeHtml(node.number)}
              </div>
            ` : ''}
            <div class="absolute bottom-1.5 left-2 right-2 flex items-center justify-between">
              <span class="text-[10px] text-gray-300 truncate max-w-[120px] font-medium drop-shadow">${escapeHtml(node.series)}</span>
            </div>
          </div>
          <div class="p-2.5">
            <h5 class="text-xs font-bold text-white tracking-tight truncate">${escapeHtml(node.name)}</h5>
            <div class="flex items-center justify-between mt-2">
              ${statusBadge}
              <button class="rl-dag-quick-read-btn p-1 rounded-md bg-purple-600 hover:bg-purple-500 text-white transition-colors" title="Read Issue" data-comic-id="${node.id}">
                <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  nodesContainer.innerHTML = nodesHtml;
  applyTransform(container);
}

/**
 * Binds mouse, touch, and UI event interactions
 */
function bindInteractions(container) {
  const viewport = container.querySelector('#rl-dag-viewport');
  if (!viewport || viewport._rlDagBound) return;
  viewport._rlDagBound = true;
  viewport.style.touchAction = 'none';

  // Mouse pan
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.rl-dag-node button') || e.target.closest('input')) return;
    isDraggingGraph = true;
    dragStart = { x: e.clientX - graphTransform.x, y: e.clientY - graphTransform.y };
    viewport.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingGraph) return;
    graphTransform.x = e.clientX - dragStart.x;
    graphTransform.y = e.clientY - dragStart.y;
    applyTransform(container);
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingGraph) {
      isDraggingGraph = false;
      viewport.style.cursor = 'grab';
    }
  });

  // Mobile Touch Pan & Pinch-to-Zoom
  let touchStartDist = 0;
  let touchStartScale = 1;
  let isTouching = false;
  let touchStartPos = { x: 0, y: 0 };

  viewport.addEventListener('touchstart', (e) => {
    if (e.target.closest('.rl-dag-node button') || e.target.closest('input')) return;
    if (e.touches.length === 1) {
      isTouching = true;
      touchStartPos = {
        x: e.touches[0].clientX - graphTransform.x,
        y: e.touches[0].clientY - graphTransform.y
      };
    } else if (e.touches.length === 2) {
      isTouching = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDist = Math.hypot(dx, dy);
      touchStartScale = graphTransform.scale;
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && isTouching) {
      graphTransform.x = e.touches[0].clientX - touchStartPos.x;
      graphTransform.y = e.touches[0].clientY - touchStartPos.y;
      applyTransform(container);
    } else if (e.touches.length === 2 && touchStartDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);
      const factor = currentDist / touchStartDist;
      graphTransform.scale = Math.min(2.5, Math.max(0.25, touchStartScale * factor));
      applyTransform(container);
    }
  }, { passive: true });

  viewport.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      isTouching = false;
      touchStartDist = 0;
    } else if (e.touches.length === 1) {
      isTouching = true;
      touchStartPos = {
        x: e.touches[0].clientX - graphTransform.x,
        y: e.touches[0].clientY - graphTransform.y
      };
    }
  }, { passive: true });

  viewport.addEventListener('touchcancel', () => {
    isTouching = false;
    touchStartDist = 0;
  });

  // Wheel zoom toward pointer
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(2.5, Math.max(0.25, graphTransform.scale * zoomFactor));

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    graphTransform.x = mouseX - (mouseX - graphTransform.x) * (newScale / graphTransform.scale);
    graphTransform.y = mouseY - (mouseY - graphTransform.y) * (newScale / graphTransform.scale);
    graphTransform.scale = newScale;
    applyTransform(container);
  }, { passive: false });

  // Node Card Click & Quick Read
  viewport.addEventListener('click', (e) => {
    const quickReadBtn = e.target.closest('.rl-dag-quick-read-btn');
    if (quickReadBtn) {
      e.stopPropagation();
      const comicId = quickReadBtn.dataset.comicId;
      launchComicReader(comicId);
      return;
    }

    const nodeCard = e.target.closest('.rl-dag-node');
    if (nodeCard) {
      const nodeId = nodeCard.dataset.nodeId;
      activeSelectedNodeId = activeSelectedNodeId === nodeId ? null : nodeId;
      renderVisuals(container);
      if (activeSelectedNodeId) {
        showNodeInspector(container, activeSelectedNodeId);
      } else {
        hideNodeInspector(container);
      }
      return;
    }

    // Clicking empty space closes inspector
    if (!e.target.closest('#rl-dag-inspector')) {
      activeSelectedNodeId = null;
      renderVisuals(container);
      hideNodeInspector(container);
    }
  });

  // Double click node to read immediately
  viewport.addEventListener('dblclick', (e) => {
    const nodeCard = e.target.closest('.rl-dag-node');
    if (nodeCard) {
      const nodeId = nodeCard.dataset.nodeId;
      launchComicReader(nodeId);
    }
  });

  // Search input
  const searchInput = container.querySelector('#rl-dag-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderVisuals(container);
    });
  }

  // Filter buttons (All / Unread / Read)
  const filterBtns = container.querySelectorAll('.rl-dag-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilterMode = btn.dataset.filter;
      filterBtns.forEach(b => {
        const isActive = b.dataset.filter === activeFilterMode;
        b.className = `rl-dag-filter-btn px-2.5 py-1 rounded font-medium transition-colors ${isActive ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:text-white'}`;
      });
      renderVisuals(container);
    });
  });

  // Focus next unread button
  const focusUnreadBtn = container.querySelector('#rl-dag-focus-unread-btn');
  if (focusUnreadBtn) {
    focusUnreadBtn.addEventListener('click', () => {
      fitDAGToViewport(container, currentDAGData, true);
    });
  }

  // Reset button
  const resetBtn = container.querySelector('#rl-dag-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      fitDAGToViewport(container, currentDAGData, false);
    });
  }

  // Series legend chips
  const legendChips = container.querySelectorAll('.rl-series-legend-chip');
  legendChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const series = chip.dataset.series;
      if (activeSeriesFilter === series) {
        activeSeriesFilter = null;
        chip.style.opacity = '1';
      } else {
        activeSeriesFilter = series;
        legendChips.forEach(c => {
          c.style.opacity = c.dataset.series === series ? '1' : '0.4';
        });
      }
      renderVisuals(container);
    });
  });
}

/**
 * Show node details in the bottom drawer
 */
function showNodeInspector(container, nodeId) {
  const inspector = container.querySelector('#rl-dag-inspector');
  if (!inspector || !currentDAGData) return;

  const node = currentDAGData.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const baseUrl = getBaseUrl();
  const thumbUrl = node.thumbnailPath
    ? `${baseUrl}/thumbnails/${encodeURIComponent(node.thumbnailPath)}`
    : `${baseUrl}/background.png`;

  inspector.innerHTML = `
    <div class="p-4 bg-gray-900/95 border-t border-purple-500/40 backdrop-blur-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-slide-up shadow-2xl">
      <div class="flex items-center gap-3 min-w-0">
        <img src="${thumbUrl}" class="w-12 h-16 object-cover rounded-lg shadow-md border border-gray-700 shrink-0" loading="lazy">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[10px] uppercase font-mono font-extrabold px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-500/30">
              Step #${node.step}
            </span>
            <span class="text-xs font-semibold text-gray-300 truncate">${escapeHtml(node.series)} ${node.number ? `#${escapeHtml(node.number)}` : ''}</span>
          </div>
          <h4 class="text-sm font-bold text-white truncate mt-0.5">${escapeHtml(node.name)}</h4>
          <p class="text-[11px] text-gray-400 line-clamp-1 mt-0.5">${escapeHtml(node.summary || node.publisher || 'In reading order')}</p>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
        <button id="rl-inspector-read-btn" class="py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-colors flex items-center gap-1.5 shadow-lg" data-comic-id="${node.id}">
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          <span>Read Issue</span>
        </button>
        <button id="rl-inspector-close-btn" class="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors text-xs" title="Close details">
          ✕
        </button>
      </div>
    </div>
  `;

  inspector.classList.remove('hidden');

  const readBtn = inspector.querySelector('#rl-inspector-read-btn');
  if (readBtn) {
    readBtn.onclick = () => launchComicReader(node.id);
  }

  const closeBtn = inspector.querySelector('#rl-inspector-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      activeSelectedNodeId = null;
      renderVisuals(container);
      hideNodeInspector(container);
    };
  }
}

function hideNodeInspector(container) {
  const inspector = container.querySelector('#rl-dag-inspector');
  if (inspector) {
    inspector.classList.add('hidden');
    inspector.innerHTML = '';
  }
}

/**
 * Launch the comic in the reader
 */
function launchComicReader(comicId) {
  let comic = typeof getComicById === 'function' ? getComicById(comicId) : null;
  if (!comic && typeof window !== 'undefined' && typeof window.getComicById === 'function') {
    comic = window.getComicById(comicId);
  }
  if (!comic && state && typeof state.getComicById === 'function') {
    comic = state.getComicById(comicId);
  }
  if (!comic && currentDAGData && currentDAGData.nodes) {
    const node = currentDAGData.nodes.find(n => n.id === comicId);
    if (node) {
      comic = { id: node.id, name: node.name, series: node.series, totalPages: node.totalPages, lastReadPage: node.lastReadPage };
    }
  }

  const listContext = activeContextList ? { readingListId: activeContextList.id, readingListName: activeContextList.name } : {};

  const openViewer = (typeof window !== 'undefined' && window.openComicViewer) ||
                     (typeof state !== 'undefined' && state.openComicViewer) ||
                     (typeof global !== 'undefined' && global.openComicViewer);
  const closeModal = (typeof window !== 'undefined' && window.closeReadingListModal) ||
                      (typeof state !== 'undefined' && state.closeReadingListModal) ||
                      (typeof global !== 'undefined' && global.closeReadingListModal);

  if (typeof openViewer === 'function') {
    openViewer(comic || { id: comicId }, listContext);
    if (typeof closeModal === 'function') {
      closeModal();
    }
  }
}
