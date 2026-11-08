/**
 * Comics Now! - Story Arcs Detail & Banner View
 *
 * Dedicated Gold/Amber Box-Set detail view with format switcher (Single Issues vs Collected Volumes)
 * and view modes (Grid, Checklist, and DAG timeline).
 */
import {
  state,
  escapeHtml
} from '../globals.js';
import { launchComicReader } from '../dag/interactions.js';
import { renderIssuesGridView, renderIssuesChecklistView } from './story-arcs-issues.js';
import { renderCollectionsGridView, renderCollectionsChecklistView } from './story-arcs-collections.js';
import { renderStoryArcMetroView } from './story-arcs-metro.js';
import { getStoryArcEditionPreference } from '../settings/story-arc-reader-settings.js';

let activeArcDetailModal = null;
let currentArcData = null;
let currentFormat = 'issues'; // 'issues' | 'collections'
let currentViewMode = 'grid'; // 'grid' | 'checklist'

export function createStoryArcDetailModal() {
  let modal = document.getElementById('story-arc-detail-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'story-arc-detail-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md hidden transition-opacity duration-200 p-2 sm:p-4';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  modal.innerHTML = `
    <div class="relative w-full h-full max-w-7xl max-h-[94vh] bg-gray-950 border border-amber-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <!-- Gold/Amber Banner Header -->
      <div class="relative bg-gradient-to-r from-amber-950/80 via-gray-900 to-gray-950 px-5 py-4 border-b border-amber-500/30 shrink-0">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <button id="story-arc-back-btn" class="p-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 text-amber-300 hover:text-amber-200 transition-colors cursor-pointer shrink-0" title="Back">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap text-[11px] font-bold uppercase tracking-wider mb-0.5">
                <span id="story-arc-publisher-badge" class="px-2 py-0.5 rounded bg-amber-500 text-black font-extrabold shadow-xs">Publisher</span>
                <span id="story-arc-continuity-badge" class="text-amber-400 flex items-center gap-1">⚡ Reading Order Continuity</span>
                <span class="text-gray-600">•</span>
                <span id="story-arc-owned-badge" class="text-emerald-400 font-semibold">0/0 In Library</span>
                <span class="text-gray-600">•</span>
                <span id="story-arc-read-badge" class="text-sky-400 font-semibold">0 Read</span>
              </div>
              <h2 id="story-arc-modal-title" class="text-lg sm:text-2xl font-extrabold text-white truncate">
                Story Arc Title
              </h2>
            </div>
          </div>

          <div class="flex items-center gap-2 sm:gap-3 self-end sm:self-center shrink-0 flex-wrap">
            <!-- Format Switcher Segmented Control -->
            <div id="story-arc-format-switcher" class="flex items-center bg-gray-900/90 p-0.5 rounded-lg border border-amber-500/30 text-xs shadow-inner">
              <button id="story-arc-format-issues-btn" class="px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 bg-amber-500 text-black shadow-xs cursor-pointer">
                <span>⚡</span>
                <span>Single Issues</span>
                <span id="story-arc-format-issues-count" class="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-black/30 text-amber-200">0</span>
              </button>
              <button id="story-arc-format-collections-btn" class="px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 text-gray-400 hover:text-white cursor-pointer">
                <span>📚</span>
                <span>Collected Volumes</span>
                <span id="story-arc-format-collections-count" class="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-black/30 text-amber-200">0</span>
              </button>
            </div>

            <!-- View Mode Segmented Control -->
            <div class="flex items-center bg-gray-900/90 p-0.5 rounded-lg border border-amber-500/30 text-xs shadow-inner">
              <button id="story-arc-view-grid-btn" class="px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 bg-amber-500 text-black shadow-xs cursor-pointer" title="Grid View">
                <span>⊞</span>
                <span class="hidden md:inline">Grid</span>
              </button>
              <button id="story-arc-view-checklist-btn" class="px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 text-gray-400 hover:text-white cursor-pointer" title="Checklist View">
                <span>☰</span>
                <span class="hidden md:inline">Checklist</span>
              </button>
              <button id="story-arc-view-metro-btn" class="px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 text-gray-400 hover:text-white cursor-pointer" title="Timeline View">
                <span>◈</span>
                <span class="hidden md:inline">Timeline</span>
              </button>
            </div>

            <button id="story-arc-modal-close-btn" class="p-2 text-gray-400 hover:text-white transition-colors cursor-pointer text-xl ml-1" title="Close">
              ✕
            </button>
          </div>
        </div>

        <!-- Progress Bar Indicator -->
        <div class="mt-3 flex items-center gap-3 text-xs">
          <div class="flex-1 bg-gray-800/90 h-1.5 rounded-full overflow-hidden">
            <div id="story-arc-header-progress-bar" class="bg-gradient-to-r from-amber-500 to-emerald-400 h-full rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
          <span id="story-arc-header-progress-percent" class="font-bold text-amber-400 shrink-0 text-[11px]">0%</span>
        </div>
      </div>

      <!-- Main Body Views -->
      <div class="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-950 relative">
        <!-- 1. Single Issues Grid -->
        <div id="story-arc-grid-view" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"></div>

        <!-- 2. Single Issues Checklist -->
        <div id="story-arc-checklist-view" class="hidden overflow-x-auto bg-gray-900/60 rounded-xl border border-gray-800">
          <table class="w-full text-left text-xs sm:text-sm text-gray-300">
            <thead class="bg-gray-900 text-gray-400 uppercase text-[10px] tracking-wider border-b border-gray-800">
              <tr>
                <th class="py-3 px-4 w-12 text-center">#</th>
                <th class="py-3 px-4">Series & Issue</th>
                <th class="py-3 px-4 hidden sm:table-cell">Date</th>
                <th class="py-3 px-4">Storyline Part</th>
                <th class="py-3 px-4 text-center">Status</th>
                <th class="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody id="story-arc-checklist-tbody" class="divide-y divide-gray-800/60"></tbody>
          </table>
        </div>

        <!-- 3. Collected Volumes Grid -->
        <div id="story-arc-collections-grid-view" class="hidden"></div>

        <!-- 4. Collected Volumes Checklist -->
        <div id="story-arc-collections-checklist-view" class="hidden"></div>

        <!-- 5. Interactive Metro Line & Proportional Progression Visualizer -->
        <div id="story-arc-metro-view" class="hidden flex flex-col gap-6 w-full max-w-full overflow-hidden"></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close & back handlers
  const closeBtn = modal.querySelector('#story-arc-modal-close-btn');
  const backBtn = modal.querySelector('#story-arc-back-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeStoryArcDetail);
  if (backBtn) backBtn.addEventListener('click', closeStoryArcDetail);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeStoryArcDetail();
  });

  // Format switcher handlers
  const issuesFormatBtn = modal.querySelector('#story-arc-format-issues-btn');
  const collectionsFormatBtn = modal.querySelector('#story-arc-format-collections-btn');
  if (issuesFormatBtn) issuesFormatBtn.addEventListener('click', () => setFormat('issues'));
  if (collectionsFormatBtn) collectionsFormatBtn.addEventListener('click', () => setFormat('collections'));

  // View mode switcher handlers
  const gridBtn = modal.querySelector('#story-arc-view-grid-btn');
  const checklistBtn = modal.querySelector('#story-arc-view-checklist-btn');
  const metroBtn = modal.querySelector('#story-arc-view-metro-btn');
  if (gridBtn) gridBtn.addEventListener('click', () => setViewMode('grid'));
  if (checklistBtn) checklistBtn.addEventListener('click', () => setViewMode('checklist'));
  if (metroBtn) metroBtn.addEventListener('click', () => setViewMode('metro'));

  activeArcDetailModal = modal;
  return modal;
}

