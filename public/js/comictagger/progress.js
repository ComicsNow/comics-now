import {
  state,
  ctButton,
  global as canonicalGlobal
} from '../globals.js';
import { isRateDefenseMessage } from './logging.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export function setScanRunningUI(isRunning) {
  const runButtons = ['ct-run-btn', 'ct-rescan-unmatched-btn', 'ct-rescan-xml-btn']
    .map(id => document.getElementById(id));
  const cancelBtn = document.getElementById('ct-cancel-btn');
  const statusText = document.getElementById('ct-scan-status-text');

  if (isRunning) {
    runButtons.forEach(btn => btn && btn.classList.add('hidden'));
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (statusText) statusText.textContent = 'Scanning comic library in progress...';
  } else {
    runButtons.forEach(btn => btn && btn.classList.remove('hidden'));
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (statusText) statusText.textContent = 'Ready to scan comic library';
  }
}

export function updateCtProgressFromLog(message, onFetchScopeCounts) {
  if (!message || typeof message !== 'string') return;

  if (/Results:/i.test(message)) {
    if (typeof onFetchScopeCounts === 'function') {
      onFetchScopeCounts();
    } else if (typeof global.fetchCtScopeCounts === 'function') {
      global.fetchCtScopeCounts();
    }
  }

  const progressCard = document.getElementById('ct-progress-card');
  const fileElem = document.getElementById('ct-progress-file');
  const counterElem = document.getElementById('ct-progress-counter');
  const etaElem = document.getElementById('ct-progress-eta');
  const barFill = document.getElementById('ct-progress-bar-fill');
  const activityText = document.getElementById('ct-progress-activity-text');
  const badge = document.getElementById('ct-progress-badge');
  const pulse = document.getElementById('ct-progress-pulse');

  // Match "[1/10] Processing: ComicName.cbz (10% complete | Est. remaining: ~1m 30s)"
  const procMatch = /^\[(\d+)\/(\d+)\]\s*Processing:\s*(.*?)(?:\s*\(([0-9]+)%\s*complete(?: \|\s*Est\.\s*remaining:\s*~([^)]+))?\))?$/i.exec(message);
  if (procMatch) {
    if (progressCard) progressCard.classList.remove('hidden');
    if (counterElem) counterElem.textContent = `${procMatch[1]} / ${procMatch[2]}`;
    if (fileElem) fileElem.textContent = procMatch[3].trim();
    const pct = parseInt(procMatch[4], 10) || 0;
    if (barFill) barFill.style.width = `${pct}%`;
    if (etaElem) etaElem.textContent = procMatch[5] ? `ETA: ~${procMatch[5]}` : 'ETA: calculating...';
    if (activityText) activityText.textContent = 'Searching metadata sources...';
    if (badge) {
      badge.textContent = 'Searching';
      badge.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-blue-900/60 text-blue-300 border border-blue-700/50 shrink-0';
    }
    if (pulse) {
      pulse.className = 'inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0';
    }
    setScanRunningUI(true);
    return;
  }

  // Match "  ↳ [Source] Message"
  const progMatch = /^\s*↳\s*\[(.*?)\]\s*(.*)$/i.exec(message);
  if (progMatch) {
    const src = progMatch[1].trim();
    const msg = progMatch[2].trim();
    if (activityText) activityText.textContent = `[${src}] ${msg}`;

    if (isRateDefenseMessage(msg)) {
      if (badge) {
        badge.textContent = 'Rate Limit Wait';
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-amber-900/60 text-amber-300 border border-amber-700/50 shrink-0';
      }
      if (pulse) {
        pulse.className = 'inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0';
      }
    } else if (/Candidate found|Match found|High-confidence/i.test(msg)) {
      if (badge) {
        badge.textContent = 'Match Found';
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 shrink-0';
      }
      if (pulse) {
        pulse.className = 'inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0';
      }
    }
    return;
  }

  // Match "📊 Results: 3 tagged, 1 review required, 2 skipped, 0 failed (6 total)"
  const statsMatch = /Results:\s*(\d+)\s*tagged,\s*(\d+)\s*review.*?,\s*(\d+)\s*skipped,\s*(\d+)\s*failed/i.exec(message);
  if (statsMatch) {
    const statTagged = document.getElementById('ct-stat-tagged');
    const statReview = document.getElementById('ct-stat-review');
    const statSkipped = document.getElementById('ct-stat-skipped');
    if (statTagged) statTagged.textContent = `${statsMatch[1]} Tagged`;
    if (statReview) statReview.textContent = `${statsMatch[2]} Review`;
    if (statSkipped) statSkipped.textContent = `${statsMatch[3]} Skipped`;
    if (barFill) barFill.style.width = '100%';
    if (etaElem) etaElem.textContent = 'Completed';
    if (activityText) activityText.textContent = `Completed: ${statsMatch[1]} tagged, ${statsMatch[2]} review, ${statsMatch[3]} skipped`;
    if (badge) {
      badge.textContent = 'Done';
      badge.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-green-900/60 text-green-300 border border-green-700/50 shrink-0';
    }
    if (pulse) {
      pulse.className = 'inline-block w-2 h-2 rounded-full bg-green-500 shrink-0';
    }
    setScanRunningUI(false);
    return;
  }

  if (/Starting Tag Comics Now library scan/i.test(message)) {
    if (progressCard) progressCard.classList.remove('hidden');
    if (barFill) barFill.style.width = '0%';
    if (activityText) activityText.textContent = 'Starting scan...';
    setScanRunningUI(true);
  } else if (/scan completed successfully/i.test(message) || /Scan cancelled/i.test(message) || /Tag Comics Now error/i.test(message)) {
    setScanRunningUI(false);
  }
}

export async function updateCtButtonIndicator() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/pending`);
    if (res.status === 403) return;

    const pending = await res.json();
    if (pending && pending.isRunning !== undefined) {
      setScanRunningUI(!!pending.isRunning);
    }

    if (pending && pending.waitingForResponse) {
      if (ctButton && !ctButton.classList.contains('ct-pending')) {
        ctButton.classList.add('ct-pending');
        ctButton.style.animation = 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite';
        ctButton.style.boxShadow = '0 0 0 3px rgba(251, 191, 36, 0.5)';
        ctButton.title = `Review pending: ${pending.fileName}`;
      }
    } else {
      if (ctButton && ctButton.classList.contains('ct-pending')) {
        ctButton.classList.remove('ct-pending');
        ctButton.style.animation = '';
        ctButton.style.boxShadow = '';
        ctButton.title = 'Tag Comics Now!';
      }
    }
  } catch (error) {}
}

global.setScanRunningUI = setScanRunningUI;
global.updateCtProgressFromLog = updateCtProgressFromLog;
global.updateCtButtonIndicator = updateCtButtonIndicator;
