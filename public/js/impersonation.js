// Admin impersonation client ("Login as user").
//
// On load, asks /user/me whether the current identity is being impersonated by
// an admin and, if so, shows a persistent banner with an Exit control. Also
// exposes startImpersonation()/stopImpersonation() for the Users settings UI.

import { state } from './globals.js';

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
  bar.className = 'fixed top-0 inset-x-0 z-[9999] bg-amber-500 text-black text-sm font-semibold ' +
    'flex items-center justify-center gap-3 py-1.5 px-4 shadow-lg';
  bar.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
    <span>Viewing as <strong>${targetEmail}</strong> (read-only)</span>
    <button id="impersonation-exit"
      class="ml-2 bg-black/80 text-white rounded px-3 py-0.5 hover:bg-black transition-colors">Exit</button>
  `;
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
