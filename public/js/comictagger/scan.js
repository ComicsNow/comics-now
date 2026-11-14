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

const scanLogDetailCache = new Map();

export function classifyScanResultStatus(status) {
  const norm = String(status || '').trim().toLowerCase();
  if (norm === 'tagged' || norm === 'success') return 'successful';
  if (norm === 'failed' || norm === 'error') return 'failed';
  return 'skipped';
}

function renderRunResultRows(results, filter) {
  const filtered = results.filter(r => filter === 'all' || classifyScanResultStatus(r.status) === filter);
  if (filtered.length === 0) {
    return '<div class="text-xs text-gray-500 py-3 text-center">No comics matched this filter in this run.</div>';
  }
  return filtered.map(r => {
    const bucket = classifyScanResultStatus(r.status);
    const badgeClass = bucket === 'successful'
      ? 'bg-green-900/50 text-green-300 border border-green-700'
      : (bucket === 'failed' ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-gray-700 text-gray-300 border border-gray-600');
    const label = bucket === 'successful' ? 'Successful' : (bucket === 'failed' ? 'Failed' : 'Skipped');
    const name = r.filename || (r.file_path ? String(r.file_path).split('/').pop() : '') || 'Unknown file';
    const matchInfo = r.matched_title
      ? `${r.matched_title}${r.confidence ? ` (${Math.round(Number(r.confidence) * 100)}%)` : ''}${r.source ? ` • ${r.source}` : ''}`
      : '';
    const note = r.error || r.reason || '';
    return `
      <div class="bg-gray-900/60 border border-gray-700/80 rounded p-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div class="min-w-0">
          <div class="text-white font-medium truncate">${escapeHtml(name)}</div>
          ${matchInfo ? `<div class="text-gray-400 truncate">${escapeHtml(matchInfo)}</div>` : ''}
          ${note ? `<div class="text-gray-400 truncate">${escapeHtml(note)}</div>` : ''}
        </div>
        <span class="px-2 py-0.5 rounded font-medium shrink-0 ${badgeClass}">${label}</span>
      </div>
    `;
  }).join('');
}

function renderRunDetailPanel(detailPanel, runDetail, activeFilter = 'all') {
  const results = Array.isArray(runDetail?.results) ? runDetail.results : [];
  const counts = { all: results.length, successful: 0, failed: 0, skipped: 0 };
  results.forEach(r => { counts[classifyScanResultStatus(r.status)] += 1; });

  const btnCls = (key) => activeFilter === key
    ? 'bg-amber-600 text-white border border-amber-500'
    : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600';

  const htmlStr = `
    <div class="flex flex-wrap items-center gap-1.5 mb-2">
      <button type="button" data-audit-filter="all" class="text-xs px-2.5 py-1 rounded font-medium cursor-pointer ${btnCls('all')}">All (${counts.all})</button>
      <button type="button" data-audit-filter="successful" class="text-xs px-2.5 py-1 rounded font-medium cursor-pointer ${btnCls('successful')}">Successful (${counts.successful})</button>
      <button type="button" data-audit-filter="failed" class="text-xs px-2.5 py-1 rounded font-medium cursor-pointer ${btnCls('failed')}">Failed (${counts.failed})</button>
      <button type="button" data-audit-filter="skipped" class="text-xs px-2.5 py-1 rounded font-medium cursor-pointer ${btnCls('skipped')}">Skipped (${counts.skipped})</button>
    </div>
    <div class="space-y-1.5 max-h-64 overflow-y-auto">
      ${renderRunResultRows(results, activeFilter)}
    </div>
  `;
  renderContent(detailPanel, safeRaw(htmlStr));

  detailPanel.querySelectorAll('[data-audit-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      renderRunDetailPanel(detailPanel, runDetail, btn.getAttribute('data-audit-filter') || 'all');
    });
  });
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

    let htmlStr = '';
    logs.forEach(log => {
      const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleString() : (log.date || 'Recent');
      const tagged = log.tagged_count || 0;
      const total = log.total_files || 0;
      const skipped = log.skipped_count || 0;
      const failed = log.failed_count || 0;
      const target = log.target ? log.target.split('/').pop() : '';
      const scanType = log.type ? String(log.type).toUpperCase() : 'SCAN';
      const runId = String(log.id || '');

      htmlStr += `
        <div class="bg-gray-800 p-3 rounded-lg border border-gray-700 text-sm" data-scan-run-id="${escapeHtml(runId)}">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div class="min-w-0">
              <div class="font-bold text-white text-sm truncate">
                <span class="text-xs px-2 py-0.5 rounded bg-gray-700 text-amber-300 mr-2">${escapeHtml(scanType)}</span>
                Run: ${escapeHtml(runId || 'Session')} ${target ? `<span class="text-xs text-gray-400 font-normal">(${escapeHtml(target)})</span>` : ''}
              </div>
              <div class="text-xs text-gray-400 mt-0.5">${escapeHtml(dateStr)} • ${total} file(s) scanned</div>
            </div>
            <div class="flex flex-wrap items-center gap-2 shrink-0">
              <span class="text-xs px-2.5 py-1 rounded bg-green-900/50 text-green-300 border border-green-700 font-medium">✓ ${tagged} Successful</span>
              <span class="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 font-medium">${skipped} Skipped</span>
              <span class="text-xs px-2 py-1 rounded bg-red-900/50 text-red-300 border border-red-700 font-medium">✗ ${failed} Failed</span>
              ${runId ? `<button type="button" data-toggle-run-id="${escapeHtml(runId)}" class="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 font-medium cursor-pointer">Inspect</button>` : ''}
            </div>
          </div>
          <div class="hidden mt-3 pt-3 border-t border-gray-700" data-run-detail-panel="${escapeHtml(runId)}"></div>
        </div>
      `;
    });
    renderContent(container, safeRaw(htmlStr));

    container.querySelectorAll('[data-toggle-run-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const runId = btn.getAttribute('data-toggle-run-id');
        const panel = container.querySelector(`[data-run-detail-panel="${runId}"]`);
        if (!panel) return;
        const isHidden = panel.classList.contains('hidden');
        if (!isHidden) {
          panel.classList.add('hidden');
          btn.textContent = 'Inspect';
          return;
        }
        panel.classList.remove('hidden');
        btn.textContent = 'Hide';
        if (scanLogDetailCache.has(runId)) {
          renderRunDetailPanel(panel, scanLogDetailCache.get(runId), 'all');
          return;
        }
        renderContent(panel, safeHtml`<div class="text-xs text-gray-400 py-2">Loading run details...</div>`);
        try {
          const detailRes = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/scan-logs/${encodeURIComponent(runId)}`);
          if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
          const detailData = await detailRes.json();
          const runDetail = (detailData.log && detailData.log.log) ? detailData.log.log : (detailData.log || detailData);
          scanLogDetailCache.set(runId, runDetail);
          renderRunDetailPanel(panel, runDetail, 'all');
        } catch (err) {
          renderContent(panel, safeHtml`<div class="text-xs text-red-400 py-2">Failed to load run details: ${err.message}</div>`);
        }
      });
    });
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
