/**
 * Comics Now! - Story Arcs Detail & Banner View
 *
 * Dedicated Gold/Amber Box-Set detail view with Grid, Checklist, and DAG view modes.
 * Distinct from Reading Lists (purple playlist) with editorial trade dress.
 */
import {
  state,
  escapeHtml
} from '../globals.js';
import { launchComicReader } from '../dag/interactions.js';
import { renderTimelineIntoContainer } from '../dag/timeline.js';

let activeArcDetailModal = null;
let currentArcData = null;
let currentViewMode = 'grid'; // 'grid' | 'checklist' | 'dag'

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
                <span id="story-arc-owned-badge" class="text-emerald-400 font-semibold">0/0 Owned</span>
              </div>
              <h2 id="story-arc-modal-title" class="text-lg sm:text-2xl font-extrabold text-white truncate">
                Story Arc Title
              </h2>
            </div>
          </div>

          <div class="flex items-center gap-2 sm:gap-3 self-end sm:self-center shrink-0">
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
              <button id="story-arc-view-dag-btn" class="px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 text-gray-400 hover:text-white cursor-pointer" title="Narrative DAG">
                <span>🔀</span>
                <span class="hidden md:inline">DAG</span>
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
        <!-- 1. Grid View -->
        <div id="story-arc-grid-view" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          <!-- Dynamic Issue Cards -->
        </div>

        <!-- 2. Checklist View -->
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
            <tbody id="story-arc-checklist-tbody" class="divide-y divide-gray-800/60">
              <!-- Dynamic Rows -->
            </tbody>
          </table>
        </div>

        <!-- 3. DAG View Container -->
        <div id="story-arc-dag-view" class="hidden w-full h-[70vh] rounded-xl overflow-hidden border border-amber-500/20 bg-gray-950">
          <!-- Embedded Narrative Timeline DAG -->
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Wire close & back handlers
  const closeBtn = modal.querySelector('#story-arc-modal-close-btn');
  const backBtn = modal.querySelector('#story-arc-back-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeStoryArcDetail);
  if (backBtn) backBtn.addEventListener('click', closeStoryArcDetail);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeStoryArcDetail();
  });

  // Wire segmented view mode buttons
  const gridBtn = modal.querySelector('#story-arc-view-grid-btn');
  const checklistBtn = modal.querySelector('#story-arc-view-checklist-btn');
  const dagBtn = modal.querySelector('#story-arc-view-dag-btn');

  if (gridBtn) gridBtn.addEventListener('click', () => setViewMode('grid'));
  if (checklistBtn) checklistBtn.addEventListener('click', () => setViewMode('checklist'));
  if (dagBtn) dagBtn.addEventListener('click', () => setViewMode('dag'));

  activeArcDetailModal = modal;
  return modal;
}

export function setViewMode(mode) {
  currentViewMode = mode;
  const modal = activeArcDetailModal || document.getElementById('story-arc-detail-modal');
  if (!modal) return;

  const gridView = modal.querySelector('#story-arc-grid-view');
  const checklistView = modal.querySelector('#story-arc-checklist-view');
  const dagView = modal.querySelector('#story-arc-dag-view');

  const gridBtn = modal.querySelector('#story-arc-view-grid-btn');
  const checklistBtn = modal.querySelector('#story-arc-view-checklist-btn');
  const dagBtn = modal.querySelector('#story-arc-view-dag-btn');

  if (gridView) gridView.classList.toggle('hidden', mode !== 'grid');
  if (checklistView) checklistView.classList.toggle('hidden', mode !== 'checklist');
  if (dagView) dagView.classList.toggle('hidden', mode !== 'dag');

  const activeClasses = 'px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 bg-amber-500 text-black shadow-xs cursor-pointer';
  const inactiveClasses = 'px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 text-gray-400 hover:text-white cursor-pointer';

  if (gridBtn) gridBtn.className = mode === 'grid' ? activeClasses : inactiveClasses;
  if (checklistBtn) checklistBtn.className = mode === 'checklist' ? activeClasses : inactiveClasses;
  if (dagBtn) dagBtn.className = mode === 'dag' ? activeClasses : inactiveClasses;

  if (mode === 'dag' && currentArcData) {
    const container = modal.querySelector('#story-arc-dag-view');
    if (container && typeof renderTimelineIntoContainer === 'function') {
      renderTimelineIntoContainer(container, currentArcData);
    }
  }
}

export async function showStoryArcDetail(arcId, arcTitle, initialViewMode = 'grid') {
  const modal = createStoryArcDetailModal();
  const titleEl = modal.querySelector('#story-arc-modal-title');
  if (titleEl) titleEl.textContent = arcTitle || 'Story Arc';

  modal.classList.remove('hidden');
  modal.classList.add('flex');

  const baseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  try {
    const res = await fetch(`${baseUrl}/api/v1/story-arcs/${encodeURIComponent(arcId)}`);
    if (res.ok) {
      const data = await res.json();
      currentArcData = data.storyArc;
      populateArcDetails(modal, currentArcData);
      setViewMode(initialViewMode);
      return currentArcData;
    }
  } catch (err) {
    console.error('[StoryArcDetail] Failed to load arc details:', err);
  }
}

