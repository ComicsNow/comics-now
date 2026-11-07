/**
 * Story Arcs Settings Tab & Live Streaming Log Controller
 */
import {
  state,
  global as canonicalGlobal
} from '../globals.js';
import { smartScrollToBottom } from '../comictagger/logging.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

let storyArcsEventSource = null;
let pollStatusInterval = null;
let totalLogLines = 0;

export async function fetchStoryArcsSettings() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/settings`);
    if (!res.ok) return;
    const data = await res.json();

    const intervalInput = document.getElementById('story-arcs-interval-input');
    if (intervalInput && data.readingOrdersIntervalDays !== undefined) {
      intervalInput.value = data.readingOrdersIntervalDays;
    }

    const modeSelect = document.getElementById('story-arcs-mode-select');
    if (modeSelect && data.readingOrdersMode) {
      modeSelect.value = data.readingOrdersMode;
    }
  } catch (err) {
    console.warn('[StoryArcsTab] Failed to fetch settings:', err);
  }
}

export async function refreshStoryArcsStatus() {
  const badge = document.getElementById('story-arcs-status-badge');
  const lastSyncText = document.getElementById('story-arcs-last-sync-text');
  const detailsText = document.getElementById('story-arcs-details-text');
  const progressCard = document.getElementById('story-arcs-progress-card');
  const progressBar = document.getElementById('story-arcs-progress-bar');
  const progressPercent = document.getElementById('story-arcs-progress-percent');
  const progressLabel = document.getElementById('story-arcs-progress-label');
  const startBtn = document.getElementById('start-story-arcs-scan-btn');
  const cancelBtn = document.getElementById('cancel-story-arcs-scan-btn');

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/sync/status`);
    if (!res.ok) return;
    const data = await res.json();

    if (badge) {
      if (data.isSyncing) {
        badge.textContent = `Syncing (${data.progress?.current || 0}/${data.progress?.total || 0})`;
        badge.className = 'text-xs px-3 py-1 rounded-full bg-amber-900/60 text-amber-300 border border-amber-500/50 font-semibold animate-pulse';
        if (progressCard) progressCard.classList.remove('hidden');
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (startBtn) {
          startBtn.disabled = true;
          const txt = startBtn.querySelector('.sync-text');
          if (txt) txt.textContent = 'Sync in progress...';
        }

        if (data.progress?.total > 0) {
          const pct = Math.round((data.progress.current / data.progress.total) * 100);
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressPercent) progressPercent.textContent = `${pct}%`;
          if (progressLabel) progressLabel.textContent = `[${data.progress.current}/${data.progress.total}] Scraping ${data.progress.currentSlug || ''}...`;
        }
      } else {
        if (data.status === 'error') {
          badge.textContent = 'Sync Failed';
          badge.className = 'text-xs px-3 py-1 rounded-full bg-red-900/60 text-red-300 border border-red-500/50 font-semibold';
        } else {
          badge.textContent = 'Idle';
          badge.className = 'text-xs px-3 py-1 rounded-full bg-gray-700/60 text-gray-300 border border-gray-600 font-semibold';
        }
        if (progressCard) progressCard.classList.add('hidden');
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (startBtn) {
          startBtn.disabled = false;
          const txt = startBtn.querySelector('.sync-text');
          if (txt) txt.textContent = 'Start Initial Scan / Sync';
        }
      }
    }

    if (lastSyncText) {
      if (data.lastSyncTime) {
        const d = new Date(data.lastSyncTime);
        lastSyncText.textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else {
        lastSyncText.textContent = 'Never';
      }
    }

    if (detailsText) {
      const count = Number(data.orderCount || 0).toLocaleString();
      detailsText.textContent = `${count} Story Arcs Indexed`;
    }

    return data;
  } catch (err) {
    console.warn('[StoryArcsTab] Failed to fetch status:', err);
  }
}

export function connectStoryArcsStream() {
  if (storyArcsEventSource) return;

  const logOutput = document.getElementById('story-arcs-log-output');
  const jumpBtn = document.getElementById('story-arcs-jump-bottom-btn');
  const autoScrollCb = document.getElementById('story-arcs-autoscroll-cb');
  const countEl = document.getElementById('story-arcs-log-count');

  storyArcsEventSource = new EventSource(`${global.API_BASE_URL}/api/v1/story-arcs/stream`);

  storyArcsEventSource.onmessage = (e) => {
    try {
      if (e.data === ': keepalive') return;
      const entry = JSON.parse(e.data);
      if (!entry || !entry.message || !logOutput) return;

      // Remove placeholder
      const placeholder = logOutput.querySelector('.italic');
      if (placeholder) placeholder.remove();

      const line = document.createElement('div');
      line.className = 'py-0.5 flex items-baseline gap-2 leading-snug';

      const time = document.createElement('span');
      time.className = 'text-gray-500 text-[10px] select-none shrink-0';
      const d = entry.timestamp ? new Date(entry.timestamp) : new Date();
      time.textContent = `[${d.toLocaleTimeString()}]`;

      const msg = document.createElement('span');
      msg.className = entry.level === 'ERROR' ? 'text-red-400 font-semibold' :
                      entry.level === 'WARN' ? 'text-amber-400' : 'text-gray-200';
      msg.textContent = entry.message;

      line.appendChild(time);
      line.appendChild(msg);
      logOutput.appendChild(line);

      totalLogLines++;
      if (countEl) countEl.textContent = `${totalLogLines} lines`;

      // Smart auto-scroll check
      const isAtBottom = logOutput.scrollHeight - logOutput.clientHeight <= logOutput.scrollTop + 35;
      if (autoScrollCb && autoScrollCb.checked && isAtBottom) {
        logOutput.scrollTop = logOutput.scrollHeight;
        if (jumpBtn) jumpBtn.classList.add('hidden');
      } else {
        if (jumpBtn) jumpBtn.classList.remove('hidden');
      }
    } catch (_) {}
  };

  storyArcsEventSource.onerror = () => {};
}

