/**
 * Comics Now! - Reading List Continuity & Narrative DAG View
 *
 * Facade entrypoint for Directed Acyclic Graph (DAG) reading list visualizer.
 */

import { escapeHtml } from './globals.js';
import { dagState, renderContent, safeHtml, safeRaw } from './dag/state.js';
import {
  LANE_COLORS,
  fetchReadingListDAG,
  buildDAGFromDetails,
  calculateReadingListDAGPositions,
  fitDAGToViewport,
  applyTransform
} from './dag/layout.js';
import { renderVisuals, showNodeInspector, hideNodeInspector } from './dag/renderer.js';
import { bindInteractions, launchComicReader } from './dag/interactions.js';

export {
  LANE_COLORS,
  dagState,
  fetchReadingListDAG,
  buildDAGFromDetails,
  calculateReadingListDAGPositions,
  fitDAGToViewport,
  applyTransform,
  renderVisuals,
  showNodeInspector,
  hideNodeInspector,
  bindInteractions,
  launchComicReader
};

/**
 * Main render function for the Reading List DAG
 * @param {HTMLElement} mountContainer - The parent element to mount the DAG in
 * @param {Object} dagData - The DAG data
 * @param {Object} options - Options including listId, listName, onComicSelect
 */
export function renderReadingListDAG(mountContainer, dagData, options = {}) {
  if (!mountContainer) return;
  dagState.currentDAGData = dagData;
  dagState.activeContextList = { id: options.listId, name: options.listName };
  dagState.activeSelectedNodeId = null;
  dagState.activeFilterMode = 'all';
  dagState.searchQuery = '';
  dagState.activeSeriesFilter = null;

  if (!dagData || !dagData.nodes || dagData.nodes.length === 0) {
    renderContent(mountContainer, safeHtml`
      <div class="py-16 text-center text-gray-400 bg-gray-900/40 rounded-2xl border border-gray-800 p-8 max-w-md mx-auto my-8">
        <span class="text-4xl mb-3 inline-block">📚</span>
        <h3 class="text-lg font-bold text-white mb-1">No Comics in this List</h3>
        <p class="text-xs text-gray-400">Add comics to this reading list to explore its interactive continuity graph.</p>
      </div>
    `);
    return;
  }

  calculateReadingListDAGPositions(dagData);

  const percent = dagData.totalIssues > 0 ? Math.round((dagData.readCount / dagData.totalIssues) * 100) : 0;
  const seriesLanesHtml = (dagData.seriesLanes && dagData.seriesLanes.length > 1) ? `
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
  ` : '';

  renderContent(mountContainer, safeHtml`
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
      ${safeRaw(seriesLanesHtml)}

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
  `);

  fitDAGToViewport(mountContainer, dagData, false);
  renderVisuals(mountContainer);
  bindInteractions(mountContainer);
}
