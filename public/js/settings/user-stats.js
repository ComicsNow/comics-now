import { state, escapeHtml } from '../globals.js';
import { formatTimestamp } from './shared.js';

// --- USER READING STATS ---
// Derived from saved reading progress (no time telemetry). Shows opened /
// completed / in-progress counts, active days, a per-day activity bar chart,
// and recent activity. Mirrors the show/hide pattern of showUserAccessView.

function statusBadge(status) {
  const map = {
    completed: ['Completed', 'bg-green-600/20 text-green-300'],
    in_progress: ['In progress', 'bg-yellow-600/20 text-yellow-300'],
    opened: ['Opened', 'bg-gray-600/30 text-gray-300']
  };
  const [label, cls] = map[status] || map.opened;
  return `<span class="px-2 py-0.5 text-xs font-semibold rounded-full ${cls}">${label}</span>`;
}

function summaryCard(label, value, accent) {
  return `
    <div class="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
      <div class="text-3xl font-bold ${accent}">${value}</div>
      <div class="text-xs uppercase tracking-wider text-gray-400 mt-1">${label}</div>
    </div>`;
}

function renderBarChart(perDay) {
  const max = Math.max(1, ...perDay.map(d => d.comics));
  const bars = perDay.map(d => {
    const pct = Math.round((d.comics / max) * 100);
    const h = d.comics > 0 ? Math.max(6, pct) : 2;
    const color = d.comics > 0 ? 'bg-purple-500' : 'bg-gray-700';
    return `<div class="flex-1 flex flex-col justify-end items-center group relative" style="min-width:3px">
        <div class="${color} w-full rounded-t transition-all" style="height:${h}%"
             title="${d.day}: ${d.comics} comic${d.comics === 1 ? '' : 's'}"></div>
      </div>`;
  }).join('');
  const first = perDay[0]?.day || '';
  const last = perDay[perDay.length - 1]?.day || '';
  return `
    <div class="h-32 flex items-end gap-px bg-gray-900/40 rounded-lg p-2 border border-gray-700/40">${bars}</div>
    <div class="flex justify-between text-[10px] text-gray-500 mt-1 px-1">
      <span>${first}</span><span>${last}</span>
    </div>`;
}

const PAGE_SIZE = 5;

// One activity item. Uses a stacking flex layout instead of table cells so it
// reflows cleanly on narrow screens: comic name on top, meta below on mobile;
// name left / meta right inline on sm+.
function recentRowHtml(r) {
  const page = r.totalPages ? `${r.lastReadPage + 1}/${r.totalPages}` : '—';
  return `
    <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-2.5 border-t border-gray-700/40">
      <div class="flex-1 min-w-0">
        <div class="truncate text-gray-200 text-sm">${escapeHtml(r.name)}</div>
        ${r.series ? `<div class="truncate text-xs text-gray-500">${escapeHtml(r.series)}</div>` : ''}
      </div>
      <div class="flex items-center gap-3 text-xs shrink-0">
        <span class="text-gray-400 whitespace-nowrap w-12">${page}</span>
        ${statusBadge(r.status)}
        <span class="text-gray-500 whitespace-nowrap">${formatTimestamp(r.updatedAt)}</span>
      </div>
    </div>`;
}

