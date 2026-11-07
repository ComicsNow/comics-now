import {
  state,
  clearElement,
  render,
  html,
  raw,
  escapeHtml,
  ctMatchBody,
  ctApplyBtn,
  ctSkipBtn,
  ctConfirmBar,
  ctConfirmMessage,
  ctConfirmYes,
  ctConfirmNo,
  ctTabMatches,
  ctMatchesBadge,
  global as canonicalGlobal
} from '../globals.js';
import { appendLocalCtLogLine } from './logging.js';
import { fetchCtScopeCounts } from './scan.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

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

const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
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

const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({
  __isRawHtml: true,
  html: String(v ?? '')
});

const escape = (typeof escapeHtml === 'function') ? escapeHtml : (str) => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

let lastRenderedFileName = null;
let isFetchingCtDetails = false;
let ctFetchDebounceTimer = null;
let isConfirmingCt = false;

export async function checkPendingMatch() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/pending`);
    if (res.status === 403) return;

    const pending = await res.json();

    if (pending && pending.waitingForResponse) {
      const indicator = document.createElement('div');
      indicator.id = 'ct-pending-indicator';
      indicator.className = 'bg-yellow-600 text-white px-4 py-2 rounded-lg mb-3 text-sm font-semibold';
      renderContent(indicator, safeHtml`⚠️ Review needed for: <strong>${pending.fileName}</strong> (since ${new Date(pending.timestamp).toLocaleTimeString()})`);

      const matchesContent = document.getElementById('ct-content-matches');
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) existingIndicator.remove();
      if (matchesContent) matchesContent.insertBefore(indicator, matchesContent.firstChild);

      if (ctMatchesBadge && !ctTabMatches?.classList.contains('active')) {
        ctMatchesBadge.classList.remove('hidden');
      }

      if (ctApplyBtn) ctApplyBtn.disabled = false;
      if (ctSkipBtn) ctSkipBtn.disabled = false;
    } else {
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) existingIndicator.remove();
      if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
      if (ctApplyBtn) ctApplyBtn.disabled = true;
      if (ctSkipBtn) ctSkipBtn.disabled = true;
    }
    return pending;
  } catch (error) {}
}

export function clearCtMatches() {
  if (ctMatchBody) clear(ctMatchBody);
  const previewContainer = document.getElementById('ct-preview-container');
  if (previewContainer) {
    clear(previewContainer);
    previewContainer.classList.add('hidden');
  }
  
  const noMatchesDiv = document.getElementById('ct-no-matches');
  const matchTable = document.getElementById('ct-match-table');
  if (noMatchesDiv) noMatchesDiv.classList.remove('hidden');
  if (matchTable) matchTable.classList.add('hidden');
  if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
  const existingIndicator = document.getElementById('ct-pending-indicator');
  if (existingIndicator) existingIndicator.remove();
  lastRenderedFileName = null;
}

export function debouncedFetchPendingMatchDetails() {
  if (ctFetchDebounceTimer) clearTimeout(ctFetchDebounceTimer);
  ctFetchDebounceTimer = setTimeout(() => {
    fetchPendingMatchDetails();
  }, 300);
}

export async function fetchPendingMatchDetails(isManual = false) {
  if (isFetchingCtDetails && !isManual) return;
  isFetchingCtDetails = true;

  try {
    const detailsRes = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/pending-details?_t=${Date.now()}`);
    if (!detailsRes.ok) throw new Error(`Status ${detailsRes.status}`);
    const details = await detailsRes.json();

    if (!details.waitingForResponse) {
      clearCtMatches();
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) existingIndicator.remove();
      if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
      return;
    }

    const matchesToRender = details.matches || [];

    if (details.fileName !== lastRenderedFileName) {
      clearCtMatches();
      const previewUrl = `${global.API_BASE_URL}/api/v1/tag-comics-now/preview?_t=${Date.now()}`;
      renderComicPreview(previewUrl, details.fileName);
      lastRenderedFileName = details.fileName;
    }

    let matchHtml = '';
    matchesToRender.forEach(match => {
      matchHtml += getCtMatchHtml(match);
    });

    const noMatchesDiv = document.getElementById('ct-no-matches');
    const matchTable = document.getElementById('ct-match-table');
    if (noMatchesDiv) noMatchesDiv.classList.add('hidden');
    if (matchTable) matchTable.classList.remove('hidden');
    
    if (ctMatchBody) renderContent(ctMatchBody, safeRaw(matchHtml));
  } catch (error) {
    console.error('[CT] Error fetching match details:', error);
  } finally {
    isFetchingCtDetails = false;
  }
}

