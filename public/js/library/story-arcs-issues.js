/**
 * Comics Now! - Story Arc Single Issues Detail Views
 *
 * Dedicated renderer for single issue reading order grid and checklist views
 * with visual read status indicators ('✓ Read', '📖 Reading', '📁 In Library', '⚠️ Missing').
 */
import { escapeHtml } from '../globals.js';
import { launchComicReader } from '../dag/interactions.js';
import { getReadStatusBadge } from './story-arcs-collections.js';

export function renderIssuesGridView(modal, issues, onIssueClick) {
  const container = modal.querySelector('#story-arc-grid-view');
  if (!container) return;
  container.innerHTML = '';

  if (!issues || issues.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'col-span-full py-12 text-center text-gray-500 text-sm';
    empty.textContent = 'No single issues found for this story arc.';
    container.appendChild(empty);
    return;
  }

  issues.forEach((iss) => {
    const isOwned = Boolean(iss.owned !== undefined ? iss.owned : iss.isOwned);
    const card = document.createElement('div');
    card.className = 'story-arc-issue-card group relative flex flex-col rounded-xl overflow-hidden shadow-lg border transition-all duration-200';
    if (isOwned) {
      card.classList.add('bg-gray-900', 'border-gray-700', 'hover:border-amber-400', 'hover:scale-[1.02]', 'cursor-pointer');
    } else {
      card.classList.add('bg-gray-950/80', 'border-dashed', 'border-amber-500/40', 'opacity-75');
    }

    const badgeHtml = getReadStatusBadge(iss.readStatus || (isOwned ? 'unread' : 'missing'), iss.lastReadPage, iss.pageCount);

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
        <div class="absolute top-2 right-2">
          ${badgeHtml}
        </div>
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
        if (typeof onIssueClick === 'function') {
          onIssueClick(iss);
        } else if (typeof launchComicReader === 'function') {
          launchComicReader(iss.comicId);
        }
      });
    }

    container.appendChild(card);
  });
}

export function renderIssuesChecklistView(modal, issues, onIssueClick) {
  const tbody = modal.querySelector('#story-arc-checklist-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!issues || issues.length === 0) return;

  issues.forEach((iss) => {
    const isOwned = Boolean(iss.owned !== undefined ? iss.owned : iss.isOwned);
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-800/40 transition-colors';

    const badgeHtml = getReadStatusBadge(iss.readStatus || (isOwned ? 'unread' : 'missing'), iss.lastReadPage, iss.pageCount);

    tr.innerHTML = `
      <td class="py-2.5 px-4 text-center font-mono text-amber-400 font-bold">${iss.position}</td>
      <td class="py-2.5 px-4 font-semibold text-white">
        ${escapeHtml(iss.seriesName)} <span class="text-amber-300">#${iss.issueNumber}</span>
      </td>
      <td class="py-2.5 px-4 hidden sm:table-cell text-gray-400 text-xs">${escapeHtml(iss.publicationDate || '—')}</td>
      <td class="py-2.5 px-4 text-xs text-gray-300">${escapeHtml(iss.storyParts || '—')}</td>
      <td class="py-2.5 px-4 text-center">
        ${badgeHtml}
      </td>
      <td class="py-2.5 px-4 text-right">
        ${isOwned && iss.comicId ? `
          <button class="read-btn px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs shadow-xs transition-colors cursor-pointer">
            ${iss.readStatus === 'read' ? 'Re-read ↺' : 'Read ▶'}
          </button>
        ` : `
          <span class="text-gray-500 text-xs italic">Unavailable</span>
        `}
      </td>
    `;

    if (isOwned && iss.comicId) {
      const readBtn = tr.querySelector('.read-btn');
      if (readBtn) {
        readBtn.addEventListener('click', () => {
          if (typeof onIssueClick === 'function') {
            onIssueClick(iss);
          } else if (typeof launchComicReader === 'function') {
            launchComicReader(iss.comicId);
          }
        });
      }
    }

    tbody.appendChild(tr);
  });
}
