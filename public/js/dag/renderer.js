/**
 * Comics Now! - Reading List DAG Visual Renderer
 *
 * SVG connection curves, HTML comic cards, and inspector drawer rendering.
 */

import { escapeHtml } from '../globals.js';
import { dagState, getBaseUrl, renderContent, safeRaw, safeHtml, clear } from './state.js';
import { applyTransform } from './layout.js';

/**
 * Renders SVG curves and HTML node cards based on current filter & search
 * @param {HTMLElement} container - DAG mount container
 */
export function renderVisuals(container) {
  if (!dagState.currentDAGData) return;
  const { nodes, edges, seriesLanes } = dagState.currentDAGData;
  const svg = container.querySelector('#rl-dag-svg-layer');
  const nodesContainer = container.querySelector('#rl-dag-nodes-layer');
  if (!svg || !nodesContainer) return;

  const baseUrl = getBaseUrl();
  const seriesColorMap = new Map((seriesLanes || []).map(sl => [sl.series, sl.color]));

  // Filter nodes
  const visibleNodes = nodes.filter(node => {
    if (dagState.activeFilterMode === 'read' && node.readStatus !== 'read') return false;
    if (dagState.activeFilterMode === 'unread' && node.readStatus === 'read') return false;
    if (dagState.activeSeriesFilter && node.series !== dagState.activeSeriesFilter) return false;
    if (dagState.searchQuery) {
      const q = dagState.searchQuery.toLowerCase();
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
    const isHighlight = dagState.activeSelectedNodeId && (dagState.activeSelectedNodeId === fromNode.id || dagState.activeSelectedNodeId === toNode.id);

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

  renderContent(svg, safeRaw(edgeHtml));

  // Render HTML Cards
  let nodesHtml = '';
  nodes.forEach(node => {
    const isVisible = visibleNodeIds.has(node.id);
    const isSelected = dagState.activeSelectedNodeId === node.id;
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

  renderContent(nodesContainer, safeRaw(nodesHtml));
  applyTransform(container);
}

/**
 * Show node details in the bottom drawer
 * @param {HTMLElement} container - DAG container
 * @param {string} nodeId - Selected node ID
 * @param {Function} [onLaunchComic] - Optional callback to launch reader
 */
export function showNodeInspector(container, nodeId, onLaunchComic = null) {
  const inspector = container.querySelector('#rl-dag-inspector');
  if (!inspector || !dagState.currentDAGData) return;

  const node = dagState.currentDAGData.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const baseUrl = getBaseUrl();
  const thumbUrl = node.thumbnailPath
    ? `${baseUrl}/thumbnails/${encodeURIComponent(node.thumbnailPath)}`
    : `${baseUrl}/background.png`;

  renderContent(inspector, safeHtml`
    <div class="p-4 bg-gray-900/95 border-t border-purple-500/40 backdrop-blur-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-slide-up shadow-2xl">
      <div class="flex items-center gap-3 min-w-0">
        <img src="${thumbUrl}" class="w-12 h-16 object-cover rounded-lg shadow-md border border-gray-700 shrink-0" loading="lazy">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[10px] uppercase font-mono font-extrabold px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-500/30">
              Step #${node.step}
            </span>
            <span class="text-xs font-semibold text-gray-300 truncate">${node.series} ${node.number ? `#${node.number}` : ''}</span>
          </div>
          <h4 class="text-sm font-bold text-white truncate mt-0.5">${node.name}</h4>
          <p class="text-[11px] text-gray-400 line-clamp-1 mt-0.5">${node.summary || node.publisher || 'In reading order'}</p>
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
  `);

  inspector.classList.remove('hidden');

  const readBtn = inspector.querySelector('#rl-inspector-read-btn');
  if (readBtn) {
    readBtn.onclick = () => {
      if (typeof onLaunchComic === 'function') {
        onLaunchComic(node.id);
      }
    };
  }

  const closeBtn = inspector.querySelector('#rl-inspector-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      dagState.activeSelectedNodeId = null;
      renderVisuals(container);
      hideNodeInspector(container);
    };
  }
}

/**
 * Hide and clear the bottom node inspector
 * @param {HTMLElement} container - DAG container
 */
export function hideNodeInspector(container) {
  const inspector = container.querySelector('#rl-dag-inspector');
  if (inspector) {
    inspector.classList.add('hidden');
    clear(inspector);
  }
}
