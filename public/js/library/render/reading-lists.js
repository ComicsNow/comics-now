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

export function renderPublisherReadingLists(publisherName) {
  const container = document.getElementById('series-list-container');
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

  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' && window.LibrarySmartLists) || {};
  const readingLists = typeof SmartLists.getReadingListsForPublisher === 'function'
    ? SmartLists.getReadingListsForPublisher(publisherName)
    : [];

  if (readingLists.length === 0) {
    const msg = `No reading lists available for ${publisherName}.`;
    renderContent(container, createEmptyMessage(msg));
    const backToSeriesBtn = document.createElement('button');
    backToSeriesBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
    backToSeriesBtn.textContent = '← Back to Series';
    backToSeriesBtn.addEventListener('click', () => {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
      (state.showSeriesList || (typeof window !== 'undefined' && window.showSeriesList))?.(publisherName, { force: true });
    });
    container.appendChild(backToSeriesBtn);
    return;
  }

  for (const list of readingLists) {
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

    container.appendChild(card);
  }
}