// Client-side pagination (5/page) with prev/next controls.
function setupRecentPagination(root, recent) {
  const listEl = root.querySelector('#stats-recent-list');
  const pagerEl = root.querySelector('#stats-recent-pager');
  const countEl = root.querySelector('#stats-recent-count');
  if (!listEl) return;

  if (!recent.length) {
    listEl.innerHTML = '<p class="py-4 text-center text-gray-500 text-sm">No reading activity yet</p>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(recent.length / PAGE_SIZE);
  let page = 0;
  if (countEl) countEl.textContent = `${recent.length} item${recent.length === 1 ? '' : 's'}`;

  const render = () => {
    const start = page * PAGE_SIZE;
    listEl.innerHTML = recent.slice(start, start + PAGE_SIZE).map(recentRowHtml).join('');

    if (totalPages <= 1) { pagerEl.innerHTML = ''; return; }
    pagerEl.innerHTML = `
      <button id="stats-prev" class="px-3 py-1 text-xs rounded-lg bg-gray-700/60 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors" ${page === 0 ? 'disabled' : ''}>‹ Prev</button>
      <span class="text-xs text-gray-400">Page ${page + 1} of ${totalPages}</span>
      <button id="stats-next" class="px-3 py-1 text-xs rounded-lg bg-gray-700/60 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors" ${page >= totalPages - 1 ? 'disabled' : ''}>Next ›</button>`;
    const prev = pagerEl.querySelector('#stats-prev');
    const next = pagerEl.querySelector('#stats-next');
    if (prev) prev.addEventListener('click', () => { if (page > 0) { page--; render(); } });
    if (next) next.addEventListener('click', () => { if (page < totalPages - 1) { page++; render(); } });
  };
  render();
}

export async function showUserStatsView(userId, userEmail) {
  const usersListDiv = state.usersListDiv || window.usersListDiv;
  if (usersListDiv) usersListDiv.classList.add('hidden');

  const view = document.createElement('div');
  view.id = 'user-stats-view';
  view.className = 'bg-gradient-to-r from-blue-900/30 to-purple-900/30 border-2 border-blue-700/50 rounded-xl p-6 shadow-lg';
  view.innerHTML = `
    <button id="back-to-users-from-stats" class="flex items-center text-gray-400 hover:text-white transition-colors mb-4 group">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-1 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      Back to Users
    </button>
    <h3 class="text-xl font-bold text-white mb-1">Reading Stats — ${escapeHtml(userEmail)}</h3>
    <p class="text-sm text-gray-400 mb-6">Derived from saved reading progress (last 30 days for activity).</p>
    <div id="user-stats-body" class="text-gray-300">Loading…</div>
  `;

  if (usersListDiv && usersListDiv.parentElement) {
    usersListDiv.parentElement.appendChild(view);
  }

  const back = () => {
    view.remove();
    if (usersListDiv) usersListDiv.classList.remove('hidden');
  };
  view.querySelector('#back-to-users-from-stats').addEventListener('click', back);

  const body = view.querySelector('#user-stats-body');
  try {
    const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
    const res = await fetch(`${apiBaseUrl}/api/v1/users/${encodeURIComponent(userId)}/stats?days=30`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Failed to load stats');

    const s = data.summary;

    body.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        ${summaryCard('Opened', s.opened, 'text-blue-300')}
        ${summaryCard('Completed', s.completed, 'text-green-300')}
        ${summaryCard('In progress', s.inProgress, 'text-yellow-300')}
        ${summaryCard('Active days', s.activeDays, 'text-purple-300')}
      </div>
      <div class="mb-6">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold text-gray-300">Daily activity (comics touched)</span>
          <span class="text-xs text-gray-500">Last active: ${s.lastActive ? formatTimestamp(s.lastActive) : 'never'}</span>
        </div>
        ${renderBarChart(data.perDay)}
      </div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold text-gray-300">Recent activity</span>
          <span id="stats-recent-count" class="text-xs text-gray-500"></span>
        </div>
        <div id="stats-recent-list"></div>
        <div id="stats-recent-pager" class="flex items-center justify-between mt-3"></div>
      </div>
      <p class="text-xs text-gray-600 mt-4 italic">${escapeHtml(data.note || '')}</p>
    `;

    setupRecentPagination(body, data.recent || []);
  } catch (error) {
    body.innerHTML = `<p class="text-red-400 py-4">Failed to load stats: ${escapeHtml(error.message)}</p>`;
  }
}

state.showUserStatsView = showUserStatsView;
if (typeof window !== 'undefined') {
  window.showUserStatsView = showUserStatsView;
}