export function getCtMatchHtml(match) {
  const meta = match.fullMetadata || {};
  const coverUrl = match.coverUrl || meta.cover_image_url || null;
  const score = match.score ? Math.round(match.score) : 85;
  const source = match.source || 'Online';
  const creators = [meta.writer, meta.penciller].filter(Boolean).join(', ');

  const sourceBadgeColors = {
    comicvine: 'bg-blue-900/60 text-blue-300 border-blue-700',
    metron: 'bg-purple-900/60 text-purple-300 border-purple-700',
    gcd: 'bg-green-900/60 text-green-300 border-green-700',
    lcg: 'bg-amber-900/60 text-amber-300 border-amber-700',
    goodreads: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
    blackwells: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
    waterstones: 'bg-indigo-900/60 text-indigo-300 border-indigo-700',
    googlebooks: 'bg-rose-900/60 text-rose-300 border-rose-700',
    google: 'bg-rose-900/60 text-rose-300 border-rose-700',
    amazon: 'bg-amber-900/60 text-amber-300 border-amber-700',
    amz: 'bg-amber-900/60 text-amber-300 border-amber-700'
  };
  const srcKey = (source || '').toLowerCase().replace(/[^a-z]/g, '');
  const badgeClass = sourceBadgeColors[srcKey] || 'bg-gray-800 text-gray-300 border-gray-600';

  return `
    <tr class="border-b border-gray-700 hover:bg-gray-800/80 transition-colors cursor-pointer" 
        onclick="const radio = this.querySelector('input[type=\\'radio\\']'); if (radio) radio.checked = true;">
      <td class="px-4 py-4 align-top w-12">
        <div class="flex items-center justify-center pt-2">
          <input type="radio"
                 name="ct-match-choice"
                 class="ct-match-select w-5 h-5 cursor-pointer accent-blue-500"
                 data-choice="${escape(match.choice)}"
                 id="match-${escape(match.choice)}"
                 ${match.choice === '1' ? 'checked' : ''}>
        </div>
      </td>
      <td class="py-4 pr-4">
        <div class="flex space-x-4">
          <div class="shrink-0 w-24">
            ${coverUrl
              ? `<img src="${escape(coverUrl)}" alt="Cover" class="w-full h-auto rounded border border-gray-700 shadow-md object-cover" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.classList.add('hidden'); this.nextElementSibling?.classList.remove('hidden');"><div class="hidden w-full h-32 rounded border border-gray-700 bg-gray-950 flex items-center justify-center text-[10px] text-gray-500 uppercase text-center p-1">No Cover</div>`
              : `<div class="w-full h-32 rounded border border-gray-700 bg-gray-950 flex items-center justify-center text-[10px] text-gray-600 uppercase text-center p-1">No Cover</div>`
            }
          </div>
          <label for="match-${escape(match.choice)}" class="flex-1 min-w-0 cursor-pointer">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-bold text-white text-base truncate">${escape(match.choice)}. ${escape(match.title)}</span>
              <span class="text-xs px-2 py-0.5 rounded border ${badgeClass} font-semibold">${escape(source)}</span>
              <span class="text-xs px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-800 font-bold">${score}% Match</span>
            </div>
            <div class="text-xs text-gray-300 space-y-1">
              <div><span class="text-gray-500">Publisher:</span> <span class="font-medium text-gray-200">${escape(match.publisher)}</span> ${match.year ? `• <span class="text-gray-400">Year: ${escape(match.year)}</span>` : ''} • <span class="text-gray-400">Issue #${escape(match.issue || '?')}</span></div>
              ${creators ? `<div><span class="text-gray-500">Creators:</span> <span class="text-gray-300">${escape(creators)}</span></div>` : ''}
              ${meta.story_arc ? `<div class="mt-1 flex items-center gap-1.5 flex-wrap"><span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 inline-flex items-center gap-1">📖 Arc: ${escape(meta.story_arc)}${meta.story_arc_number ? ` #${escape(meta.story_arc_number)}` : ''}</span>${meta.continuity_gemini_verified ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-950/80 text-teal-300 border border-teal-600/60 inline-flex items-center gap-1">✦ Gemini Verified Cover</span>` : ''}</div>` : ''}
              ${match.extra ? `<div class="italic text-gray-400 line-clamp-2 mt-1">${escape(match.extra)}</div>` : ''}
            </div>
          </label>
        </div>
      </td>
    </tr>`;
}

export function renderComicPreview(url, fileName) {
  const previewContainer = document.getElementById('ct-preview-container');
  if (!previewContainer) return;

  renderContent(previewContainer, safeHtml`
    <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700 flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-6">
      <div class="shrink-0">
        ${safeRaw(url 
          ? `<img src="${escape(url)}" class="w-40 h-auto rounded-lg shadow-xl border border-gray-600 object-cover" alt="Comic Preview">`
          : `<div class="w-40 h-56 rounded-lg bg-gray-950 flex items-center justify-center border border-dashed border-gray-700 text-gray-500 text-xs text-center px-2">Cover Preview</div>`
        )}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">Awaiting Review</div>
        <div class="text-lg font-bold text-white break-all mb-2">${escape(fileName)}</div>
        <p class="text-xs text-gray-400 mb-3">Multiple candidate matches were found across metadata sources. Select the best match below and click Apply.</p>
      </div>
    </div>
  `);
  previewContainer.classList.remove('hidden');
}

export function showCtConfirm(action) {
  if (!ctConfirmBar) return;
  ctConfirmBar.classList.remove('hidden');
  ctConfirmBar.dataset.action = action;
  if (ctConfirmMessage) {
    ctConfirmMessage.textContent = action === 'apply' ? 'Apply this match metadata to comic?' : 'Skip this comic?';
  }
  if (ctConfirmYes) ctConfirmYes.focus();
}

export async function handleCtConfirmYes() {
  if (isConfirmingCt) return;
  const action = ctConfirmBar?.dataset.action;
  isConfirmingCt = true;

  try {
    let res;
    if (action === 'apply') {
      const selected = document.querySelector('.ct-match-select:checked');
      const choice = selected ? selected.dataset.choice : '1';

      res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections: [choice] })
      });
    } else {
      res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/skip`, {
        method: 'POST'
      });
    }

    if (!res || !res.ok) {
      let detail = res ? `request failed (${res.status})` : 'network error';
      try {
        const data = await res.json();
        if (data && data.message) detail = data.message;
      } catch (_) {}
      appendLocalCtLogLine(`✗ Error: ${detail}`);
      return;
    }

    ctConfirmBar?.classList.add('hidden');
    clearCtMatches();
    fetchCtScopeCounts();
    setTimeout(() => checkPendingMatch(), 500);
  } catch (err) {
    appendLocalCtLogLine(`✗ Error: ${err.message}`);
  } finally {
    isConfirmingCt = false;
  }
}

export function handleCtConfirmNo() {
  ctConfirmBar?.classList.add('hidden');
}

global.checkPendingMatch = checkPendingMatch;
global.clearCtMatches = clearCtMatches;
global.debouncedFetchPendingMatchDetails = debouncedFetchPendingMatchDetails;
global.fetchPendingMatchDetails = fetchPendingMatchDetails;
global.getCtMatchHtml = getCtMatchHtml;
global.renderComicPreview = renderComicPreview;
global.showCtConfirm = showCtConfirm;
global.handleCtConfirmYes = handleCtConfirmYes;
global.handleCtConfirmNo = handleCtConfirmNo;
