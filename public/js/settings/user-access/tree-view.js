import { state, escapeHtml, clearElement } from '../../globals.js';
import { html, raw, render } from '../../ui/template.js';
import {
  setCurrentAccessUser,
  setLibraryTreeData,
  setUserAccessData
} from './state.js';
import {
  loadLibraryTreeAndUserAccess,
  saveUserAccess,
  toggleAllAccess
} from './api.js';

const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  const toStr = (c) => {
    if (c === null || c === undefined) return '';
    if (Array.isArray(c)) return c.map(toStr).join('');
    if (typeof c === 'object' && typeof c.toHTML === 'function') return c.toHTML();
    if (typeof c === 'object' && c.__isRawHtml) return c.html;
    return String(c);
  };
  el.innerHTML = toStr(content);
};

const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  const formatVal = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(formatVal).join('');
    if (typeof v === 'object' && v.__isRawHtml) return v.html;
    if (typeof v === 'object' && typeof v.toHTML === 'function') return v.toHTML();
    return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v);
  };
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      out += formatVal(values[i]);
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

export function hideUserAccessView() {
  const accessView = typeof document !== 'undefined' ? document.getElementById('user-access-view') : null;
  if (accessView) {
    accessView.remove();
  }
  const usersListDiv = state?.usersListDiv || (typeof window !== 'undefined' ? window.usersListDiv : null);
  if (usersListDiv) {
    usersListDiv.classList.remove('hidden');
  }
  setCurrentAccessUser(null);
  setLibraryTreeData(null);
  setUserAccessData(null);
}

