import { state, global as canonicalGlobal } from '../globals.js';
import { clearLogs, rerenderLog } from './logs.js';
import { fetchModalCredits, runModalSetup } from './modal.js';
import { fetchStatus } from './status.js';

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

let initialized = false;

export function isInitialized() {
  return initialized;
}

export function resetInitialized() {
  initialized = false;
}

export function bindOnce() {
  if (initialized) return;
  initialized = true;

  el('guided-run-btn')?.addEventListener('click', async () => {
    try {
      await fetch(api('/api/v1/guided/run'), { method: 'POST' });
      fetchStatus();
    } catch (_) {}
  });

  el('guided-cancel-btn')?.addEventListener('click', async () => {
    try {
      await fetch(api('/api/v1/guided/cancel'), { method: 'POST' });
      fetchStatus();
    } catch (_) {}
  });

  el('guided-cancel-current-btn')?.addEventListener('click', async () => {
    try {
      await fetch(api('/api/v1/guided/cancel-current'), { method: 'POST' });
      fetchStatus();
    } catch (_) {}
  });

  el('guided-log-clear')?.addEventListener('click', async () => {
    clearLogs();
    try {
      await fetch(api('/api/v1/guided/logs/clear'), { method: 'POST' });
    } catch (_) {}
  });

  el('guided-log-level-filter')?.addEventListener('change', rerenderLog);

  el('guided-use-modal')?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    el('guided-modal-panel')?.classList.toggle('hidden', !isChecked);
    if (isChecked) {
      fetchModalCredits();
    }
  });

  el('guided-modal-refresh-btn')?.addEventListener('click', () => {
    fetchModalCredits();
  });

  el('guided-modal-test-btn')?.addEventListener('click', async () => {
    const feedback = el('guided-modal-test-feedback');
    if (feedback) {
      feedback.textContent = 'Testing…';
      feedback.className = 'text-xs text-gray-400';
    }

    const payload = {
      modalTokenId: el('guided-modal-token-id')?.value.trim() || '',
      modalEnvironment: el('guided-modal-env')?.value.trim() || ''
    };
    const secret = el('guided-modal-token-secret')?.value.trim();
    if (secret) {
      payload.modalTokenSecret = secret;
    }

    try {
      const res = await fetch(api('/api/v1/guided/modal-test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        if (feedback) {
          feedback.textContent = `✓ Connected (${data.workspace || 'default'})`;
          feedback.className = 'text-xs text-green-400';
        }
        fetchModalCredits();
      } else {
        if (feedback) {
          feedback.textContent = `✗ ${data.error || 'Connection failed'}`;
          feedback.className = 'text-xs text-red-400';
        }
      }
    } catch (err) {
      if (feedback) {
        feedback.textContent = `✗ ${err.message || err}`;
        feedback.className = 'text-xs text-red-400';
      }
    }
  });

  el('guided-modal-setup-btn')?.addEventListener('click', runModalSetup);
  el('guided-modal-banner-setup-btn')?.addEventListener('click', runModalSetup);

  el('guided-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = el('guided-settings-status');
    if (status) {
      status.textContent = 'Saving…';
      status.className = 'text-sm text-center text-gray-400';
    }
    const autoEl = el('guided-auto-on-add');
    const schedEl = el('guided-schedule-enabled');
    const intervalEl = el('guided-schedule-interval');
    const unitEl = el('guided-schedule-unit');
    const concEl = el('guided-concurrency');

    const payload = {
      autoOnAdd: !!(autoEl && autoEl.checked),
      scheduleEnabled: !!(schedEl && schedEl.checked),
      scheduleInterval: parseInt(intervalEl?.value || '24', 10) || 24,
      scheduleUnit: unitEl?.value || 'hours',
      useModal: !!el('guided-use-modal')?.checked,
      modalTokenId: el('guided-modal-token-id')?.value.trim() || '',
      modalEnvironment: el('guided-modal-env')?.value.trim() || '',
      concurrency: parseInt(concEl?.value || '2', 10) || 2
    };
    const secret = el('guided-modal-token-secret')?.value.trim();
    if (secret) {
      payload.modalTokenSecret = secret;
    }

    try {
      const res = await fetch(api('/api/v1/guided/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || 'Save failed');
      if (status) {
        status.textContent = '✓ Saved';
        status.className = 'text-sm text-center text-green-400';
      }
      if (payload.useModal) {
        fetchModalCredits();
      }
      setTimeout(() => { if (status) status.textContent = ''; }, 2500);
    } catch (err) {
      if (status) {
        status.textContent = `✗ ${err.message || err}`;
        status.className = 'text-sm text-center text-red-400';
      }
    }
  });
}
