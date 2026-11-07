/**
 * Comics Now! - Story Arcs Smart Filter View
 *
 * Dedicated renderer for Story Arcs with Gold/Amber comic box-set trade dress.
 * Provides clear UI/UX distinction from Reading Lists.
 */
import {
  state,
  clearElement,
  render,
  html,
  raw,
  escapeHtml,
  createEmptyMessage
} from '../../globals.js';
import { getStoryArcsForPublisher, fetchStoryArcsForPublisher } from '../smartlists/story-arcs.js';
import { showStoryArcDetail } from '../story-arcs-detail.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) el.innerHTML = ''; };
const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
    el.innerHTML = content.toHTML();
  } else if (content && typeof content === 'object' && content.__isRawHtml) {
    el.innerHTML = content.html;
  } else {
    el.innerHTML = String(content ?? '');
  }
};

const safeHtml = (typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__isRawHtml) out += v.html;
      else if (v && typeof v === 'object' && typeof v.toHTML === 'function') out += v.toHTML();
      else out += (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''));
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

const safeRaw = (typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({
  __isRawHtml: true,
  html: String(v ?? '')
});

export async function renderPublisherStoryArcs(publisherName) {
  const container = document.getElementById('series-list-container');
  if (!container) return;
  container.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5';
  clear(container);

  const seriesAlphaFilter = document.getElementById('series-alpha-filter');
  if (seriesAlphaFilter) {
    clear(seriesAlphaFilter);
    const isAdmin = (state.syncManager && state.syncManager.userRole === 'admin') ||
                    (typeof window !== 'undefined' && window.syncManager && window.syncManager.userRole === 'admin');
    const toolbar = document.createElement('div');
    toolbar.className = 'w-full flex items-center justify-between pb-3 mb-2 border-b border-amber-500/20 text-xs text-amber-300';
    toolbar.innerHTML = `
      <div class="flex items-center gap-2 font-medium">
        <span>⚡ Reading Orders Continuity</span>
        <span class="text-gray-500">•</span>
        <span class="text-gray-400">Canonical multi-series story arcs</span>
      </div>
      <div class="flex items-center gap-2">
        ${isAdmin ? `
          <button id="open-story-arcs-settings-btn" class="px-2.5 py-1 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white font-medium border border-gray-600 transition-all flex items-center gap-1 cursor-pointer" title="Configure Scheduling & Ingestion">
            <span>⚙</span>
            <span>Settings</span>
          </button>
          <button id="sync-story-arcs-toolbar-btn" class="px-3 py-1 rounded-full bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-black font-semibold border border-amber-400/40 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer">
            <span class="sync-icon">↻</span>
            <span class="sync-text">Sync Reading Orders</span>
          </button>
        ` : ''}
      </div>
    `;

    const settingsBtn = toolbar.querySelector('#open-story-arcs-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        if (state.router) {
          state.router.navigate('/settings/story-arcs');
        } else if (typeof window.openSettingsModal === 'function') {
          window.openSettingsModal();
          const tab = document.getElementById('settings-tab-story-arcs');
          if (tab) tab.click();
        }
      });
    }

    const syncBtn = toolbar.querySelector('#sync-story-arcs-toolbar-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        const icon = syncBtn.querySelector('.sync-icon');
        const text = syncBtn.querySelector('.sync-text');
        if (icon) icon.classList.add('animate-spin');
        if (text) text.textContent = 'Syncing...';
        syncBtn.disabled = true;

        try {
          const res = await fetch('/api/v1/story-arcs/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'both' })
          });
          const data = await res.json();
          if (data.ok) {
            if (text) text.textContent = 'Up to Date!';
            setTimeout(async () => {
              await fetchStoryArcsForPublisher(publisherName);
              renderPublisherStoryArcs(publisherName);
            }, 800);
          } else {
            if (text) text.textContent = 'Sync Failed';
          }
        } catch (err) {
          if (text) text.textContent = 'Error';
        } finally {
          setTimeout(() => {
            if (icon) icon.classList.remove('animate-spin');
            if (text) text.textContent = 'Sync Reading Orders';
            syncBtn.disabled = false;
          }, 2000);
        }
      });
    }

    seriesAlphaFilter.appendChild(toolbar);
  }

  // Show loading skeleton if fetching
  let storyArcs = getStoryArcsForPublisher(publisherName);
  if (storyArcs.length === 0) {
    storyArcs = await fetchStoryArcsForPublisher(publisherName);
  }

  if (storyArcs.length === 0) {
    const msg = `No indexed story arcs found for ${publisherName}.`;
    renderContent(container, createEmptyMessage(msg));
    const backBtn = document.createElement('button');
    backBtn.className = 'mt-4 text-amber-400 hover:text-amber-300 font-medium text-sm flex items-center gap-1 cursor-pointer';
    backBtn.textContent = '← Back to Series';
    backBtn.addEventListener('click', () => {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
      (state.showSeriesList || (typeof window !== 'undefined' && window.showSeriesList))?.(publisherName, { force: true });
    });
    container.appendChild(backBtn);
    return;
  }

  for (const arc of storyArcs) {
    const card = document.createElement('div');
    card.className = 'story-arc-card bg-linear-to-b from-gray-900 via-gray-900 to-gray-950 rounded-2xl shadow-2xl overflow-hidden border border-amber-500/30 hover:border-amber-400/80 transition-all duration-300 group flex flex-col justify-between';

    const isComplete = arc.completenessPercent === 100;
    const thumbUrl = arc.coverImage || null;

    renderContent(card, safeHtml`
      <div class="relative h-56 w-full overflow-hidden bg-black/60 border-b border-amber-500/20">
        ${safeRaw(thumbUrl ? `
          <img src="${thumbUrl}" alt="${escapeHtml(arc.title)}" class="w-full h-full object-cover object-top opacity-70 group-hover:opacity-95 group-hover:scale-105 transition-all duration-500" loading="lazy">
        ` : `
          <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-950/40 via-gray-900 to-black">
            <span class="text-4xl opacity-30 group-hover:scale-110 transition-transform">⚡</span>
          </div>
        `)}
        <div class="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-900/60 to-transparent"></div>

        <!-- Top Badges -->
        <div class="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500 text-black shadow-md">
            Story Arc
          </span>
          <div class="flex items-center gap-1.5 pointer-events-auto">
            <button class="arc-timeline-btn px-2.5 py-1 rounded-full bg-amber-950/90 hover:bg-amber-600 text-amber-200 hover:text-black font-bold text-xs border border-amber-400/50 backdrop-blur-md transition-all flex items-center gap-1 shadow cursor-pointer" title="Open Narrative Timeline">
              <span>⏱️</span>
              <span>Timeline</span>
            </button>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-black/70 text-amber-300 font-semibold backdrop-blur-sm border border-amber-500/30 shrink-0">
              ${arc.totalIssues} issues
            </span>
          </div>
        </div>

        <!-- Title & Subtitle in Cover Header -->
        <div class="absolute bottom-3 left-3 right-3">
          <h3 class="font-extrabold text-xl text-white group-hover:text-amber-300 transition-colors leading-snug line-clamp-1">
            ${arc.title}
          </h3>
          <div class="text-xs text-gray-400 flex items-center gap-2 mt-1">
            <span>${arc.publisher || publisherName}</span>
            ${safeRaw(arc.totalCollections > 0 ? `<span>•</span><span>${arc.totalCollections} Collected Volumes</span>` : '')}
          </div>
        </div>
      </div>

      <!-- Card Body -->
      <div class="p-4 flex-1 flex flex-col justify-between gap-3">
        ${safeRaw(arc.description ? `
          <p class="text-xs sm:text-sm text-gray-300 line-clamp-2 leading-relaxed font-normal">${escapeHtml(arc.description)}</p>
        ` : '')}

        <!-- Completeness Indicator -->
        <div class="mt-auto pt-3 border-t border-gray-800">
          <div class="flex justify-between items-center text-xs mb-1.5 font-semibold">
            <span class="flex items-center gap-1.5 ${isComplete ? 'text-emerald-400' : 'text-amber-400'}">
              <span>${isComplete ? '✓ Complete Arc in Library' : `⚠️ ${arc.missingCount} Issues Missing`}</span>
            </span>
            <span class="${isComplete ? 'text-emerald-400' : 'text-amber-400'}">${arc.ownedCount}/${arc.totalIssues} Owned</span>
          </div>
          <div class="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-300 ${isComplete ? 'bg-linear-to-r from-emerald-500 to-teal-400' : 'bg-linear-to-r from-amber-500 to-orange-500'}" style="width: ${arc.completenessPercent}%;"></div>
          </div>
        </div>
      </div>
    `);

    // Wire card click to open Story Arc Detail View
    card.classList.add('cursor-pointer');
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const fn = state.showStoryArcDetail || (typeof window !== 'undefined' && window.showStoryArcDetail) || showStoryArcDetail;
      if (typeof fn === 'function') {
        fn(arc.id, arc.title, 'grid');
      }
    });

    // Wire timeline button to open directly in DAG mode
    const timelineBtn = card.querySelector('.arc-timeline-btn');
    if (timelineBtn) {
      timelineBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fn = state.showStoryArcDetail || (typeof window !== 'undefined' && window.showStoryArcDetail) || showStoryArcDetail;
        if (typeof fn === 'function') {
          fn(arc.id, arc.title, 'dag');
        } else if (typeof window !== 'undefined' && typeof window.openArcTimelineModal === 'function') {
          window.openArcTimelineModal(arc.id, arc.title);
        }
      });
    }

    container.appendChild(card);
  }
}
