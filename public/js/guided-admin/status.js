import { state, global as canonicalGlobal } from '../globals.js';
import { fetchModalCredits } from './modal.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

function api(path) {
  const base = (typeof global.API_BASE_URL !== 'undefined' ? global.API_BASE_URL : '') || '';
  return `${base}${path}`;
}

function el(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

export let settingsLoaded = false;
export function setSettingsLoaded(val) {
  settingsLoaded = val;
}

let guidedStatusInterval = null;

export function applyStatusToUI(s) {
  if (!s) return;
  const counts = s.counts || {};
  const cPending = el('guided-count-pending');
  const cProcessing = el('guided-count-processing');
  const cCompleted = el('guided-count-completed');
  const cFailed = el('guided-count-failed');
  const cTotal = el('guided-count-total');

  if (cPending) cPending.textContent = counts.pending ?? 0;
  if (cProcessing) cProcessing.textContent = counts.processing ?? 0;
  if (cCompleted) cCompleted.textContent = counts.completed ?? 0;
  if (cFailed) cFailed.textContent = counts.failed ?? 0;
  if (cTotal) cTotal.textContent = counts.total ?? 0;

  const cur = s.current;
  const currentEl = el('guided-current');
  if (currentEl) {
    if (s.isRunning && Array.isArray(s.active) && s.active.length > 1) {
      const names = s.active.map(a => a.name).join(' & ');
      currentEl.textContent = `Running (2 in parallel): ${names}`;
      currentEl.className = 'text-sm text-blue-400 mt-3';
    } else if (s.isRunning && cur) {
      currentEl.textContent = `Running: [${cur.index}/${cur.total}] ${cur.name}`;
      currentEl.className = 'text-sm text-blue-400 mt-3';
    } else if (s.isRunning) {
      currentEl.textContent = 'Running…';
      currentEl.className = 'text-sm text-blue-400 mt-3';
    } else {
      currentEl.textContent = s.lastFinishedAt
        ? `Idle. Last run finished ${new Date(s.lastFinishedAt).toLocaleString()}`
        : 'Idle.';
      currentEl.className = 'text-sm text-gray-400 mt-3';
    }
  }

  const runBtn = el('guided-run-btn');
  const cancelBtn = el('guided-cancel-btn');
  const cancelCurrentBtn = el('guided-cancel-current-btn');
  if (runBtn) runBtn.disabled = !!s.isRunning;
  if (cancelBtn) cancelBtn.disabled = !s.isRunning;
  if (cancelCurrentBtn) cancelCurrentBtn.disabled = !s.isRunning;
}

export function applySettingsToUI(settings) {
  if (!settings) return;
  const autoOnAdd = el('guided-auto-on-add');
  const scheduleEnabled = el('guided-schedule-enabled');
  const scheduleInterval = el('guided-schedule-interval');
  const unitSel = el('guided-schedule-unit');

  if (autoOnAdd) autoOnAdd.checked = !!settings.autoOnAdd;
  if (scheduleEnabled) scheduleEnabled.checked = !!settings.scheduleEnabled;
  if (scheduleInterval) scheduleInterval.value = settings.scheduleInterval ?? 24;
  if (unitSel) unitSel.value = settings.scheduleUnit === 'days' ? 'days' : 'hours';

  const useModalCb = el('guided-use-modal');
  if (useModalCb) {
    useModalCb.checked = !!settings.useModal;
    const panel = el('guided-modal-panel');
    if (panel) panel.classList.toggle('hidden', !settings.useModal);
  }

  const modalTokenId = el('guided-modal-token-id');
  if (modalTokenId) modalTokenId.value = settings.modalTokenId || '';

  const modalTokenSecret = el('guided-modal-token-secret');
  if (modalTokenSecret) {
    modalTokenSecret.value = '';
    modalTokenSecret.placeholder = settings.hasModalSecret ? '•••••••• (configured)' : '••••••••';
  }

  const modalEnv = el('guided-modal-env');
  if (modalEnv) modalEnv.value = settings.modalEnvironment || '';

  const concurrencySel = el('guided-concurrency');
  if (concurrencySel) concurrencySel.value = String(settings.concurrency || 2);

  if (settings.useModal) {
    fetchModalCredits();
  }
}

export async function fetchStatus(forceSettings = false) {
  try {
    const res = await fetch(api('/api/v1/guided/status'));
    if (!res.ok) return;
    const data = await res.json();
    applyStatusToUI(data);
    if (!settingsLoaded || forceSettings) {
      applySettingsToUI(data.settings);
      settingsLoaded = true;
    }
  } catch (e) {
    // Silent — polling, will retry.
  }
}

export function startPolling() {
  if (guidedStatusInterval) return;
  fetchStatus();
  guidedStatusInterval = setInterval(fetchStatus, 1000);
}

export function stopPolling() {
  if (guidedStatusInterval) {
    clearInterval(guidedStatusInterval);
    guidedStatusInterval = null;
  }
}
