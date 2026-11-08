/**
 * Story Arcs Batch ComicInfo.xml Tagger Controller
 */
import {
  state,
  global as canonicalGlobal
} from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export async function fetchBatchTagPublishers() {
  const select = document.getElementById('story-arcs-batch-publisher-select');
  if (!select) return;

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/batch-tag/publishers`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.publishers)) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="all">All Publishers in Story Arcs DB</option>';

    data.publishers.forEach((pub) => {
      const opt = document.createElement('option');
      opt.value = pub;
      opt.textContent = pub;
      select.appendChild(opt);
    });

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
      select.value = currentVal;
    }
  } catch (err) {
    console.warn('[StoryArcsBatchTagger] Failed to load publishers:', err);
  }
}

export async function refreshBatchTagStatus() {
  const badge = document.getElementById('story-arcs-batch-status-badge');
  const progressCard = document.getElementById('story-arcs-batch-progress-card');
  const progressBar = document.getElementById('story-arcs-batch-progress-bar');
  const progressPercent = document.getElementById('story-arcs-batch-progress-percent');
  const progressLabel = document.getElementById('story-arcs-batch-progress-label');
  const startBtn = document.getElementById('start-story-arcs-batch-btn');
  const cancelBtn = document.getElementById('cancel-story-arcs-batch-btn');

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/batch-tag/status`);
    if (!res.ok) return;
    const data = await res.json();

    if (badge) {
      if (data.isRunning) {
        badge.textContent = `Tagging (${data.progress?.current || 0}/${data.progress?.total || 0})`;
        badge.className = 'text-xs px-2.5 py-1 rounded-full bg-amber-900/60 text-amber-300 border border-amber-500/50 font-semibold animate-pulse self-start sm:self-center';
        if (progressCard) progressCard.classList.remove('hidden');
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (startBtn) {
          startBtn.disabled = true;
          const txt = document.getElementById('story-arcs-batch-btn-text');
          if (txt) txt.textContent = 'Enrichment in progress...';
        }

        if (data.progress?.total > 0) {
          const pct = Math.round((data.progress.current / data.progress.total) * 100);
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressPercent) progressPercent.textContent = `${pct}%`;
          if (progressLabel) {
            progressLabel.textContent = `[${data.progress.current}/${data.progress.total}] Updated: ${data.progress.updated}, Skipped: ${data.progress.skipped} ${data.progress.currentComic ? '- ' + data.progress.currentComic : ''}`;
          }
        }
      } else {
        if (data.isCancelled) {
          badge.textContent = 'Cancelled';
          badge.className = 'text-xs px-2.5 py-1 rounded-full bg-red-900/60 text-red-300 border border-red-500/50 font-semibold self-start sm:self-center';
        } else {
          badge.textContent = 'Idle';
          badge.className = 'text-xs px-2.5 py-1 rounded-full bg-gray-700/60 text-gray-300 border border-gray-600 font-semibold self-start sm:self-center';
        }
        if (progressCard) progressCard.classList.add('hidden');
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (startBtn) {
          startBtn.disabled = false;
          const txt = document.getElementById('story-arcs-batch-btn-text');
          if (txt) txt.textContent = 'Batch Tag Story Arcs';
        }
      }
    }

    return data;
  } catch (err) {
    console.warn('[StoryArcsBatchTagger] Failed to fetch batch tag status:', err);
  }
}

export function initBatchTaggerListeners() {
  const startBtn = document.getElementById('start-story-arcs-batch-btn');
  const cancelBtn = document.getElementById('cancel-story-arcs-batch-btn');
  const publisherSelect = document.getElementById('story-arcs-batch-publisher-select');

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const engineSelect = document.getElementById('story-arcs-engine-select');
      const engine = engineSelect ? engineSelect.value : 'gemini';
      const publisher = publisherSelect ? publisherSelect.value : 'all';
      startBtn.disabled = true;

      try {
        const res = await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/batch-tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publisher, dryRun: false, engine })
        });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error(`Server returned HTTP ${res.status} (${res.statusText || 'Non-JSON response'})`);
        }
        const data = await res.json();
        if (!res.ok || !data.ok) {
          alert(`Batch tag error: ${data.error || 'Failed to start batch tag'}`);
        }
      } catch (err) {
        alert(`Error starting batch tag: ${err.message}`);
      } finally {
        setTimeout(refreshBatchTagStatus, 500);
      }
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try {
        await fetch(`${global.API_BASE_URL}/api/v1/story-arcs/batch-tag/cancel`, { method: 'POST' });
      } catch (_) {}
      setTimeout(() => {
        cancelBtn.disabled = false;
        refreshBatchTagStatus();
      }, 800);
    });
  }
}
