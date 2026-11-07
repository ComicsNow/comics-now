import {
  state,
  global as canonicalGlobal
} from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export async function loadStoryArcsSettings() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/settings`);
    if (!res.ok) return;
    const data = await res.json();

    const intervalInput = document.getElementById('reading-orders-interval-input');
    if (intervalInput && data.readingOrdersIntervalDays !== undefined) {
      intervalInput.value = data.readingOrdersIntervalDays;
    }

    const modeSelect = document.getElementById('reading-orders-mode-select');
    if (modeSelect && data.readingOrdersMode) {
      modeSelect.value = data.readingOrdersMode;
    }
  } catch (err) {
    console.warn('[StoryArcsSettings] Failed to load settings:', err);
  }
}

export async function refreshStoryArcsSyncStatus() {
  const badge = document.getElementById('reading-orders-status-badge');
  const lastSyncText = document.getElementById('reading-orders-last-sync-text');
  const detailsText = document.getElementById('reading-orders-details-text');

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/sync/status`);
    if (!res.ok) return;
    const data = await res.json();

    if (badge) {
      if (data.isSyncing) {
        badge.textContent = `Syncing (${data.progress?.current || 0}/${data.progress?.total || 0})`;
        badge.className = 'text-xs px-2.5 py-1 rounded-full bg-amber-900/60 text-amber-300 border border-amber-500/50 animate-pulse';
      } else if (data.status === 'error') {
        badge.textContent = 'Sync Failed';
        badge.className = 'text-xs px-2.5 py-1 rounded-full bg-red-900/60 text-red-300 border border-red-500/50';
      } else {
        badge.textContent = 'Idle';
        badge.className = 'text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700';
      }
    }

    if (lastSyncText) {
      if (data.lastSyncTime) {
        const d = new Date(data.lastSyncTime);
        lastSyncText.textContent = `Last Sync: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else {
        lastSyncText.textContent = 'Last Sync: Never';
      }
    }

    if (detailsText) {
      const count = Number(data.orderCount || 0).toLocaleString();
      detailsText.textContent = `Indexed: ${count} Story Arcs • Sitemap ETag active`;
    }

    return data;
  } catch (err) {
    console.warn('[StoryArcsSettings] Failed to fetch sync status:', err);
  }
}

export async function triggerSettingsSync() {
  const btn = document.getElementById('sync-reading-orders-settings-btn');
  const modeSelect = document.getElementById('reading-orders-mode-select');
  const mode = modeSelect ? modeSelect.value : 'both';

  const icon = btn?.querySelector('.sync-icon');
  const text = btn?.querySelector('.sync-text');

  if (icon) icon.classList.add('animate-spin');
  if (text) text.textContent = 'Syncing...';
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, force: false })
    });
    const result = await res.json();

    if (result.ok) {
      // Poll status until done
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const stat = await refreshStoryArcsSyncStatus();
        if (!stat?.isSyncing || attempts > 60) {
          clearInterval(pollInterval);
          if (icon) icon.classList.remove('animate-spin');
          if (text) text.textContent = 'Sync Now';
          if (btn) btn.disabled = false;
        }
      }, 1500);
    } else {
      if (text) text.textContent = 'Sync Failed';
      setTimeout(() => {
        if (icon) icon.classList.remove('animate-spin');
        if (text) text.textContent = 'Sync Now';
        if (btn) btn.disabled = false;
      }, 2500);
    }
  } catch (err) {
    if (text) text.textContent = 'Error';
    setTimeout(() => {
      if (icon) icon.classList.remove('animate-spin');
      if (text) text.textContent = 'Sync Now';
      if (btn) btn.disabled = false;
    }, 2500);
  }
}

export function openStoryArcsSettingsModal() {
  if (typeof global.openSettingsModal === 'function') {
    global.openSettingsModal();
  }
  setTimeout(() => {
    const card = document.getElementById('story-arcs-scheduling-card');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('ring-2', 'ring-amber-500', 'p-2', 'rounded-lg', 'transition-all');
      setTimeout(() => {
        card.classList.remove('ring-2', 'ring-amber-500', 'p-2', 'rounded-lg');
      }, 2500);
    }
  }, 100);
}

export function initStoryArcsSettings() {
  const syncBtn = document.getElementById('sync-reading-orders-settings-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', triggerSettingsSync);
  }

  if (typeof window !== 'undefined') {
    window.openStoryArcsSettingsModal = openStoryArcsSettingsModal;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStoryArcsSettings);
  } else {
    initStoryArcsSettings();
  }
}
