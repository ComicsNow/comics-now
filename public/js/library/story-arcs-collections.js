/**
 * Comics Now! - Story Arc Collected Editions Detail Views
 *
 * Dedicated renderer for collected Trade Paperbacks & Hardcovers with visual read status:
 * '✓ Read', '📖 Reading', '📁 In Library', '⚠️ Missing', and Quick Filter Pills.
 */
import { escapeHtml } from '../globals.js';
import { launchComicReader } from '../dag/interactions.js';

let activeFilterStatus = 'all'; // 'all' | 'owned' | 'read' | 'reading' | 'unread' | 'missing'

export function renderCollectionsFilterBar(container, collections, onFilterChange) {
  if (!container) return;
  const counts = {
    all: collections.length,
    owned: collections.filter((c) => c.owned).length,
    read: collections.filter((c) => c.readStatus === 'read').length,
    reading: collections.filter((c) => c.readStatus === 'reading').length,
    missing: collections.filter((c) => !c.owned || c.readStatus === 'missing').length,
  };

  const bar = document.createElement('div');
  bar.className = 'flex items-center gap-1.5 flex-wrap pb-4 mb-4 border-b border-gray-800 text-xs';

  const filters = [
    { id: 'all', label: `All (${counts.all})` },
    { id: 'owned', label: `📁 In Library (${counts.owned})` },
    { id: 'read', label: `✓ Read (${counts.read})` },
    { id: 'reading', label: `📖 Reading (${counts.reading})` },
    { id: 'missing', label: `⚠️ Missing (${counts.missing})` },
  ];

  filters.forEach((f) => {
    const btn = document.createElement('button');
    btn.className = `px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer ${
      activeFilterStatus === f.id
        ? 'bg-amber-500 text-black shadow-xs'
        : 'bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-800'
    }`;
    btn.textContent = f.label;
    btn.addEventListener('click', () => {
      activeFilterStatus = f.id;
      if (typeof onFilterChange === 'function') onFilterChange(f.id);
    });
    bar.appendChild(btn);
  });

  container.appendChild(bar);
}

export function renderCollectionsGridView(modal, collections, onComicClick) {
  const container = modal.querySelector('#story-arc-collections-grid-view');
  if (!container) return;
  container.innerHTML = '';

  renderCollectionsFilterBar(container, collections, () => {
    renderCollectionsGridView(modal, collections, onComicClick);
    renderCollectionsChecklistView(modal, collections, onComicClick);
  });

  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4';

  const filtered = filterCollections(collections, activeFilterStatus);

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'col-span-full py-12 text-center text-gray-500 text-sm';
    empty.textContent = `No collected volumes found for filter: "${activeFilterStatus}".`;
    cardsContainer.appendChild(empty);
    container.appendChild(cardsContainer);
    return;
  }

  filtered.forEach((col) => {
    const isOwned = Boolean(col.owned);
    const card = document.createElement('div');
    card.className = 'story-arc-col-card group relative flex flex-col rounded-xl overflow-hidden shadow-lg border transition-all duration-200';

    if (isOwned) {
      card.classList.add('bg-gray-900', 'border-gray-700', 'hover:border-amber-400', 'hover:scale-[1.02]', 'cursor-pointer');
    } else {
      card.classList.add('bg-gray-950/80', 'border-dashed', 'border-amber-500/40', 'opacity-75');
    }

    const badgeHtml = getReadStatusBadge(col.readStatus, col.lastReadPage, col.pageCount);

    card.innerHTML = `
      <div class="relative w-full aspect-[13/20] bg-black overflow-hidden">
        ${col.coverImageUrl ? `
          <img src="${col.coverImageUrl}" alt="${escapeHtml(col.title)}" class="w-full h-full object-cover">
        ` : `
          <div class="w-full h-full flex items-center justify-center text-amber-500/40 text-3xl font-extrabold">📚</div>
        `}
        <div class="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 backdrop-blur-xs text-[10px] font-bold text-amber-400 border border-amber-400/30">
          Vol #${col.position}
        </div>
        <div class="absolute top-2 right-2">
          ${badgeHtml}
        </div>
      </div>
      <div class="p-3 flex flex-col justify-between flex-1 gap-2">
        <div>
          <div class="text-[11px] font-bold text-white line-clamp-1 group-hover:text-amber-300 transition-colors">
            ${escapeHtml(col.title)}
          </div>
          ${col.subtitle ? `
            <div class="text-[11px] text-amber-400/90 font-medium line-clamp-1 italic">${escapeHtml(col.subtitle)}</div>
          ` : ''}
          ${col.contentsRaw ? `
            <div class="text-[10px] text-gray-400 line-clamp-2 mt-1 leading-relaxed">${escapeHtml(col.contentsRaw)}</div>
          ` : ''}
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-gray-800/80 text-[10px] text-gray-400">
          <span>${col.releaseYear ? `Year: ${col.releaseYear}` : ''}</span>
          ${isOwned && col.comicId ? `
            <button class="col-read-btn px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold transition-colors cursor-pointer shadow-xs">
              ${col.readStatus === 'read' ? 'Re-read ↺' : 'Read ▶'}
            </button>
          ` : `
            <span class="text-amber-500/60 font-semibold italic">Not in Library</span>
          `}
        </div>
      </div>
    `;

    if (isOwned && col.comicId) {
      card.addEventListener('click', () => {
        if (typeof onComicClick === 'function') {
          onComicClick(col);
        } else if (typeof launchComicReader === 'function') {
          launchComicReader(col.comicId);
        }
      });
    }

    cardsContainer.appendChild(card);
  });

  container.appendChild(cardsContainer);
}