export function openStoryArcsTab() {
  fetchStoryArcsSettings();
  refreshStoryArcsStatus();
  connectStoryArcsStream();

  if (pollStatusInterval) clearInterval(pollStatusInterval);
  pollStatusInterval = setInterval(refreshStoryArcsStatus, 2000);
}

export function initStoryArcsTab() {
  const startBtn = document.getElementById('start-story-arcs-scan-btn');
  const cancelBtn = document.getElementById('cancel-story-arcs-scan-btn');
  const saveBtn = document.getElementById('save-story-arcs-config-btn');
  const clearLogsBtn = document.getElementById('clear-story-arcs-logs-btn');
  const jumpBtn = document.getElementById('story-arcs-jump-bottom-btn');
  const logOutput = document.getElementById('story-arcs-log-output');

  if (logOutput) {
    logOutput.addEventListener('scroll', () => {
      const isAtBottom = logOutput.scrollHeight - logOutput.clientHeight <= logOutput.scrollTop + 35;
      if (jumpBtn) {
        if (isAtBottom) jumpBtn.classList.add('hidden');
        else jumpBtn.classList.remove('hidden');
      }
    });
  }

  if (jumpBtn && logOutput) {
    jumpBtn.addEventListener('click', () => {
      logOutput.scrollTop = logOutput.scrollHeight;
      jumpBtn.classList.add('hidden');
    });
  }

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const modeSelect = document.getElementById('story-arcs-mode-select');
      const forceCb = document.getElementById('story-arcs-force-cb');
      const mode = modeSelect ? modeSelect.value : 'both';
      const force = !!(forceCb && forceCb.checked);

      startBtn.disabled = true;
      try {
        const res = await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, force })
        });
        const data = await res.json();
        if (!data.ok) {
          alert(`Sync error: ${data.error || 'Failed to start sync'}`);
        }
      } catch (err) {
        alert(`Error starting sync: ${err.message}`);
      } finally {
        setTimeout(refreshStoryArcsStatus, 500);
      }
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try {
        await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/sync/cancel`, { method: 'POST' });
      } catch (_) {}
      setTimeout(() => {
        cancelBtn.disabled = false;
        refreshStoryArcsStatus();
      }, 800);
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const intervalInput = document.getElementById('story-arcs-interval-input');
      const modeSelect = document.getElementById('story-arcs-mode-select');
      const statusDiv = document.getElementById('story-arcs-settings-status');

      const readingOrdersIntervalDays = intervalInput ? Number(intervalInput.value) : 7;
      const readingOrdersMode = modeSelect ? modeSelect.value : 'both';

      try {
        const res = await fetch(`${global.API_BASE_URL}/api/v1/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ readingOrdersIntervalDays, readingOrdersMode })
        });
        if (res.ok) {
          if (statusDiv) {
            statusDiv.textContent = 'Preferences saved successfully!';
            statusDiv.className = 'text-xs text-green-400 text-center font-medium';
            setTimeout(() => { statusDiv.textContent = ''; }, 3000);
          }
        }
      } catch (err) {
        if (statusDiv) {
          statusDiv.textContent = `Error: ${err.message}`;
          statusDiv.className = 'text-xs text-red-400 text-center font-medium';
        }
      }
    });
  }

  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', async () => {
      try {
        await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/logs`, { method: 'DELETE' });
        if (logOutput) {
          logOutput.innerHTML = '<div class="text-gray-500 italic">Logs cleared.</div>';
        }
        totalLogLines = 0;
        const countEl = document.getElementById('story-arcs-log-count');
        if (countEl) countEl.textContent = '0 lines';
        if (jumpBtn) jumpBtn.classList.add('hidden');
      } catch (_) {}
    });
  }

  if (typeof window !== 'undefined') {
    window.openStoryArcsTab = openStoryArcsTab;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStoryArcsTab);
  } else {
    initStoryArcsTab();
  }
}
