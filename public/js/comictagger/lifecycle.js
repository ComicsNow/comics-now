import {
  state,
  clearElement,
  getRelativePath,
  ctModal,
  ctOutputDiv,
  ctTabMatches,
  ctConfirmBar,
  global as canonicalGlobal
} from '../globals.js';
import {
  seenLogEntries,
  ctLogLineElements,
  applyCtLogEntry,
  loadCtSavedLogs
} from './logging.js';
import {
  updateCtProgressFromLog,
  setScanRunningUI
} from './progress.js';
import {
  fetchCtSettings,
  saveCtSettings
} from './settings.js';
import {
  clearCtMatches,
  checkPendingMatch,
  debouncedFetchPendingMatchDetails,
  showCtConfirm,
  handleCtConfirmYes,
  handleCtConfirmNo
} from './matches.js';
import {
  fetchCtScopeCounts,
  runCtScan,
  cancelCtScan,
  loadScanLogs,
  clearTrackingHistory,
  migrateLibraryMetadata
} from './scan.js';
import { initGeminiComplianceModal } from './gemini.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };

let isCtModalInitializing = false;
let ctSyncInterval = null;

export async function ctSyncLogsAndState() {
  if (!ctModal || ctModal.classList.contains('hidden')) return;

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/logs`);
    if (!res.ok) return;
    const logs = await res.json();
    if (Array.isArray(logs) && ctOutputDiv) {
      let appended = false;
      logs.forEach(entry => {
        if (applyCtLogEntry(entry)) {
          updateCtProgressFromLog(entry.message);
          appended = true;
        }
      });
      if (appended) {
        ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
      }
    }

    const pendingRes = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/pending`);
    if (pendingRes.ok) {
      const pending = await pendingRes.json();
      if (pending && pending.isRunning !== undefined) {
        setScanRunningUI(!!pending.isRunning);
      }
      checkPendingMatch();
      if (pending && pending.waitingForResponse && ctTabMatches && ctTabMatches.classList.contains('active')) {
        debouncedFetchPendingMatchDetails();
      }
    }
  } catch (_) {}
}

export function openCTModal() {
  const sm = global.syncManager;
  if (sm && sm.authEnabled && sm.userRole !== 'admin') {
    if (global.router && typeof getRelativePath === 'function' && getRelativePath().startsWith('/tag-comics-now')) {
      const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
      global.router.navigate(path, true);
    }
    return;
  }

  if (isCtModalInitializing) return;
  if (!ctModal?.classList.contains('hidden')) return;
  
  isCtModalInitializing = true;

  if (!global._isNavigatingFromRouter && global.router && typeof getRelativePath === 'function') {
    if (!getRelativePath().startsWith('/tag-comics-now')) {
      global.router.navigate('/tag-comics-now/output', true);
    }
  }
  ctModal?.classList.remove('hidden');

  if (global.ctEventSource) {
    global.ctEventSource.close();
    global.ctEventSource = null;
  }
  if (ctSyncInterval) {
    clearInterval(ctSyncInterval);
    ctSyncInterval = null;
  }

  fetchCtSettings();
  clearCtMatches();
  if (ctOutputDiv) clear(ctOutputDiv);
  seenLogEntries.clear();
  ctLogLineElements.clear();

  loadCtSavedLogs();
  fetchCtScopeCounts();

  checkPendingMatch().then(() => {
    const indicator = document.getElementById('ct-pending-indicator');
    if (indicator && ctTabMatches && !ctTabMatches.classList.contains('active')) {
      ctTabMatches.click();
    }
    isCtModalInitializing = false;
  }).catch(() => {
    isCtModalInitializing = false;
  });

  ctSyncInterval = setInterval(ctSyncLogsAndState, 1500);

  global.ctEventSource = new EventSource(`${global.API_BASE_URL}/api/v1/tag-comics-now/stream`);
  
  global.ctEventSource.onopen = () => {};
  global.ctEventSource.onerror = () => {};

  global.ctEventSource.onmessage = (e) => {
    try {
      if (e.data === ':ok' || e.data === ': keepalive') return;
      const data = JSON.parse(e.data);
      const msg = data.message;

      if (applyCtLogEntry(data) && ctOutputDiv) {
        ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
      }

      updateCtProgressFromLog(msg);

      if (/Review required/i.test(msg) || /WAITING FOR USER SELECTION/i.test(msg) || /pending match retained/i.test(msg)) {
        checkPendingMatch();
        if (ctTabMatches && ctTabMatches.classList.contains('active')) {
          debouncedFetchPendingMatchDetails();
        }
      }
    } catch (err) {}
  };
}

export function closeCTModal() {
  ctModal?.classList.add('hidden');
  ctConfirmBar?.classList.add('hidden');
  if (global.ctEventSource) {
    global.ctEventSource.close();
    global.ctEventSource = null;
  }
  if (ctSyncInterval) {
    clearInterval(ctSyncInterval);
    ctSyncInterval = null;
  }

  if (global.router && typeof getRelativePath === 'function' && getRelativePath().startsWith('/tag-comics-now')) {
    const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
    global.router.navigate(path, true);
  }

  if (typeof global.stopRenameStream === 'function') global.stopRenameStream();
  if (typeof global.stopMoveStream === 'function') global.stopMoveStream();
}

export function bindComicTaggerEvents() {
  document.getElementById('ct-migrate-btn')?.addEventListener('click', migrateLibraryMetadata);
  document.getElementById('ct-refresh-logs-btn')?.addEventListener('click', loadScanLogs);
  document.getElementById('ct-clear-history-btn')?.addEventListener('click', clearTrackingHistory);
  document.getElementById('ct-save-btn')?.addEventListener('click', saveCtSettings);
  document.getElementById('ct-apply-btn')?.addEventListener('click', () => showCtConfirm('apply'));
  document.getElementById('ct-skip-btn')?.addEventListener('click', () => showCtConfirm('skip'));
  document.getElementById('ct-confirm-yes')?.addEventListener('click', handleCtConfirmYes);
  document.getElementById('ct-confirm-no')?.addEventListener('click', handleCtConfirmNo);
  document.getElementById('ct-run-btn')?.addEventListener('click', () => runCtScan('default'));
  document.getElementById('ct-rescan-unmatched-btn')?.addEventListener('click', () => runCtScan('unmatched'));
  document.getElementById('ct-rescan-xml-btn')?.addEventListener('click', () => runCtScan('existing-xml'));
  document.getElementById('ct-cancel-btn')?.addEventListener('click', cancelCtScan);
  document.getElementById('ct-clear-output')?.addEventListener('click', () => {
    if (ctOutputDiv) clear(ctOutputDiv);
    ctLogLineElements.clear();
  });
  initGeminiComplianceModal();
}

if (typeof window !== 'undefined') {
  bindComicTaggerEvents();
}

global.ctSyncLogsAndState = ctSyncLogsAndState;
global.openCTModal = openCTModal;
global.closeCTModal = closeCTModal;
global.bindComicTaggerEvents = bindComicTaggerEvents;
