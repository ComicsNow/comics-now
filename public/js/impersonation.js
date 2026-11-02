// Admin impersonation client ("Login as user").
//
// On load, asks /user/me whether the current identity is being impersonated by
// an admin and, if so, shows a persistent banner with an Exit control. Also
// exposes startImpersonation()/stopImpersonation() for the Users settings UI.

import { state, escapeHtml } from './globals.js';
import { html, raw, render, clearElement } from './ui/template.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };
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
const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({ __isRawHtml: true, html: String(v ?? '') });

const apiBase = () => state.API_BASE_URL || window.API_BASE_URL || '';

export async function startImpersonation(userId, userEmail) {
  const res = await fetch(`${apiBase()}/api/v1/admin/impersonate/${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    alert(`Could not start impersonation: ${data.message || res.statusText}`);
    return false;
  }
  // Reload so the whole app re-renders as the target user (their library
  // access, progress, etc. all follow the swapped identity).
  window.location.reload();
  return true;
}

export async function stopImpersonation() {
  try {
    await fetch(`${apiBase()}/api/v1/admin/impersonate/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (_) { /* reload regardless */ }
  window.location.reload();
}

function renderBanner(targetEmail) {
  if (document.getElementById('impersonation-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'impersonation-banner';
  bar.className = 'fixed top-0 inset-x-0 z-9999 bg-amber-500 text-black text-sm font-semibold ' +
    'flex items-center justify-center gap-3 py-1.5 px-4 shadow-lg';
  renderContent(bar, safeHtml`
    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
    <span>Viewing as <strong>${targetEmail}</strong> (read-only)</span>
    <button id="impersonation-exit"
      class="ml-2 bg-black/80 text-white rounded px-3 py-0.5 hover:bg-black transition-colors">Exit</button>
  `);
  document.body.prepend(bar);
  // Nudge the app content down so the banner doesn't cover the top nav.
  document.body.style.paddingTop = `${bar.offsetHeight}px`;
  bar.querySelector('#impersonation-exit').addEventListener('click', stopImpersonation);
}

async function checkImpersonation() {
  try {
    const res = await fetch(`${apiBase()}/api/v1/user/me`);
    if (!res.ok) return;
    const me = await res.json();
    if (me.impersonating && me.impersonating.targetEmail) {
      renderBanner(me.impersonating.targetEmail);
    }
  } catch (_) { /* ignore */ }
}

state.startImpersonation = startImpersonation;
if (typeof window !== 'undefined') {
  window.startImpersonation = startImpersonation;
  window.stopImpersonation = stopImpersonation;
}

document.addEventListener('DOMContentLoaded', checkImpersonation);
