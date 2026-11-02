import { state, global as canonicalGlobal } from '../globals.js';

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

export async function fetchModalCredits() {
  const badge = el('guided-modal-badge');
  const available = el('guided-modal-available');
  const total = el('guided-modal-total-credits');
  const metered = el('guided-modal-metered');
  const billed = el('guided-modal-billed');
  const msg = el('guided-modal-credit-msg');

  const setupBanner = el('guided-modal-setup-banner');
  const setupBtn = el('guided-modal-setup-btn');

  if (badge) {
    badge.textContent = 'Checking…';
    badge.className = 'text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300';
  }

  try {
    const res = await fetch(api('/api/v1/guided/modal-status'));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (badge) {
        badge.textContent = 'Auth / Error';
        badge.className = 'text-xs px-2 py-0.5 rounded-full bg-red-900 text-red-200';
      }
      if (msg) msg.textContent = data.error || 'Failed to authenticate with Modal';
      setupBanner?.classList.add('hidden');
      setupBtn?.classList.add('hidden');
      return;
    }

    if (available) available.textContent = `$${Number(data.availableCredits || 0).toFixed(2)}`;
    if (total) total.textContent = `$${Number(data.totalCredits || 0).toFixed(2)}`;
    if (metered) metered.textContent = `$${Number(data.meteredCost || 0).toFixed(2)}`;
    if (billed) billed.textContent = `$${Number(data.billedCost || 0).toFixed(2)}`;

    const needsSetup = !data.modelsUploaded || !data.appDeployed;

    if (needsSetup) {
      if (badge) {
        badge.textContent = 'Setup Required';
        badge.className = 'text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-200';
      }
      if (msg) {
        msg.textContent = `Workspace: ${data.workspace || 'default'} · One-time setup required (models or app missing)`;
      }
      setupBanner?.classList.remove('hidden');
      setupBtn?.classList.remove('hidden');
    } else if (data.spendLimitExceeded) {
      if (badge) {
        badge.textContent = 'Spend Limit Reached';
        badge.className = 'text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-200';
      }
      if (msg) {
        msg.textContent = `Workspace: ${data.workspace || 'default'} · Spend limit reached (Jobs will fall back to local CPU)`;
      }
      setupBanner?.classList.add('hidden');
      setupBtn?.classList.add('hidden');
    } else {
      if (badge) {
        badge.textContent = 'Ready (GPU)';
        badge.className = 'text-xs px-2 py-0.5 rounded-full bg-green-900 text-green-200';
      }
      if (msg) {
        msg.textContent = `Workspace: ${data.workspace || 'default'} · Ready for GPU inference`;
      }
      setupBanner?.classList.add('hidden');
      setupBtn?.classList.add('hidden');
    }
  } catch (err) {
    if (badge) {
      badge.textContent = 'Offline';
      badge.className = 'text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400';
    }
    if (msg) msg.textContent = `Error connecting to server: ${err.message || err}`;
    setupBanner?.classList.add('hidden');
    setupBtn?.classList.add('hidden');
  }
}

export async function runModalSetup() {
  const setupBtn = el('guided-modal-setup-btn');
  const bannerSetupBtn = el('guided-modal-banner-setup-btn');
  const feedback = el('guided-modal-test-feedback');
  const badge = el('guided-modal-badge');

  if (setupBtn) {
    setupBtn.disabled = true;
    setupBtn.textContent = '⏳ Initializing (Uploading models & deploying)...';
  }
  if (bannerSetupBtn) {
    bannerSetupBtn.disabled = true;
    bannerSetupBtn.textContent = 'Initializing…';
  }
  if (badge) {
    badge.textContent = 'Setting up…';
    badge.className = 'text-xs px-2 py-0.5 rounded-full bg-blue-900 text-blue-200 animate-pulse';
  }
  if (feedback) {
    feedback.textContent = 'Uploading ONNX models to Modal storage and deploying persistent GPU worker...';
    feedback.className = 'text-xs text-blue-300';
  }

  const payload = {
    modalTokenId: el('guided-modal-token-id')?.value.trim() || undefined,
    modalEnvironment: el('guided-modal-env')?.value.trim() || undefined
  };
  const secret = el('guided-modal-token-secret')?.value.trim();
  if (secret) payload.modalTokenSecret = secret;

  try {
    const res = await fetch(api('/api/v1/guided/modal-setup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      if (feedback) {
        feedback.textContent = '✓ Modal environment initialized and ready!';
        feedback.className = 'text-xs text-green-400';
      }
      await fetchModalCredits();
    } else {
      if (feedback) {
        feedback.textContent = `✗ Setup failed: ${data.error || data.message || 'Unknown error'}`;
        feedback.className = 'text-xs text-red-400';
      }
    }
  } catch (err) {
    if (feedback) {
      feedback.textContent = `✗ ${err.message || err}`;
      feedback.className = 'text-xs text-red-400';
    }
  } finally {
    if (setupBtn) {
      setupBtn.disabled = false;
      setupBtn.textContent = '⚡ Initialize Modal GPU Environment';
    }
    if (bannerSetupBtn) {
      bannerSetupBtn.disabled = false;
      bannerSetupBtn.textContent = 'Setup Now';
    }
  }
}