export function setFormat(format) {
  currentFormat = format;
  const modal = activeArcDetailModal || document.getElementById('story-arc-detail-modal');
  if (!modal) return;

  const issuesBtn = modal.querySelector('#story-arc-format-issues-btn');
  const collectionsBtn = modal.querySelector('#story-arc-format-collections-btn');

  const active = 'px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 bg-amber-500 text-black shadow-xs cursor-pointer';
  const inactive = 'px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 text-gray-400 hover:text-white cursor-pointer';

  if (issuesBtn) issuesBtn.className = format === 'issues' ? active : inactive;
  if (collectionsBtn) collectionsBtn.className = format === 'collections' ? active : inactive;

  updateHeaderSummary(modal, currentArcData);
  updateViewVisibility(modal);
}

export function setViewMode(mode) {
  currentViewMode = mode === 'checklist' ? 'checklist' : (mode === 'metro' ? 'metro' : 'grid');
  const modal = activeArcDetailModal || document.getElementById('story-arc-detail-modal');
  if (!modal) return;

  const gridBtn = modal.querySelector('#story-arc-view-grid-btn');
  const checklistBtn = modal.querySelector('#story-arc-view-checklist-btn');
  const metroBtn = modal.querySelector('#story-arc-view-metro-btn');

  const active = 'px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 bg-amber-500 text-black shadow-xs cursor-pointer';
  const inactive = 'px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 text-gray-400 hover:text-white cursor-pointer';

  if (gridBtn) gridBtn.className = currentViewMode === 'grid' ? active : inactive;
  if (checklistBtn) checklistBtn.className = currentViewMode === 'checklist' ? active : inactive;
  if (metroBtn) metroBtn.className = currentViewMode === 'metro' ? active : inactive;

  updateViewVisibility(modal);
}