export function renderCollectionsChecklistView(modal, collections, onComicClick) {
  const container = modal.querySelector('#story-arc-collections-checklist-view');
  if (!container) return;
  container.innerHTML = '';

  renderCollectionsFilterBar(container, collections, () => {
    renderCollectionsGridView(modal, collections, onComicClick);
    renderCollectionsChecklistView(modal, collections, onComicClick);
  });

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'overflow-x-auto bg-gray-900/60 rounded-xl border border-gray-800';

  const filtered = filterCollections(collections, activeFilterStatus);

  tableWrapper.innerHTML = `
    <table class="w-full text-left text-xs sm:text-sm text-gray-300">
      <thead class="bg-gray-900 text-gray-400 uppercase text-[10px] tracking-wider border-b border-gray-800">
        <tr>
          <th class="py-3 px-4 w-12 text-center">Vol #</th>
          <th class="py-3 px-4">Volume & Collected Issues</th>
          <th class="py-3 px-4 hidden sm:table-cell">Year</th>
          <th class="py-3 px-4 text-center">Status</th>
          <th class="py-3 px-4 text-right">Action</th>
        </tr>
      </thead>
      <tbody id="story-arc-collections-checklist-tbody" class="divide-y divide-gray-800/60"></tbody>
    </table>
  `;

  const tbody = tableWrapper.querySelector('#story-arc-collections-checklist-tbody');

  filtered.forEach((col) => {
    const isOwned = Boolean(col.owned);
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-800/40 transition-colors';

    const badgeHtml = getReadStatusBadge(col.readStatus, col.lastReadPage, col.pageCount);

    tr.innerHTML = `
      <td class="py-2.5 px-4 text-center font-mono text-amber-400 font-bold">${col.position}</td>
      <td class="py-2.5 px-4 font-semibold text-white">
        <div class="flex items-center gap-2">
          <span>${escapeHtml(col.title)}</span>
          ${col.subtitle ? `<span class="text-xs text-amber-300 italic">— ${escapeHtml(col.subtitle)}</span>` : ''}
        </div>
        ${col.contentsRaw ? `<div class="text-[11px] text-gray-400 font-normal line-clamp-1">${escapeHtml(col.contentsRaw)}</div>` : ''}
      </td>
      <td class="py-2.5 px-4 hidden sm:table-cell text-gray-400 text-xs">${col.releaseYear || '—'}</td>
      <td class="py-2.5 px-4 text-center">
        ${badgeHtml}
      </td>
      <td class="py-2.5 px-4 text-right">
        ${isOwned && col.comicId ? `
          <button class="col-checklist-read-btn px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-xs transition-colors cursor-pointer">
            ${col.readStatus === 'read' ? 'Re-read ↺' : 'Read ▶'}
          </button>
        ` : `
          <span class="text-gray-500 text-xs italic">Unavailable</span>
        `}
      </td>
    `;

    if (isOwned && col.comicId) {
      const btn = tr.querySelector('.col-checklist-read-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          if (typeof onComicClick === 'function') {
            onComicClick(col);
          } else if (typeof launchComicReader === 'function') {
            launchComicReader(col.comicId);
          }
        });
      }
    }

    tbody.appendChild(tr);
  });

  container.appendChild(tableWrapper);
}

export function getReadStatusBadge(status, lastReadPage, totalPages) {
  if (status === 'read') {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 shadow-xs">✓ Read</span>`;
  }
  if (status === 'reading') {
    const pageText = totalPages > 0 ? `p. ${lastReadPage}/${totalPages}` : `p. ${lastReadPage}`;
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-950/90 text-sky-300 border border-sky-500/50 shadow-xs">📖 ${pageText}</span>`;
  }
  if (status === 'unread') {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/90 text-amber-300 border border-amber-500/50 shadow-xs">📁 In Library</span>`;
  }
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-gray-900/80 text-gray-400 border border-gray-700">⚠️ Missing</span>`;
}

export function filterCollections(collections, filter) {
  if (!filter || filter === 'all') return collections;
  if (filter === 'owned' || filter === 'library') return collections.filter((c) => c.owned);
  if (filter === 'read') return collections.filter((c) => c.readStatus === 'read');
  if (filter === 'reading') return collections.filter((c) => c.readStatus === 'reading');
  if (filter === 'unread') return collections.filter((c) => c.owned && c.readStatus === 'unread');
  if (filter === 'missing') return collections.filter((c) => !c.owned || c.readStatus === 'missing');
  return collections;
}

export function setActiveCollectionFilter(status) {
  activeFilterStatus = status;
}

export function getActiveCollectionFilter() {
  return activeFilterStatus;
}
