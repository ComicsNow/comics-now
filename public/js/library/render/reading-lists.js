import {
  state,
  clearElement,
  render,
  html,
  raw,
  escapeHtml,
  createEmptyMessage
} from '../../globals.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };
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

const API_BASE_URL = state.API_BASE_URL || (typeof window !== 'undefined' && window.API_BASE_URL) || '';

let activeReadingListStatusFilter = 'in-progress';

export function filterReadingListsByStatus(lists, status = 'in-progress') {
  if (!Array.isArray(lists)) return [];
  if (status === 'all') return lists;

  return lists.filter((list) => {
    const totalComics = list.totalComics || 0;
    const readComics = list.readComics || 0;
    const progressPercent = list.progressPercent || (totalComics > 0 ? Math.round((readComics / totalComics) * 100) : 0);
    const isComplete = (totalComics > 0 && readComics >= totalComics) || progressPercent === 100;

    switch (status) {
      case 'in-progress':
        return readComics > 0 && !isComplete;
      case 'unread':
        return readComics === 0;
      case 'completed':
        return isComplete;
      default:
        return true;
    }
  });
}

function renderReadingListsFilterBar(parent, readingLists, onSelect) {
  let bar = document.getElementById('reading-lists-status-filter');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'reading-lists-status-filter';
    if (parent.parentNode) {
      parent.parentNode.insertBefore(bar, parent);
    }
  }
  bar.className = 'flex items-center gap-1.5 sm:gap-2 flex-wrap mb-5 px-1 text-xs';
  bar.innerHTML = '';

  const counts = {
    'in-progress': filterReadingListsByStatus(readingLists, 'in-progress').length,
    'unread': filterReadingListsByStatus(readingLists, 'unread').length,
    'completed': filterReadingListsByStatus(readingLists, 'completed').length,
    'all': readingLists.length,
  };

  const filters = [
    { id: 'in-progress', label: `📖 In Progress (${counts['in-progress']})` },
    { id: 'unread', label: `📁 Unread (${counts.unread})` },
    { id: 'completed', label: `✓ Completed (${counts.completed})` },
    { id: 'all', label: `All (${counts.all})` },
  ];

  const activeCls = 'px-3 py-1.5 rounded-full font-extrabold text-xs transition-all shadow-md cursor-pointer active bg-purple-600 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded-full font-bold text-xs transition-all cursor-pointer bg-gray-900/90 text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-800';

  filters.forEach((f) => {
    const btn = document.createElement('button');
    btn.dataset.status = f.id;
    btn.className = activeReadingListStatusFilter === f.id ? activeCls : inactiveCls;
    btn.textContent = f.label;
    btn.onclick = () => {
      activeReadingListStatusFilter = f.id;
      renderReadingListsFilterBar(parent, readingLists, onSelect);
      if (typeof onSelect === 'function') onSelect(f.id);
    };
    bar.appendChild(btn);
  });
}

