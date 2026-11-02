import {
  state,
  render,
  html,
  raw,
  escapeHtml,
  ctTabMatches,
  global as canonicalGlobal
} from '../globals.js';
import { setScanRunningUI } from './progress.js';
import { appendLocalCtLogLine } from './logging.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
    el.innerHTML = content.toHTML();
  } else if (content && typeof content === 'object' && content.__isRawHtml) {
    el.innerHTML = content.html;
  } else {
    el.innerHTML = String(content ?? '');
  }
};

const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__isRawHtml) out += v.html;
      else if (v && typeof v === 'object' && typeof v.toHTML === 'function') out += v.toHTML();
      else out += (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''));
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({
  __isRawHtml: true,
  html: String(v ?? '')
});

export async function runCtScan(mode = 'default') {
  setScanRunningUI(true);
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return true;
  } catch (err) {
    setScanRunningUI(false);
    appendLocalCtLogLine(`✗ Failed to start scan: ${err.message}`);
    return false;
  }
}

export async function fetchCtScopeCounts() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/scope-counts`);
    if (!res.ok) return;
    const data = await res.json();
    const count = Math.max(0, parseInt(data && data.unmatched, 10) || 0);
    const countSpan = document.getElementById('ct-unmatched-count');
    const unmatchedBtn = document.getElementById('ct-rescan-unmatched-btn');
    if (countSpan) countSpan.textContent = count > 0 ? `(${count})` : '';
    if (unmatchedBtn) unmatchedBtn.disabled = count === 0;
  } catch (err) {}
}

export async function loadScanLogs() {
  const container = document.getElementById('ct-logs-container');
  if (!container) return;

  renderContent(container, safeHtml`<div class="text-center py-8 text-sm text-gray-400">Loading scan logs...</div>`);

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/scan-logs`);
    const data = await res.json();
    let logs = [];
    if (Array.isArray(data)) {
      logs = data;
    } else if (Array.isArray(data.logs)) {
      logs = data.logs;
    } else if (data.logs && Array.isArray(data.logs.logs)) {
      logs = data.logs.logs;
    }

    if (!logs || logs.length === 0) {
      renderContent(container, safeHtml`<div class="text-center py-8 text-sm text-gray-500">No past scan logs found.</div>`);
      return;
    }

    let html = '';
    logs.forEach(log => {
      const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleString() : (log.date || 'Recent');
      const tagged = log.tagged_count || 0;
      const total = log.total_files || 0;
      const skipped = log.skipped_count || 0;
      const failed = log.failed_count || 0;
      const target = log.target ? log.target.split('/').pop() : '';

      html += `
        <div class="bg-gray-800 p-3 rounded-lg border border-gray-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-sm">
          <div class="min-w-0">
            <div class="font-bold text-white text-sm truncate">Scan: ${escapeHtml(log.id || 'Session')} ${target ? `<span class="text-xs text-gray-400 font-normal">(${escapeHtml(target)})</span>` : ''}</div>
            <div class="text-xs text-gray-400">${escapeHtml(dateStr)} • ${total} file(s) scanned</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-xs px-2.5 py-1 rounded bg-green-900/50 text-green-300 border border-green-700 font-medium">✓ ${tagged} Tagged</span>
            ${skipped > 0 ? `<span class="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 font-medium">${skipped} Skipped</span>` : ''}
            ${failed > 0 ? `<span class="text-xs px-2 py-1 rounded bg-red-900/50 text-red-300 border border-red-700 font-medium">✗ ${failed} Failed</span>` : ''}
          </div>
        </div>
      `;
    });
    renderContent(container, safeRaw(html));
  } catch (err) {
    renderContent(container, safeHtml`<div class="text-center py-8 text-sm text-red-400">Failed to load scan logs: ${err.message}</div>`);
  }
}

export async function clearTrackingHistory() {
  if (!confirm('Are you sure you want to clear the enhancement tracking history? This will allow previously tagged comics to be re-scanned.')) {
    return;
  }

  const btn = document.getElementById('ct-clear-history-btn');
  if (btn) btn.textContent = 'Clearing...';

  try {
    await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/clear-history`, { method: 'POST' });
    if (btn) btn.textContent = '✓ Cleared';
    setTimeout(() => { if (btn) btn.textContent = 'Clear Enhancement History'; }, 2000);
  } catch (err) {
    if (btn) btn.textContent = '✗ Error';
  }
}

export async function migrateLibraryMetadata() {
  const storageInput = document.getElementById('ct-storage-input');
  const mode = storageInput ? storageInput.value : 'archive';
  if (!confirm(`Are you sure you want to migrate all existing comics in your library to "${mode}" storage? This may take some time.`)) {
    return;
  }
  const btn = document.getElementById('ct-migrate-btn');
  if (btn) btn.textContent = 'Migrating...';
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/admin/metadata/migrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, applyToExisting: true })
    });
    if (res.ok) {
      if (btn) btn.textContent = '✓ Migration Complete';
      setTimeout(() => { if (btn) btn.textContent = 'Migrate Existing Comics'; }, 2500);
    } else {
      throw new Error('Migration failed');
    }
  } catch (err) {
    if (btn) btn.textContent = '✗ Error';
    setTimeout(() => { if (btn) btn.textContent = 'Migrate Existing Comics'; }, 2500);
  }
}

export async function cancelCtScan() {
  const cancelBtn = document.getElementById('ct-cancel-btn');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling...';
  }
  try {
    await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/cancel`, { method: 'POST' });
    if (typeof global.checkPendingMatch === 'function') {
      await global.checkPendingMatch();
    }
    if (ctTabMatches && ctTabMatches.classList.contains('active') && typeof global.debouncedFetchPendingMatchDetails === 'function') {
      global.debouncedFetchPendingMatchDetails();
    }
  } catch (err) {
    console.error('Failed to cancel scan:', err);
  } finally {
    if (cancelBtn) {
      cancelBtn.disabled = false;
      renderContent(cancelBtn, safeHtml`<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> Cancel Scan`);
    }
  }
}

global.runCtScan = runCtScan;
global.fetchCtScopeCounts = fetchCtScopeCounts;
global.loadScanLogs = loadScanLogs;
global.clearTrackingHistory = clearTrackingHistory;
global.migrateLibraryMetadata = migrateLibraryMetadata;
global.cancelCtScan = cancelCtScan;
