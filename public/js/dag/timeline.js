/**
 * Comics Now! - Narrative Timeline DAG Visualizer
 *
 * Taste-skill directed horizontal narrative timeline with DC comic trade dress,
 * act milestone markers, angled character tie-in spurs, and dual issue/collected modes.
 */
import { state, escapeHtml } from '../globals.js';
import { launchComicReader } from './interactions.js';

let activeTimelineModal = null;
let currentArcData = null;
let currentViewMode = 'issues'; // 'issues' | 'collected'

export function createTimelineModal() {
  if (activeTimelineModal) return activeTimelineModal;

  const modal = document.createElement('div');
  modal.id = 'arc-timeline-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md hidden transition-opacity duration-300';

  modal.innerHTML = `
    <div class="relative w-full h-full max-w-7xl max-h-[92vh] m-4 bg-gray-950 border border-amber-500/30 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <!-- Modal Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/60 shrink-0">
        <div class="flex items-center gap-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500 text-black shadow">Timeline</span>
          <h2 id="timeline-arc-title" class="text-xl font-extrabold text-white tracking-wide">Story Arc Timeline</h2>
        </div>
        <div class="flex items-center gap-3">
          <!-- Dual-View Toggle -->
          <div class="flex rounded-lg bg-gray-800 p-0.5 border border-gray-700">
            <button id="timeline-view-issues" class="px-3 py-1 rounded-md text-xs font-bold transition-all bg-amber-500 text-black shadow">
              Issues
            </button>
            <button id="timeline-view-collected" class="px-3 py-1 rounded-md text-xs font-bold transition-all text-gray-400 hover:text-white">
              Collected Volumes
            </button>
          </div>
          <button id="timeline-modal-close" class="p-2 text-gray-400 hover:text-white transition-colors cursor-pointer text-xl" title="Close Timeline">
            ✕
          </button>
        </div>
      </div>

      <!-- Main Canvas / Timeline Track -->
      <div id="timeline-viewport" class="flex-1 overflow-x-auto overflow-y-hidden p-6 relative flex items-center bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:20px_20px]">
        <div id="timeline-track" class="flex items-center gap-8 min-w-max py-8 px-12 relative">
          <!-- Spine & Nodes injected here -->
        </div>
      </div>

      <!-- Footer Info Bar -->
      <div id="timeline-footer" class="px-6 py-3 border-t border-gray-800/80 bg-gray-900/40 flex items-center justify-between text-xs text-gray-400 shrink-0">
        <div class="flex items-center gap-4">
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> Owned in Library</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full border border-dashed border-amber-400"></span> Missing from Library</span>
        </div>
        <span class="italic text-gray-500">Scroll horizontally or drag to navigate narrative timeline</span>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  modal.querySelector('#timeline-modal-close').addEventListener('click', closeArcTimelineModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeArcTimelineModal();
  });

  // Toggle handlers
  const btnIssues = modal.querySelector('#timeline-view-issues');
  const btnCollected = modal.querySelector('#timeline-view-collected');

  btnIssues.addEventListener('click', () => {
    currentViewMode = 'issues';
    btnIssues.className = 'px-3 py-1 rounded-md text-xs font-bold transition-all bg-amber-500 text-black shadow';
    btnCollected.className = 'px-3 py-1 rounded-md text-xs font-bold transition-all text-gray-400 hover:text-white';
    renderTimelineContent();
  });

  btnCollected.addEventListener('click', () => {
    currentViewMode = 'collected';
    btnCollected.className = 'px-3 py-1 rounded-md text-xs font-bold transition-all bg-amber-500 text-black shadow';
    btnIssues.className = 'px-3 py-1 rounded-md text-xs font-bold transition-all text-gray-400 hover:text-white';
    renderTimelineContent();
  });

  activeTimelineModal = modal;
  return modal;
}

export async function openArcTimelineModal(arcId, arcTitle) {
  const modal = createTimelineModal();
  const titleEl = modal.querySelector('#timeline-arc-title');
  if (titleEl) titleEl.textContent = arcTitle || 'Story Arc Timeline';

  modal.classList.remove('hidden');
  modal.classList.add('flex');

  const track = modal.querySelector('#timeline-track');
  if (track) {
    track.innerHTML = '<div class="text-amber-400 text-sm font-semibold animate-pulse">Loading continuity timeline...</div>';
  }

  const baseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  try {
    const res = await fetch(`${baseUrl}/api/v1/story-arcs/${encodeURIComponent(arcId)}`);
    if (res.ok) {
      const data = await res.json();
      currentArcData = data.storyArc;
      renderTimelineContent();
    }
  } catch (err) {
    console.error('[Timeline] Failed to load arc data:', err);
    if (track) track.innerHTML = '<div class="text-red-400 text-sm">Failed to load arc data</div>';
  }
}

export function closeArcTimelineModal() {
  if (activeTimelineModal) {
    activeTimelineModal.classList.add('hidden');
    activeTimelineModal.classList.remove('flex');
  }
}

function renderTimelineContent() {
  if (!activeTimelineModal || !currentArcData) return;
  const track = activeTimelineModal.querySelector('#timeline-track');
  if (!track) return;
  track.innerHTML = '';

  if (currentViewMode === 'collected') {
    renderCollectedTimeline(track, currentArcData.collections || []);
  } else {
    renderIssuesTimeline(track, currentArcData.issues || []);
  }
}

function renderIssuesTimeline(track, issues) {
  if (!issues || issues.length === 0) {
    track.innerHTML = '<div class="text-gray-400 text-sm">No issues indexed for this arc</div>';
    return;
  }

  // Horizontal event spine with cards
  issues.forEach((iss, index) => {
    // Act Milestone Marker
    if (index === 0 || index === Math.floor(issues.length / 2) || index === issues.length - 1) {
      const milestone = document.createElement('div');
      milestone.className = 'flex flex-col items-center justify-center shrink-0';
      const label = index === 0 ? 'Act I: Inception' : (index === issues.length - 1 ? 'Act III: Climax' : 'Act II: Escalation');
      milestone.innerHTML = `
        <span class="text-[10px] font-extrabold uppercase tracking-widest text-amber-400 mb-1">${label}</span>
        <div class="w-3 h-3 rounded-full bg-amber-400 ring-4 ring-amber-400/20 shadow-lg"></div>
      `;
      track.appendChild(milestone);
    }

    const card = document.createElement('div');
    const isOwned = Boolean(iss.isOwned);
    card.className = `relative flex flex-col w-40 shrink-0 rounded-xl overflow-hidden shadow-xl transition-all duration-300 hover:scale-105 cursor-pointer border ${
      isOwned ? 'bg-gray-900 border-gray-700 hover:border-amber-400' : 'bg-gray-950/80 border-dashed border-amber-500/40 opacity-75'
    }`;

    card.innerHTML = `
      <div class="relative w-full aspect-[13/20] bg-black overflow-hidden">
        ${iss.coverImageUrl ? `
          <img src="${iss.coverImageUrl}" alt="${escapeHtml(iss.seriesName)}" class="w-full h-full object-cover">
        ` : `
          <div class="w-full h-full flex items-center justify-center text-gray-600 text-2xl font-bold">#${iss.issueNumber}</div>
        `}
        <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[10px] font-bold text-amber-400 border border-amber-400/30">
          #${iss.position}
        </div>
        ${isOwned ? `
          <div class="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold shadow">✓</div>
        ` : `
          <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 text-[9px] font-bold border border-amber-500/50">Missing</div>
        `}
      </div>
      <div class="p-2.5 flex flex-col justify-between flex-1">
        <div>
          <div class="text-[10px] uppercase font-bold text-gray-400 line-clamp-1">${escapeHtml(iss.seriesName)}</div>
          <div class="text-xs font-extrabold text-white line-clamp-1">Issue #${iss.issueNumber}</div>
        </div>
        ${iss.importance === 'Essential' ? `
          <span class="mt-2 text-[9px] font-bold uppercase text-red-400 tracking-wider">● Essential</span>
        ` : ''}
      </div>
    `;

    if (isOwned && iss.comicId) {
      card.addEventListener('click', () => {
        closeArcTimelineModal();
        launchComicReader(iss.comicId);
      });
    }

    track.appendChild(card);
  });
}

function renderCollectedTimeline(track, collections) {
  if (!collections || collections.length === 0) {
    track.innerHTML = '<div class="text-gray-400 text-sm">No collected volumes indexed for this arc</div>';
    return;
  }

  collections.forEach((col) => {
    const card = document.createElement('div');
    card.className = 'flex flex-col w-64 shrink-0 rounded-2xl overflow-hidden shadow-2xl bg-gray-900 border border-gray-700/80 hover:border-amber-400 transition-all duration-300 p-4 gap-3';

    card.innerHTML = `
      <div class="flex gap-3">
        <div class="w-24 aspect-[13/20] bg-black rounded-lg overflow-hidden shrink-0 shadow">
          ${col.coverImageUrl ? `<img src="${col.coverImageUrl}" class="w-full h-full object-cover">` : '<div class="w-full h-full flex items-center justify-center text-gray-600">📚</div>'}
        </div>
        <div class="flex-1 flex flex-col justify-between">
          <div>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">Vol ${col.position}</span>
            <h4 class="text-sm font-extrabold text-white mt-1 leading-snug line-clamp-2">${escapeHtml(col.title)}</h4>
            ${col.subtitle ? `<p class="text-xs text-gray-400 line-clamp-1">${escapeHtml(col.subtitle)}</p>` : ''}
          </div>
          <div class="text-[10px] text-gray-400">${col.releaseYear || ''} ${col.pageCount ? `• ${col.pageCount} pages` : ''}</div>
        </div>
      </div>
      ${col.contentsRaw ? `
        <div class="border-t border-gray-800 pt-2 text-[10px] text-gray-400 line-clamp-2 leading-relaxed">
          <span class="font-bold text-gray-300">Collects:</span> ${escapeHtml(col.contentsRaw)}
        </div>
      ` : ''}
    `;

    track.appendChild(card);
  });
}

if (typeof window !== 'undefined') {
  window.openArcTimelineModal = openArcTimelineModal;
  window.closeArcTimelineModal = closeArcTimelineModal;
}