export function createReadingListCard(list, publisherName) {
  const card = document.createElement('div');
  card.className = 'reading-list-card bg-gray-800/90 hover:bg-gray-800 rounded-2xl shadow-xl overflow-hidden border border-gray-700/60 hover:border-purple-500/60 transition-all duration-300 group cursor-pointer flex flex-col justify-between';

  const progressPercent = list.progressPercent || (list.totalComics > 0 ? Math.round(((list.readComics || 0) / list.totalComics) * 100) : 0);
  const totalComics = list.totalComics || 0;
  const readComics = list.readComics || 0;
  const thumbUrl = list.thumbnailPath
    ? `${API_BASE_URL}/thumbnails/${encodeURIComponent(list.thumbnailPath)}`
    : null;
  const publisherText = (list.publishers && list.publishers.length > 0)
    ? list.publishers.slice(0, 2).join(', ')
    : (publisherName || 'Reading List');

  renderContent(card, safeHtml`
    <div class="relative h-48 sm:h-52 w-full overflow-hidden bg-black/40">
      ${safeRaw(thumbUrl ? `
        <img src="${thumbUrl}" alt="${escapeHtml(list.name)}" class="w-full h-full object-cover object-top opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" loading="lazy">
      ` : `
        <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-950/60 via-gray-900 to-gray-950">
          <span class="text-4xl opacity-30 group-hover:scale-110 transition-transform">📚</span>
        </div>
      `)}
      <div class="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/40 to-transparent"></div>

      <div class="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
        <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-600/90 text-white backdrop-blur-sm shadow">${publisherText}</span>
        <div class="flex items-center gap-1.5 pointer-events-auto">
          <button class="reading-list-dag-btn px-2.5 py-1 rounded-full bg-purple-900/80 hover:bg-purple-600 text-purple-200 hover:text-white font-semibold text-xs border border-purple-500/40 backdrop-blur-md transition-all flex items-center gap-1 shadow cursor-pointer" title="View Continuity DAG">
            <span>🔀</span>
            <span>DAG</span>
          </button>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-black/60 text-purple-300 font-semibold backdrop-blur-sm border border-white/10 shrink-0">
            ${totalComics} ${totalComics === 1 ? 'comic' : 'comics'}
          </span>
        </div>
      </div>

      <div class="absolute bottom-3 left-3 right-3">
        <a href="#" class="reading-list-hotlink font-bold text-lg text-white group-hover:text-purple-300 transition-colors leading-snug line-clamp-1 block" title="Open ${escapeHtml(list.name)}">
          ${list.name}
        </a>
        <div class="text-xs text-gray-300 flex items-center gap-2 mt-1">
          <span>${totalComics} ${totalComics === 1 ? 'issue' : 'issues'}</span>
          ${safeRaw(list.seriesCount ? `<span>•</span><span>${list.seriesCount} ${list.seriesCount === 1 ? 'series' : 'series'}</span>` : '')}
        </div>
      </div>
    </div>

    <div class="p-4 flex-1 flex flex-col justify-between gap-3">
      ${safeRaw(list.description ? `<p class="text-xs sm:text-sm text-gray-400 line-clamp-2 leading-relaxed">${escapeHtml(list.description)}</p>` : '')}

      <div class="mt-auto pt-2 border-t border-gray-700/50">
        <div class="flex justify-between items-center text-xs text-gray-400 mb-1.5 font-medium">
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${progressPercent === 100 ? 'bg-green-400' : progressPercent > 0 ? 'bg-purple-400' : 'bg-gray-500'}"></span>
            <span>${readComics} of ${totalComics} read</span>
          </span>
          <span class="font-bold ${progressPercent === 100 ? 'text-green-400' : 'text-purple-400'}">${progressPercent}%</span>
        </div>
        <div class="w-full bg-gray-700/80 h-2 rounded-full overflow-hidden">
          <div class="bg-linear-to-r from-purple-500 to-indigo-500 h-full rounded-full transition-all duration-300" style="width: ${progressPercent}%;"></div>
        </div>
      </div>
    </div>
  `);

  const openListHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const openModal = state.openReadingListModal || (typeof window !== 'undefined' && window.openReadingListModal);
    const showDetail = state.showReadingListDetail || (typeof window !== 'undefined' && window.showReadingListDetail);
    if (typeof openModal === 'function') openModal();
    if (typeof showDetail === 'function') showDetail(list.id, list.name);
  };

  const dagBtn = card.querySelector('.reading-list-dag-btn');
  if (dagBtn) {
    dagBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const openModal = state.openReadingListModal || (typeof window !== 'undefined' && window.openReadingListModal);
      const showDetail = state.showReadingListDetail || (typeof window !== 'undefined' && window.showReadingListDetail);
      if (typeof openModal === 'function') openModal();
      if (typeof showDetail === 'function') showDetail(list.id, list.name, 'dag');
    });
  }

  card.addEventListener('click', openListHandler);
  const hotlink = card.querySelector('.reading-list-hotlink');
  if (hotlink) hotlink.addEventListener('click', openListHandler);

  return card;
}

