/**
 * Comics Now! - Continuity Jump Interceptor
 *
 * Detects if a user is opening a comic out of sequence in an active Story Arc
 * and displays a gentle confirmation dialog allowing them to start with the oldest unread issue.
 */
import {
  state,
  escapeHtml
} from '../globals.js';

let activeContinuityModal = null;

const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));

export async function checkContinuityBeforeRead(comic, onProceed, onReadOldest) {
  if (!comic || !comic.id) {
    if (typeof onProceed === 'function') onProceed();
    return;
  }

  const baseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  try {
    const res = await fetch(`${baseUrl}/api/v1/comics/${comic.id}/continuity`);
    if (!res.ok) {
      if (typeof onProceed === 'function') onProceed();
      return;
    }

    const data = await res.json();
    if (!data || !data.hasArc || !Array.isArray(data.earlierUnread) || data.earlierUnread.length === 0) {
      if (typeof onProceed === 'function') onProceed();
      return;
    }

    const arcTitle = data.arcTitle || 'Story Arc';
    const bypassKey = `continuity-bypass:${arcTitle}`;
    const storage = (typeof localStorage !== 'undefined' ? localStorage : null) || (typeof window !== 'undefined' && window.localStorage);
    if (storage && storage.getItem(bypassKey) === 'true') {
      if (typeof onProceed === 'function') onProceed();
      return;
    }

    showContinuityModal({
      comic,
      arcTitle,
      earlierUnread: data.earlierUnread,
      bypassKey,
      storage,
      onProceed,
      onReadOldest
    });
  } catch (err) {
    console.warn('[ContinuityCheck] Error verifying continuity:', err);
    if (typeof onProceed === 'function') onProceed();
  }
}

function showContinuityModal({ comic, arcTitle, earlierUnread, bypassKey, storage, onProceed, onReadOldest }) {
  if (activeContinuityModal) activeContinuityModal.remove();

  const modal = document.createElement('div');
  modal.id = 'continuity-check-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 transition-opacity';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const oldest = earlierUnread[0];
  const unreadCount = earlierUnread.length;

  modal.innerHTML = `
    <div class="relative w-full max-w-md bg-gray-950 border border-amber-500/40 rounded-2xl shadow-2xl p-5 sm:p-6 text-white flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <span class="p-2 rounded-xl bg-amber-500/20 text-amber-400 text-xl border border-amber-500/30">⚡</span>
        <div>
          <h3 class="text-lg font-bold text-white leading-tight">Continuity Check</h3>
          <span class="text-xs text-amber-400 font-semibold">${safeEscape(arcTitle)}</span>
        </div>
      </div>

      <p class="text-xs sm:text-sm text-gray-300 leading-relaxed">
        You are opening <span class="font-bold text-white">${safeEscape(comic.name || 'this comic')}</span>. There are <span class="text-amber-400 font-bold">${unreadCount} earlier issues</span> in this storyline that are currently unread in your library.
      </p>

      <div class="p-3 bg-gray-900/80 rounded-xl border border-gray-800 text-xs flex items-center justify-between">
        <div class="min-w-0 pr-2">
          <span class="text-[10px] text-gray-500 uppercase font-bold block">Oldest Unread Issue:</span>
          <span class="font-bold text-white truncate block">${safeEscape(oldest.name || 'Issue #' + oldest.position)}</span>
        </div>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500/30 shrink-0">#${oldest.position} in Arc</span>
      </div>

      <label class="flex items-center gap-2 text-xs text-gray-400 select-none cursor-pointer">
        <input type="checkbox" id="continuity-bypass-cb" class="w-3.5 h-3.5 rounded text-amber-600 focus:ring-amber-500 bg-gray-800 border-gray-700">
        <span>Don't show again for ${safeEscape(arcTitle)}</span>
      </label>

      <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-800/80">
        <button type="button" id="continuity-proceed-btn" class="px-3.5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer">
          Continue Anyway →
        </button>
        <button type="button" id="continuity-read-oldest-btn" class="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-colors shadow-xs cursor-pointer flex items-center gap-1.5">
          <span>▷</span>
          <span>Read Oldest Unread</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  activeContinuityModal = modal;

  const handleBypass = () => {
    const cb = modal.querySelector('#continuity-bypass-cb');
    if (cb && cb.checked && storage) {
      storage.setItem(bypassKey, 'true');
    }
  };

  const close = () => {
    handleBypass();
    modal.classList.add('hidden');
    modal.remove();
    activeContinuityModal = null;
  };

  const proceedBtn = modal.querySelector('#continuity-proceed-btn');
  if (proceedBtn) {
    proceedBtn.addEventListener('click', () => {
      close();
      if (typeof onProceed === 'function') onProceed();
    });
  }

  const oldestBtn = modal.querySelector('#continuity-read-oldest-btn');
  if (oldestBtn) {
    oldestBtn.addEventListener('click', () => {
      close();
      if (typeof onReadOldest === 'function') {
        onReadOldest(oldest);
      } else if (typeof onProceed === 'function') {
        onProceed();
      }
    });
  }
}