export async function showUserAccessView(userId, userEmail, userRole) {
  if (userRole === 'admin') {
    if (typeof alert === 'function') alert('Admin users have full access to all libraries automatically.');
    return;
  }

  setCurrentAccessUser({ userId, userEmail, userRole });

  const usersListDiv = state?.usersListDiv || (typeof window !== 'undefined' ? window.usersListDiv : null);
  const setUsersStatus = state?.setUsersStatus || (typeof window !== 'undefined' ? window.setUsersStatus : null);

  if (usersListDiv) {
    usersListDiv.classList.add('hidden');
  }
  if (typeof setUsersStatus === 'function') {
    setUsersStatus('', 'info', false);
  }

  const accessView = document.createElement('div');
  accessView.id = 'user-access-view';
  accessView.className = 'bg-linear-to-r from-purple-900/30 to-blue-900/30 border-2 border-purple-700/50 rounded-xl p-6 shadow-lg transition-all duration-300';
  renderContent(accessView, safeHtml`
    <div class="flex items-center justify-between mb-6">
      <div class="flex-1">
        <button id="back-to-users-btn" class="flex items-center text-gray-400 hover:text-white transition-colors mb-4 group">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-1 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Users
        </button>
        <div class="flex items-center min-w-0">
          <div class="bg-purple-600/20 p-2 rounded-lg mr-3 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="user-access-title text-sm sm:text-base font-bold text-white break-all leading-snug">
              Library Access for <span class="text-purple-300 break-all font-semibold">${userEmail}</span>
            </div>
            <p class="text-xs sm:text-sm text-gray-400 truncate mt-0.5">Configure content permissions</p>
          </div>
        </div>
      </div>
    </div>

    <div id="access-status" class="text-sm text-purple-400 mb-4 pl-0 sm:pl-14 wrap-break-word"></div>

    <div class="space-y-6">
      <div class="pl-0 sm:pl-14">
        <button id="access-guide-toggle" class="text-xs font-bold uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-2" aria-expanded="false">
          <span>How to Use Library Access</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div id="access-guide-content" class="hidden mt-4 bg-black/30 rounded-xl p-5 border border-purple-500/20 text-sm">
          <h5 class="font-bold text-white mb-3">Understanding Access Control</h5>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-3">
              <div>
                <h6 class="font-bold text-purple-400 text-xs uppercase mb-1">📚 Library Level</h6>
                <p class="text-gray-400 text-xs">Grant or deny access to entire root library folders.</p>
              </div>
              <div>
                <h6 class="font-bold text-green-400 text-xs uppercase mb-1">🏢 Publisher Level</h6>
                <p class="text-gray-400 text-xs">Control access to all comics from a specific publisher.</p>
              </div>
            </div>
            
            <div class="space-y-3">
              <div>
                <h6 class="font-bold text-blue-400 text-xs uppercase mb-1">📖 Series Level</h6>
                <p class="text-gray-400 text-xs">Fine-tune access to specific series.</p>
              </div>
              <div>
                <h6 class="font-bold text-yellow-400 text-xs uppercase mb-1">📕 Comic Level</h6>
                <p class="text-gray-400 text-xs">Grant or revoke access to individual comic books.</p>
              </div>
            </div>
          </div>

          <div class="mt-4 pt-4 border-t border-purple-500/20">
            <h6 class="font-bold text-white text-xs uppercase mb-2">Checkboxes:</h6>
            <div class="flex flex-wrap gap-4">
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-blue-600 rounded text-[10px] font-bold">D</span>
                <span class="text-xs text-gray-400">Direct (This item only)</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-yellow-600 rounded text-[10px] font-bold">R</span>
                <span class="text-xs text-gray-400">Recursive (All siblings)</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-purple-600 rounded text-[10px] font-bold">C</span>
                <span class="text-xs text-gray-400">Child (All descendants)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-black/20 rounded-xl border border-purple-500/30 overflow-hidden">
        <div class="flex items-center justify-between p-4 border-b border-purple-500/20 bg-purple-900/10">
          <h4 class="font-bold text-white text-sm uppercase tracking-wider">Content Hierarchy</h4>
          <div class="flex gap-2">
            <button id="select-all-btn" class="text-[10px] font-bold uppercase tracking-widest bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors border border-gray-700">
              Select All
            </button>
            <button id="deselect-all-btn" class="text-[10px] font-bold uppercase tracking-widest bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors border border-gray-700">
              Deselect All
            </button>
          </div>
        </div>

        <div id="access-tree-container" class="p-4 space-y-2 max-h-[50vh] overflow-y-auto scrollbar-thin scrollbar-thumb-purple-600/50 scrollbar-track-transparent">
          <div class="text-center text-gray-400 py-8 animate-pulse">Loading library structure...</div>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-purple-500/20">
        <button id="cancel-access-btn" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2.5 px-6 rounded-full transition-all border border-gray-600 shadow-lg">
          Cancel
        </button>
        <button id="save-access-btn" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-8 rounded-full transition-all shadow-lg hover:shadow-purple-900/40">
          Save Access
        </button>
      </div>
    </div>
  `);

  if (usersListDiv && usersListDiv.parentElement) {
    usersListDiv.parentElement.appendChild(accessView);
  }

  document.getElementById('back-to-users-btn')?.addEventListener('click', hideUserAccessView);
  document.getElementById('cancel-access-btn')?.addEventListener('click', hideUserAccessView);
  document.getElementById('save-access-btn')?.addEventListener('click', saveUserAccess);
  document.getElementById('select-all-btn')?.addEventListener('click', () => toggleAllAccess(true));
  document.getElementById('deselect-all-btn')?.addEventListener('click', () => toggleAllAccess(false));

  const guideToggle = document.getElementById('access-guide-toggle');
  const guideContent = document.getElementById('access-guide-content');
  if (guideToggle && guideContent) {
    guideToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const isExpanded = guideToggle.getAttribute('aria-expanded') === 'true';
      if (isExpanded) {
        guideContent.classList.add('hidden');
        guideToggle.setAttribute('aria-expanded', 'false');
        guideToggle.textContent = 'How to Use Library Access';
      } else {
        guideContent.classList.remove('hidden');
        guideToggle.setAttribute('aria-expanded', 'true');
        guideToggle.textContent = 'Hide Guide';
      }
    });
  }

  await loadLibraryTreeAndUserAccess(userId);
}