function setElementHidden(el, shouldHide) {
  if (!el) return;
  if (shouldHide) {
    el.classList.add('hidden');
  } else {
    el.classList.remove('hidden');
  }
}

function updateViewVisibility(modal) {
  if (!modal) return;
  const issuesGrid = modal.querySelector('#story-arc-grid-view');
  const issuesChecklist = modal.querySelector('#story-arc-checklist-view');
  const colGrid = modal.querySelector('#story-arc-collections-grid-view');
  const colChecklist = modal.querySelector('#story-arc-collections-checklist-view');
  const metroView = modal.querySelector('#story-arc-metro-view');

  const isIssues = currentFormat === 'issues';
  setElementHidden(metroView, currentViewMode !== 'metro');
  setElementHidden(issuesGrid, !isIssues || currentViewMode !== 'grid');
  setElementHidden(issuesChecklist, !isIssues || currentViewMode !== 'checklist');
  setElementHidden(colGrid, isIssues || currentViewMode !== 'grid');
  setElementHidden(colChecklist, isIssues || currentViewMode !== 'checklist');

  if (currentViewMode === 'metro' && currentArcData) {
    const items = isIssues ? (currentArcData.issues || []) : (currentArcData.collections || []);
    renderStoryArcMetroView(metroView, items, currentFormat, (item) => {
      closeStoryArcDetail();
      if (item && item.comicId && typeof launchComicReader === 'function') {
        launchComicReader(item.comicId);
      }
    });
  }
}