function populateArcDetails(modal, arc) {
  if (!modal || !arc) return;

  const titleEl = modal.querySelector('#story-arc-modal-title');
  const pubEl = modal.querySelector('#story-arc-publisher-badge');
  const ownedEl = modal.querySelector('#story-arc-owned-badge');
  const progressBar = modal.querySelector('#story-arc-header-progress-bar');
  const progressPercent = modal.querySelector('#story-arc-header-progress-percent');

  if (titleEl) titleEl.textContent = arc.title;
  if (pubEl) pubEl.textContent = arc.publisher || 'Publisher';
  if (ownedEl) ownedEl.textContent = `${arc.ownedCount || 0}/${arc.totalIssues || 0} Owned`;

  const pct = arc.completenessPercent || 0;
  if (progressBar) progressBar.style.width = `${pct}%`;
  if (progressPercent) progressPercent.textContent = `${pct}%`;

  renderGridView(modal, arc.issues || []);
  renderChecklistView(modal, arc.issues || []);
}

function renderGridView(modal, issues) {
  const container = modal.querySelector('#story-arc-grid-view');
  if (!container) return;
  container.innerHTML = '';

  issues.forEach((iss) => {
    const isOwned = Boolean(iss.isOwned);
    const card = document.createElement('div');
    card.className = 'story-arc-issue-card group relative flex flex-col rounded-xl overflow-hidden shadow-lg border transition-all duration-200';
    if (isOwned) {
      card.classList.add('bg-gray-900', 'border-gray-700', 'hover:border-amber-400', 'hover:scale-[1.02]', 'cursor-pointer');
    } else {
      card.classList.add('bg-gray-950/80', 'border-dashed', 'border-amber-500/40', 'opacity-75');
    }

    card.innerHTML = `
      <div class="relative w-full aspect-[13/20] bg-black overflow-hidden">
        ${iss.coverImageUrl ? `
          <img src="${iss.coverImageUrl}" alt="${escapeHtml(iss.seriesName)}" class="w-full h-full object-cover">
        ` : `
          <div class="w-full h-full flex items-center justify-center text-gray-600 text-xl font-bold">#${iss.issueNumber}</div>
        `}
        <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-xs text-[10px] font-bold text-amber-400 border border-amber-400/30">
          #${iss.position}
        </div>
        ${isOwned ? `
          <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-emerald-500 text-black text-[10px] font-bold shadow-xs">Owned</div>
        ` : `
          <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 text-[9px] font-bold border border-amber-500/50">Missing from Library</div>
        `}
      </div>
      <div class="p-2.5 flex flex-col justify-between flex-1">
        <div>
          <div class="text-[10px] uppercase font-bold text-gray-400 line-clamp-1">${escapeHtml(iss.seriesName)}</div>
          <div class="text-xs font-extrabold text-white line-clamp-1">Issue #${iss.issueNumber}</div>
          ${iss.storyParts ? `<div class="text-[10px] text-amber-400/90 line-clamp-1 mt-0.5">${escapeHtml(iss.storyParts)}</div>` : ''}
        </div>
        ${iss.importance === 'Essential' ? `
          <span class="mt-2 text-[9px] font-bold uppercase text-red-400 tracking-wider">● Essential</span>
        ` : ''}
      </div>
    `;

    if (isOwned && iss.comicId) {
      card.addEventListener('click', () => {
        closeStoryArcDetail();
        if (typeof launchComicReader === 'function') {
          launchComicReader(iss.comicId);
        }
      });
    }

    container.appendChild(card);
  });
}

function renderChecklistView(modal, issues) {
  const tbody = modal.querySelector('#story-arc-checklist-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  issues.forEach((iss) => {
    const isOwned = Boolean(iss.isOwned);
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-800/40 transition-colors';

    tr.innerHTML = `
      <td class="py-2.5 px-4 text-center font-mono text-amber-400 font-bold">${iss.position}</td>
      <td class="py-2.5 px-4 font-semibold text-white">
        ${escapeHtml(iss.seriesName)} <span class="text-amber-300">#${iss.issueNumber}</span>
      </td>
      <td class="py-2.5 px-4 hidden sm:table-cell text-gray-400 text-xs">${escapeHtml(iss.publicationDate || '—')}</td>
      <td class="py-2.5 px-4 text-xs text-gray-300">${escapeHtml(iss.storyParts || '—')}</td>
      <td class="py-2.5 px-4 text-center">
        ${isOwned ? `
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-500/40">✓ Owned</span>
        ` : `
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40">Missing</span>
        `}
      </td>
      <td class="py-2.5 px-4 text-right">
        ${isOwned && iss.comicId ? `
          <button class="read-btn px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-xs transition-colors cursor-pointer">Read</button>
        ` : `
          <span class="text-gray-500 text-xs italic">Unavailable</span>
        `}
      </td>
    `;

    if (isOwned && iss.comicId) {
      const readBtn = tr.querySelector('.read-btn');
      if (readBtn) {
        readBtn.addEventListener('click', () => {
          closeStoryArcDetail();
          if (typeof launchComicReader === 'function') {
            launchComicReader(iss.comicId);
          }
        });
      }
    }

    tbody.appendChild(tr);
  });
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