export function renderPublisherReadingLists(publisherName = null, containerOverride = null) {
  const container = containerOverride || (state.currentView === 'publishers' ? document.getElementById('publisher-list-container') : document.getElementById('series-list-container'));
  if (!container) return;
  container.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';
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

  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' && window.LibrarySmartLists) || {};
  let readingLists = [];
  if (publisherName) {
    readingLists = typeof SmartLists.getReadingListsForPublisher === 'function'
      ? SmartLists.getReadingListsForPublisher(publisherName)
      : [];
  } else {
    readingLists = typeof SmartLists.getCachedReadingLists === 'function'
      ? SmartLists.getCachedReadingLists()
      : [];
  }

  if (readingLists.length === 0) {
    const existingBar = document.getElementById('reading-lists-status-filter');
    if (existingBar) existingBar.remove();

    const msg = publisherName
      ? `No reading lists available for ${publisherName}.`
      : 'No reading lists found in library.';
    renderContent(container, createEmptyMessage(msg));
    const backBtn = document.createElement('button');
    backBtn.className = 'mt-4 text-purple-400 hover:text-purple-300 font-medium text-sm flex items-center gap-1 cursor-pointer';
    backBtn.textContent = publisherName
      ? `← Back to ${publisherName} Series`
      : (state.currentRootFolder ? '← Back to Publishers' : '← Back to Libraries');
    backBtn.addEventListener('click', () => {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
      container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6';
      const bar = document.getElementById('reading-lists-status-filter');
      if (bar) bar.remove();
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
    const filteredLists = filterReadingListsByStatus(readingLists, activeReadingListStatusFilter);

    if (filteredLists.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'col-span-full py-16 text-center text-gray-400 text-sm flex flex-col items-center gap-3 bg-gray-900/40 rounded-2xl border border-gray-800 p-6';

      let emptyTitle = `No reading lists in "${activeReadingListStatusFilter}".`;
      let emptyHint = 'Try selecting another status filter above.';
      if (activeReadingListStatusFilter === 'in-progress') {
        emptyTitle = 'No reading lists currently in progress.';
        emptyHint = 'Select "Unread" to start reading a list.';
      } else if (activeReadingListStatusFilter === 'unread') {
        emptyTitle = 'No unread reading lists.';
        emptyHint = 'All reading lists are either completed or in progress.';
      } else if (activeReadingListStatusFilter === 'completed') {
        emptyTitle = 'No completed reading lists yet.';
        emptyHint = 'Finish all issues in a reading list to see it here.';
      }

      emptyDiv.innerHTML = `
        <span class="text-3xl opacity-60">📚</span>
        <h4 class="text-base font-extrabold text-white">${emptyTitle}</h4>
        <p class="text-xs text-gray-400 max-w-sm">${emptyHint}</p>
      `;

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-2 mt-2';
      const unreadCount = filterReadingListsByStatus(readingLists, 'unread').length;
      if (activeReadingListStatusFilter !== 'unread' && unreadCount > 0) {
        const jumpUnread = document.createElement('button');
        jumpUnread.className = 'px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-bold hover:bg-purple-500 cursor-pointer shadow-sm';
        jumpUnread.textContent = `Browse Unread (${unreadCount})`;
        jumpUnread.onclick = () => {
          activeReadingListStatusFilter = 'unread';
          renderReadingListsFilterBar(container, readingLists, renderCards);
          renderCards();
        };
        actions.appendChild(jumpUnread);
      }
      if (activeReadingListStatusFilter !== 'all') {
        const jumpAll = document.createElement('button');
        jumpAll.className = 'px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs font-semibold hover:bg-gray-700 cursor-pointer border border-gray-700';
        jumpAll.textContent = `View All (${readingLists.length})`;
        jumpAll.onclick = () => {
          activeReadingListStatusFilter = 'all';
          renderReadingListsFilterBar(container, readingLists, renderCards);
          renderCards();
        };
        actions.appendChild(jumpAll);
      }
      emptyDiv.appendChild(actions);
      container.appendChild(emptyDiv);
      return;
    }

    for (const list of filteredLists) {
      container.appendChild(createReadingListCard(list, publisherName));
    }
  };

  renderReadingListsFilterBar(container, readingLists, renderCards);
  renderCards();
}
