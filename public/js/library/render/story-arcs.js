/**
 * Comics Now! - Story Arcs Smart Filter View
 *
 * Dedicated renderer for Story Arcs with Gold/Amber comic box-set trade dress,
 * Quick Edition filter pills, and dual Library & Read status indicators.
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
import {
  getStoryArcsForPublisher,
  fetchStoryArcsForPublisher,
  getAllStoryArcs,
  fetchAllStoryArcs
} from '../smartlists/story-arcs.js';
import { showStoryArcDetail } from '../story-arcs-detail.js';
import { getStoryArcEditionPreference } from '../../settings/story-arc-reader-settings.js';

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

let activeStoryArcStatusFilter = 'in-progress';

export function filterStoryArcsByStatus(arcs, status = 'in-progress') {
  if (!Array.isArray(arcs)) return [];
  if (status === 'all') return arcs;

  return arcs.filter((arc) => {
    const isCol = arc.edition === 'collection';
    const totalCount = isCol ? (arc.totalCollections || 0) : (arc.totalIssues || 0);
    const ownedCount = arc.ownedCount || 0;
    const readCount = arc.readCount || 0;
    const readingCount = arc.readStatusCounts?.reading || 0;
    const isComplete = (readCount > 0 && totalCount > 0 && readCount >= totalCount) ||
                       (arc.readPercent === 100) ||
                       (ownedCount > 0 && arc.completenessPercent === 100 && readCount >= ownedCount);

    switch (status) {
      case 'in-progress':
        return (readingCount > 0 || (readCount > 0 && !isComplete)) && ownedCount > 0;
      case 'unread':
        // "unread should only include those story arcs where you have at least one comic from your library in there and you have not started or completed any of them"
        return ownedCount > 0 && readCount === 0 && readingCount === 0;
      case 'not-in-library':
        return ownedCount === 0;
      case 'completed':
        return isComplete;
      default:
        return true;
    }
  });
}

function renderStoryArcsFilterBar(parent, storyArcs, onSelect) {
  let bar = document.getElementById('story-arcs-status-filter');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'story-arcs-status-filter';
    if (parent.parentNode) {
      parent.parentNode.insertBefore(bar, parent);
    }
  }
  bar.className = 'flex items-center gap-1.5 sm:gap-2 flex-wrap mb-5 px-1 text-xs';
  bar.innerHTML = '';

  const counts = {
    'in-progress': filterStoryArcsByStatus(storyArcs, 'in-progress').length,
    'unread': filterStoryArcsByStatus(storyArcs, 'unread').length,
    'completed': filterStoryArcsByStatus(storyArcs, 'completed').length,
    'not-in-library': filterStoryArcsByStatus(storyArcs, 'not-in-library').length,
    'all': storyArcs.length,
  };

  const filters = [
    { id: 'in-progress', label: `📖 In Progress (${counts['in-progress']})` },
    { id: 'unread', label: `📁 Unread (${counts.unread})` },
    { id: 'completed', label: `✓ Completed (${counts.completed})` },
    { id: 'not-in-library', label: `⚠️ Not in Library (${counts['not-in-library']})` },
    { id: 'all', label: `All (${counts.all})` },
  ];

  const activeCls = 'px-3 py-1.5 rounded-full font-extrabold text-xs transition-all shadow-md cursor-pointer active bg-amber-500 text-black';
  const inactiveCls = 'px-3 py-1.5 rounded-full font-bold text-xs transition-all cursor-pointer bg-gray-900/90 text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-800';

  filters.forEach((f) => {
    const btn = document.createElement('button');
    btn.dataset.status = f.id;
    btn.className = activeStoryArcStatusFilter === f.id ? activeCls : inactiveCls;
    btn.textContent = f.label;
    btn.onclick = () => {
      activeStoryArcStatusFilter = f.id;
      renderStoryArcsFilterBar(parent, storyArcs, onSelect);
      if (typeof onSelect === 'function') onSelect(f.id);
    };
    bar.appendChild(btn);
  });
}

export async function renderPublisherStoryArcs(publisherName = null, containerOverride = null) {
  const container = containerOverride || (state.currentView === 'publishers' ? document.getElementById('publisher-list-container') : document.getElementById('series-list-container'));
  if (!container) return;
  container.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5';
  clear(container);

  const modeToggle = document.getElementById('smart-scope-mode-toggle');
  if (modeToggle) {
    modeToggle.classList.add('hidden');
  }

  const seriesAlphaFilter = document.getElementById('series-alpha-filter');
  if (seriesAlphaFilter) {
    clear(seriesAlphaFilter);
  }
  const publisherAlphaFilter = document.getElementById('publisher-alpha-filter');
  if (publisherAlphaFilter) {
    clear(publisherAlphaFilter);
  }

  const currentEdition = getStoryArcEditionPreference();

  let storyArcs = [];
  if (publisherName) {
    storyArcs = getStoryArcsForPublisher(publisherName, currentEdition);
    if (storyArcs.length === 0) {
      storyArcs = await fetchStoryArcsForPublisher(publisherName, currentEdition);
    }
  } else {
    storyArcs = getAllStoryArcs(currentEdition);
    if (storyArcs.length === 0) {
      storyArcs = await fetchAllStoryArcs(currentEdition);
    }
  }

  if (storyArcs.length === 0) {
    const existingBar = document.getElementById('story-arcs-status-filter');
    if (existingBar) existingBar.remove();

    const edLabel = currentEdition === 'both' ? 'All Editions' : currentEdition === 'collections' ? 'Collected Volumes' : 'Single Issues';
    const msg = publisherName
      ? `No story arcs found for ${publisherName} (${edLabel}).`
      : `No story arcs found in library (${edLabel}).`;
    renderContent(container, createEmptyMessage(msg));

    const backBtn = document.createElement('button');
    backBtn.className = 'mt-4 text-amber-400 hover:text-amber-300 font-medium text-sm flex items-center gap-1 cursor-pointer';
    backBtn.textContent = publisherName
      ? `← Back to ${publisherName} Series`
      : (state.currentRootFolder ? '← Back to Publishers' : '← Back to Libraries');
    backBtn.addEventListener('click', () => {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
      container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6';
      const existingBar = document.getElementById('story-arcs-status-filter');
      if (existingBar) existingBar.remove();
      if (publisherName) {
        (state.showSeriesList || (typeof window !== 'undefined' && window.showSeriesList))?.(publisherName, { force: true });
      } else if (state.currentRootFolder) {
        (state.showPublisherList || (typeof window !== 'undefined' && window.showPublisherList))?.(state.currentRootFolder, { force: true });
      } else {
        (state.showRootFolderList || (typeof window !== 'undefined' && window.showRootFolderList))?.({ force: true });
      }
    });
    container.appendChild(backBtn);
    return;
  }

  const renderCards = () => {
    clear(container);
    const filteredArcs = filterStoryArcsByStatus(storyArcs, activeStoryArcStatusFilter);

    if (filteredArcs.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'col-span-full py-16 text-center text-gray-400 text-sm flex flex-col items-center gap-3 bg-gray-900/40 rounded-2xl border border-gray-800 p-6';

      let emptyTitle = `No story arcs in "${activeStoryArcStatusFilter}".`;
      let emptyHint = 'Try selecting another status filter above.';
      if (activeStoryArcStatusFilter === 'in-progress') {
        emptyTitle = 'No story arcs currently in progress.';
        emptyHint = 'Select "Unread" to start reading an arc from your library.';
      } else if (activeStoryArcStatusFilter === 'unread') {
        emptyTitle = 'No unread story arcs in library.';
        emptyHint = 'All owned story arcs are either completed or in progress.';
      } else if (activeStoryArcStatusFilter === 'completed') {
        emptyTitle = 'No completed story arcs yet.';
        emptyHint = 'Finish all issues in a storyline to see it here.';
      } else if (activeStoryArcStatusFilter === 'not-in-library') {
        emptyTitle = 'All indexed story arcs have at least one comic in your library.';
      }

      emptyDiv.innerHTML = `
        <span class="text-3xl opacity-60">⚡</span>
        <h4 class="text-base font-extrabold text-white">${emptyTitle}</h4>
        <p class="text-xs text-gray-400 max-w-sm">${emptyHint}</p>
      `;

      // Quick jump action buttons
      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-2 mt-2';
      const unreadCount = filterStoryArcsByStatus(storyArcs, 'unread').length;
      if (activeStoryArcStatusFilter !== 'unread' && unreadCount > 0) {
        const jumpUnread = document.createElement('button');
        jumpUnread.className = 'px-3 py-1.5 rounded-lg bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 cursor-pointer shadow-sm';
        jumpUnread.textContent = `Browse Unread (${unreadCount})`;
        jumpUnread.onclick = () => {
          activeStoryArcStatusFilter = 'unread';
          renderStoryArcsFilterBar(container, storyArcs, renderCards);
          renderCards();
        };
        actions.appendChild(jumpUnread);
      }
      if (activeStoryArcStatusFilter !== 'all') {
        const jumpAll = document.createElement('button');
        jumpAll.className = 'px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs font-semibold hover:bg-gray-700 cursor-pointer border border-gray-700';
        jumpAll.textContent = `View All (${storyArcs.length})`;
        jumpAll.onclick = () => {
          activeStoryArcStatusFilter = 'all';
          renderStoryArcsFilterBar(container, storyArcs, renderCards);
          renderCards();
        };
        actions.appendChild(jumpAll);
      }
      emptyDiv.appendChild(actions);
      container.appendChild(emptyDiv);
      return;
    }

    for (const arc of filteredArcs) {
      const card = document.createElement('div');
      card.className = 'story-arc-card bg-gradient-to-b from-gray-900 via-gray-900 to-gray-950 rounded-2xl shadow-2xl overflow-hidden border border-amber-500/30 hover:border-amber-400/80 transition-all duration-300 group flex flex-col justify-between cursor-pointer';

      const isCollection = arc.edition === 'collection' || currentEdition === 'collections';
      const totalCount = isCollection ? (arc.totalCollections || 0) : (arc.totalIssues || 0);
      const unitLabel = isCollection ? 'Volumes' : 'Issues';
      const editionBadge = isCollection ? '📚 Collected Editions' : '⚡ Single Issues';
      const isComplete = arc.completenessPercent === 100;
      const thumbUrl = arc.coverImage || null;
      const hasRead = (arc.readCount || 0) > 0;
      const readPct = arc.readPercent || 0;

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
              ${editionBadge}
            </span>
            <div class="flex items-center gap-1.5 pointer-events-auto">
              <span class="text-xs px-2.5 py-0.5 rounded-full bg-black/70 text-amber-300 font-semibold backdrop-blur-sm border border-amber-500/30 shrink-0">
                ${totalCount} ${unitLabel.toLowerCase()}
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
              ${safeRaw(isCollection ? `<span>•</span><span class="text-amber-400 font-semibold">📚 ${arc.totalCollections} Volumes</span>` : (arc.totalCollections > 0 ? `<span>•</span><span class="text-amber-400 font-semibold">📚 ${arc.totalCollections} Volumes</span>` : ''))}
            </div>
          </div>
        </div>

        <!-- Card Body -->
        <div class="p-4 flex-1 flex flex-col justify-between gap-3">
          ${safeRaw(arc.description ? `
            <p class="text-xs sm:text-sm text-gray-300 line-clamp-2 leading-relaxed font-normal">${escapeHtml(arc.description)}</p>
          ` : '')}

          <div class="mt-auto space-y-2 pt-3 border-t border-gray-800">
            <!-- 1. Library Ownership Progress -->
            <div>
              <div class="flex justify-between items-center text-xs mb-1 font-semibold">
                <span class="flex items-center gap-1 ${isComplete ? 'text-emerald-400' : 'text-amber-400'}">
                  <span>📁 In Library</span>
                </span>
                <span class="${isComplete ? 'text-emerald-400' : 'text-amber-400'}">
                  ${arc.ownedCount}/${totalCount} ${unitLabel} In Library (${arc.completenessPercent}%)
                </span>
              </div>
              <div class="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-300 ${isComplete ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-amber-500 to-orange-500'}" style="width: ${arc.completenessPercent}%;"></div>
              </div>
            </div>

            <!-- 2. Reading Status Progress -->
            <div>
              <div class="flex justify-between items-center text-xs mb-1 font-semibold">
                <span class="flex items-center gap-1 ${hasRead ? 'text-sky-300' : 'text-gray-400'}">
                  <span>${hasRead ? '✓ Reading Progress' : 'Unread'}</span>
                </span>
                <span class="${hasRead ? 'text-sky-300' : 'text-gray-500'}">
                  ${arc.readCount || 0}/${arc.ownedCount || 0} ${unitLabel} Read (${readPct}%)
                </span>
              </div>
              <div class="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-300 bg-gradient-to-r from-sky-500 to-indigo-400" style="width: ${readPct}%;"></div>
              </div>
            </div>
          </div>
        </div>
      `);

      // Wire card click
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const fn = state.showStoryArcDetail || (typeof window !== 'undefined' && window.showStoryArcDetail) || showStoryArcDetail;
        if (typeof fn === 'function') {
          const targetArcId = arc.arcId || (arc.id ? arc.id.replace('__collections', '') : arc.id);
          const initialFormat = isCollection ? 'collections' : 'issues';
          fn(targetArcId, arc.title, 'grid', initialFormat);
        }
      });

      container.appendChild(card);
    }
  };

  renderStoryArcsFilterBar(container, storyArcs, renderCards);
  renderCards();
}