function updateHeaderSummary(modal, arc) {
  if (!modal || !arc) return;
  const ownedEl = modal.querySelector('#story-arc-owned-badge');
  const readEl = modal.querySelector('#story-arc-read-badge');
  const bar = modal.querySelector('#story-arc-header-progress-bar');
  const pctEl = modal.querySelector('#story-arc-header-progress-percent');

  const isIssues = currentFormat === 'issues';
  const total = isIssues ? (arc.totalIssues || 0) : (arc.totalCollections || 0);
  const owned = isIssues ? (arc.ownedCount || 0) : (arc.ownedCollectionsCount || 0);
  const read = isIssues ? (arc.readCount || 0) : (arc.readCollectionsCount || 0);
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;

  if (ownedEl) ownedEl.textContent = `${owned}/${total} In Library`;
  if (readEl) readEl.textContent = `${read}/${owned} Read`;
  if (bar) bar.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}% In Library`;
}

export async function showStoryArcDetail(arcId, arcTitle, initialViewMode = 'grid', initialFormat = null) {
  const modal = createStoryArcDetailModal();
  const titleEl = modal.querySelector('#story-arc-modal-title');
  if (titleEl) titleEl.textContent = arcTitle || 'Story Arc';

  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Determine initial format based on user settings if not explicitly specified
  if (!initialFormat) {
    const pref = typeof getStoryArcEditionPreference === 'function' ? getStoryArcEditionPreference() : 'issues';
    initialFormat = pref === 'collections' ? 'collections' : 'issues';
  }

  const baseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  try {
    const res = await fetch(`${baseUrl}/api/v1/story-arcs/${encodeURIComponent(arcId)}`);
    if (res.ok) {
      const data = await res.json();
      currentArcData = data.storyArc;
      populateArcDetails(modal, currentArcData, initialFormat, initialViewMode);
      return currentArcData;
    }
  } catch (err) {
    console.error('[StoryArcDetail] Failed to load arc details:', err);
  }
}

function populateArcDetails(modal, arc, targetFormat = 'issues', targetViewMode = 'grid') {
  if (!modal || !arc) return;

  const titleEl = modal.querySelector('#story-arc-modal-title');
  const pubEl = modal.querySelector('#story-arc-publisher-badge');
  const issuesCountEl = modal.querySelector('#story-arc-format-issues-count');
  const colCountEl = modal.querySelector('#story-arc-format-collections-count');
  const formatSwitcher = modal.querySelector('#story-arc-format-switcher');

  if (titleEl) titleEl.textContent = arc.title;
  if (pubEl) pubEl.textContent = arc.publisher || 'Publisher';
  if (issuesCountEl) issuesCountEl.textContent = (arc.totalIssues || 0).toString();
  if (colCountEl) colCountEl.textContent = (arc.totalCollections || 0).toString();

  // If this story arc has no collections, hide format switcher and lock to issues
  if (!arc.totalCollections || arc.totalCollections === 0) {
    targetFormat = 'issues';
    if (formatSwitcher) formatSwitcher.classList.add('hidden');
  } else if (formatSwitcher) {
    formatSwitcher.classList.remove('hidden');
  }

  // Render submodules
  const onComicSelect = (item) => {
    closeStoryArcDetail();
    if (item && item.comicId && typeof launchComicReader === 'function') {
      launchComicReader(item.comicId);
    }
  };

  renderIssuesGridView(modal, arc.issues || [], onComicSelect);
  renderIssuesChecklistView(modal, arc.issues || [], onComicSelect);
  renderCollectionsGridView(modal, arc.collections || [], onComicSelect);
  renderCollectionsChecklistView(modal, arc.collections || [], onComicSelect);

  const metroContainer = modal.querySelector('#story-arc-metro-view');
  const metroItems = targetFormat === 'issues' ? (arc.issues || []) : (arc.collections || []);
  renderStoryArcMetroView(metroContainer, metroItems, targetFormat, onComicSelect);

  setFormat(targetFormat);
  setViewMode(targetViewMode);
}

export function closeStoryArcDetail() {
  const modal = activeArcDetailModal || document.getElementById('story-arc-detail-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

if (typeof window !== 'undefined') {
  window.showStoryArcDetail = showStoryArcDetail;
  window.closeStoryArcDetail = closeStoryArcDetail;
}
if (typeof state !== 'undefined') {
  state.showStoryArcDetail = showStoryArcDetail;
  state.closeStoryArcDetail = closeStoryArcDetail;
}
