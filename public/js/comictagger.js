import {
  state,
  escapeHtml,
  getRelativePath,
  ctButton,
  ctModal,
  ctScheduleInput,
  ctMatchBody,
  ctApplyBtn,
  ctSkipBtn,
  ctConfirmBar,
  ctConfirmMessage,
  ctConfirmYes,
  ctConfirmNo,
  ctOutputDiv,
  ctTabMatches,
  ctMatchesBadge
} from './globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

// --- COMICTAGGER / TAG COMICS NOW ---
async function checkPendingMatch() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/pending`);
    if (res.status === 403) return;

    const pending = await res.json();

    if (pending && pending.waitingForResponse) {
      const indicator = document.createElement('div');
      indicator.id = 'ct-pending-indicator';
      indicator.className = 'bg-yellow-600 text-white px-4 py-2 rounded-lg mb-3 text-sm font-semibold';
      indicator.innerHTML = `⚠️ Review needed for: <strong>${escapeHtml(pending.fileName)}</strong> (since ${escapeHtml(new Date(pending.timestamp).toLocaleTimeString())})`;

      const matchesContent = document.getElementById('ct-content-matches');
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) existingIndicator.remove();
      if (matchesContent) matchesContent.insertBefore(indicator, matchesContent.firstChild);

      if (ctMatchesBadge && !ctTabMatches?.classList.contains('active')) {
        ctMatchesBadge.classList.remove('hidden');
      }

      if (ctApplyBtn) ctApplyBtn.disabled = false;
      if (ctSkipBtn) ctSkipBtn.disabled = false;
    } else {
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) existingIndicator.remove();
      if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
      if (ctApplyBtn) ctApplyBtn.disabled = true;
      if (ctSkipBtn) ctSkipBtn.disabled = true;
    }
    return pending;
  } catch (error) {}
}

const seenLogEntries = new Set();
let ctSyncInterval = null;
let isConfirmingCt = false;

// --- Live output log-line bookkeeping ---
// Id-stamped entries (e.g. the WAITING FOR USER SELECTION banner) are updated
// in place instead of being appended again, so a resolved review never leaves
// a stale line behind. Non-id entries keep timestamp+message dedupe.
const ctLogLineElements = new Map();

function isRateDefenseMessage(message) {
  return /Rate defense|cooldown/i.test(String(message || ''));
}

function ctLogEntryKey(entry) {
  if (entry && entry.id) return `id:${entry.id}:${entry.timestamp || ''}`;
  return `${entry.timestamp}_${entry.message}`;
}

function upsertCtLogLine(entry) {
  if (!ctOutputDiv) return false;
  if (entry.id) {
    const existing = ctLogLineElements.get(entry.id);
    const line = formatCtLogMessage(entry.timestamp, entry.message);
    line.dataset.logId = entry.id;
    if (existing && existing.parentNode === ctOutputDiv) {
      ctOutputDiv.replaceChild(line, existing);
      ctLogLineElements.set(entry.id, line);
      seenLogEntries.add(ctLogEntryKey(entry));
      return true;
    }
    if (seenLogEntries.has(ctLogEntryKey(entry))) return false;
    seenLogEntries.add(ctLogEntryKey(entry));
    ctLogLineElements.set(entry.id, line);
    ctOutputDiv.appendChild(line);
    return true;
  }
  const key = ctLogEntryKey(entry);
  if (seenLogEntries.has(key)) return false;
  seenLogEntries.add(key);
  ctOutputDiv.appendChild(formatCtLogMessage(entry.timestamp, entry.message));
  return true;
}

function upsertRateDefenseLine(entry) {
  const lastChild = ctOutputDiv ? ctOutputDiv.lastElementChild : null;
  if (lastChild && lastChild.dataset && lastChild.dataset.logType === 'rate-defense') {
    ctOutputDiv.replaceChild(formatCtLogMessage(entry.timestamp, entry.message), lastChild);
    return true;
  }
  return false;
}

function appendLocalCtLogLine(message) {
  if (!ctOutputDiv) return;
  const line = formatCtLogMessage(new Date().toISOString(), message);
  line.dataset.local = 'true';
  ctOutputDiv.appendChild(line);
  ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
}

// Render an incoming log entry: live rate-defense updates merge into the last
// rate-defense line, id-stamped entries upsert, everything else dedupes.
function applyCtLogEntry(entry) {
  if (!entry || typeof entry.message !== 'string') return false;
  if (!entry.id && (entry.isUpdate || isRateDefenseMessage(entry.message)) && upsertRateDefenseLine(entry)) {
    return true;
  }
  return upsertCtLogLine(entry);
}

function updateCtProgressFromLog(message) {
  if (!message || typeof message !== 'string') return;

  // A finished run may have changed the unmatched scope: refresh the count
  if (/Results:/i.test(message)) fetchCtScopeCounts();

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

function formatLogTime(isoString) {
  if (!isoString) return '';
  const str = String(isoString).trim();
  const m = str.match(/T?(\d{2}:\d{2}:\d{2})/);
  if (m) return m[1];
  return str;
}

function formatCtLogMessage(timestamp, message) {
  const line = document.createElement('div');
  line.className = 'ct-log-line py-0.5 font-mono text-xs sm:text-sm';

  if (/^[━─]+$/.test(message)) {
    line.className = 'ct-log-separator border-b border-gray-700/60 my-1';
    return line;
  }

  let colorClass = 'text-gray-300';
  let icon = '';
  let bold = false;

  // Check for live step progress "↳ [Source] ..."
  const streamStepMatch = /^\s*↳\s*\[(.*?)\]\s*(.*)$/.exec(message);
  if (streamStepMatch) {
    line.className = 'ct-log-line py-1 font-mono text-xs pl-2 sm:pl-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-gray-800/30';
    const src = streamStepMatch[1];
    const subMsg = streamStepMatch[2];

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-gray-500 text-[11px] font-mono select-none shrink-0';
    timeSpan.textContent = `[${formatLogTime(timestamp)}]`;
    timeSpan.title = timestamp;

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'text-gray-500 font-bold select-none text-[11px] shrink-0';
    arrowSpan.textContent = '↳';

    const srcBadge = document.createElement('span');
    srcBadge.className = 'px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-blue-300 border border-blue-900/50 shrink-0';
    srcBadge.textContent = src;

    const msgSpan = document.createElement('span');
    if (isRateDefenseMessage(subMsg)) {
      line.dataset.logType = 'rate-defense';
      msgSpan.className = 'text-amber-400 wrap-break-word min-w-[180px] flex-1 flex items-center gap-1.5 leading-snug';
      msgSpan.innerHTML = `<span class="shrink-0">⏳</span> <span>${escapeHtml(subMsg)}</span>`;
    } else if (/Candidate found|Match found|High-confidence|Early exit/i.test(subMsg)) {
      msgSpan.className = 'text-emerald-400 font-semibold wrap-break-word min-w-[180px] flex-1 leading-snug';
      msgSpan.textContent = `✓ ${subMsg}`;
    } else if (/No match found/i.test(subMsg)) {
      msgSpan.className = 'text-gray-400 wrap-break-word min-w-[180px] flex-1 leading-snug';
      msgSpan.textContent = `✗ ${subMsg}`;
    } else if (/Search failed|Error/i.test(subMsg)) {
      msgSpan.className = 'text-red-400 wrap-break-word min-w-[180px] flex-1 leading-snug';
      msgSpan.textContent = `✗ ${subMsg}`;
    } else {
      msgSpan.className = 'text-teal-300 wrap-break-word min-w-[180px] flex-1 leading-snug';
      msgSpan.textContent = subMsg;
    }

    line.appendChild(timeSpan);
    line.appendChild(arrowSpan);
    line.appendChild(srcBadge);
    line.appendChild(msgSpan);
    return line;
  }

  if (/tag\s+written|archive\s+already\s+tagged|success|✓|SUCCESS/i.test(message)) {
    colorClass = 'text-green-400';
    if (!message.includes('✓')) icon = '✓ ';
    bold = true;
  } else if (/error|failed|no\s+match|could\s+not|KEEP:|✗/i.test(message)) {
    colorClass = 'text-red-400';
    if (!message.includes('✗')) icon = '✗ ';
  } else if (/warning|caution|pending|>>>.*WAITING|Rate defense|cooldown/i.test(message)) {
    colorClass = 'text-yellow-400';
    if (!message.includes('⚠') && !message.includes('⏳')) icon = '⏳ ';
    bold = true;
  } else if (/skip|⊘/i.test(message)) {
    colorClass = 'text-orange-400';
    if (!message.includes('⊘')) icon = '⊘ ';
  } else if (/choose|select|enter/i.test(message)) {
    colorClass = 'text-cyan-400';
    if (!message.includes('❯')) icon = '❯ ';
  } else if (/^\[\d+\/\d+\]\s*Processing:/i.test(message)) {
    colorClass = 'text-blue-300';
    bold = true;
  } else if (/processing:|starting|completed|found.*file|ⓘ|Results:/i.test(message)) {
    colorClass = 'text-blue-400';
    if (!message.includes('ⓘ') && !message.includes('📊')) icon = 'ⓘ ';
  } else if (/moved?|rename|→|➜/i.test(message)) {
    colorClass = 'text-purple-400';
    if (!message.includes('➜') && !message.includes('→')) icon = '➜ ';
  }

  line.className = 'ct-log-line py-1 font-mono text-xs sm:text-sm flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-800/20';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'text-gray-500 text-[11px] font-mono select-none shrink-0';
  timeSpan.textContent = `[${formatLogTime(timestamp)}]`;
  timeSpan.title = timestamp;

  const msgSpan = document.createElement('span');
  msgSpan.className = colorClass + (bold ? ' font-semibold' : '') + ' wrap-break-word flex-1 min-w-[200px] leading-snug';

  const hasIcon = /^[✓✗⚠⊘❯ⓘ➜→⏳📊]/.test(message);
  msgSpan.textContent = (hasIcon ? '' : icon) + message;

  line.appendChild(timeSpan);
  line.appendChild(msgSpan);
  return line;
}

async function loadCtSavedLogs() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/logs`);
    const logs = await res.json();
    if (Array.isArray(logs) && logs.length > 0 && ctOutputDiv) {
      ctOutputDiv.innerHTML = '';
      seenLogEntries.clear();
      ctLogLineElements.clear();
      logs.forEach(entry => {
        applyCtLogEntry(entry);
        updateCtProgressFromLog(entry.message);
      });
      ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
    }
  } catch (error) {}
}

async function ctSyncLogsAndState() {
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

    // Also update pending/running state
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

let isCtModalInitializing = false;

function openCTModal() {
  const sm = global.syncManager;
  if (sm && sm.authEnabled && sm.userRole !== 'admin') {
    if (global.router && getRelativePath().startsWith('/tag-comics-now')) {
      const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
      global.router.navigate(path, true);
    }
    return;
  }

  if (isCtModalInitializing) return;
  if (!ctModal?.classList.contains('hidden')) return;
  
  isCtModalInitializing = true;

  if (!global._isNavigatingFromRouter && global.router) {
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
  if (ctOutputDiv) ctOutputDiv.innerHTML = '';
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

  // Start periodic background sync for logs & progress every 1.5s
  ctSyncInterval = setInterval(ctSyncLogsAndState, 1500);

  global.ctEventSource = new EventSource(`${global.API_BASE_URL}/api/v1/tag-comics-now/stream`);
  
  global.ctEventSource.onopen = () => {
    console.log('[CT] SSE stream connected');
  };

  global.ctEventSource.onerror = (err) => {
    console.warn('[CT] SSE stream disconnected, relying on live polling fallback');
  };

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

function setScanRunningUI(isRunning) {
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

async function runCtScan(mode = 'default') {
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

// DB-exact count of comics previously recorded as no-match; drives the
// "Rescan Unmatched (N)" button label and its disabled-at-zero state.
async function fetchCtScopeCounts() {
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

function clearCtMatches() {
  if (ctMatchBody) ctMatchBody.innerHTML = '';
  const previewContainer = document.getElementById('ct-preview-container');
  if (previewContainer) {
    previewContainer.innerHTML = '';
    previewContainer.classList.add('hidden');
  }
  
  const noMatchesDiv = document.getElementById('ct-no-matches');
  const matchTable = document.getElementById('ct-match-table');
  if (noMatchesDiv) noMatchesDiv.classList.remove('hidden');
  if (matchTable) matchTable.classList.add('hidden');
  if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
  const existingIndicator = document.getElementById('ct-pending-indicator');
  if (existingIndicator) existingIndicator.remove();
  lastRenderedFileName = null;
}

function closeCTModal() {
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

  if (global.router && getRelativePath().startsWith('/tag-comics-now')) {
    const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
    global.router.navigate(path, true);
  }

  if (typeof global.stopRenameStream === 'function') global.stopRenameStream();
  if (typeof global.stopMoveStream === 'function') global.stopMoveStream();
}

async function fetchCtSettings() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/schedule`);
    const data = await res.json();
    
    if (ctScheduleInput) ctScheduleInput.value = data.minutes || 0;

    const scanFolderInput = document.getElementById('ct-scan-folder-input');
    if (scanFolderInput) scanFolderInput.value = data.comicsLocation || '';

    const storageInput = document.getElementById('ct-storage-input');
    if (storageInput) storageInput.value = data.metadataStorage || 'archive';
    
    const upperInput = document.getElementById('ct-upper-threshold-input');
    if (upperInput) upperInput.value = Math.round((data.upperThreshold || 0.90) * 100);

    const lowerInput = document.getElementById('ct-lower-threshold-input');
    if (lowerInput) lowerInput.value = Math.round((data.lowerThreshold || 0.80) * 100);

    const cvKeyInput = document.getElementById('ct-cv-key-input');
    if (cvKeyInput) cvKeyInput.value = data.comicVineApiKey || '';

    const gbKeyInput = document.getElementById('ct-gb-key-input');
    if (gbKeyInput) gbKeyInput.value = data.googleBooksApiKey || '';

    const metronUserInput = document.getElementById('ct-metron-user-input');
    if (metronUserInput) metronUserInput.value = data.metronUser || '';

    const metronPassInput = document.getElementById('ct-metron-pass-input');
    if (metronPassInput && data.hasMetronPass) metronPassInput.placeholder = '•••••••• (saved)';

    const portInput = document.getElementById('ct-tagger-port-input');
    if (portInput) {
      let port = 5000;
      try {
        port = parseInt(new URL(data.taggerServiceUrl).port, 10) || 5000;
      } catch (_) {}
      portInput.value = port;
    }

    const engineStatus = document.getElementById('ct-engine-status');
    if (engineStatus) {
      engineStatus.textContent = data.serviceOnline ? '● Engine Ready' : '● Engine Offline';
    }

    // Source checkboxes
    const enabled = data.enabledSources || [];
    ['comicvine', 'metron', 'gcd', 'lcg', 'goodreads', 'blackwells', 'waterstones', 'googlebooks', 'amazon', 'forbiddenplanet'].forEach(s => {
      const cb = document.getElementById(`src-cb-${s}`);
      if (cb) {
        cb.checked = enabled.length === 0 || enabled.includes(`src-${s}`) || enabled.includes(s);
      }
    });

    const forceSettingCb = document.getElementById('ct-force-setting-cb');
    if (forceSettingCb) forceSettingCb.checked = !!data.forceReprocess;

    // Fetch Gemini settings
    try {
      const geminiRes = await fetch(`${global.API_BASE_URL}/api/v1/gemini/config?_t=${Date.now()}`);
      if (geminiRes.ok) {
        const geminiData = await geminiRes.json();
        if (typeof window !== 'undefined') {
          window._geminiState = window._geminiState || {};
          window._geminiState.termsAccepted = !!geminiData.termsAccepted;
          window._geminiState.hasApiKey = !!geminiData.hasApiKey;
          window._geminiState.enabled = geminiData.enabled !== false;
          window._geminiState.model = geminiData.model || 'gemini-3.5-flash-lite';
        }

        const geminiToggle = document.getElementById('ct-gemini-enabled-toggle');
        if (geminiToggle && geminiData.enabled !== undefined) {
          geminiToggle.checked = !!geminiData.enabled;
        }
        const geminiKeyInput = document.getElementById('ct-gemini-key-input');
        if (geminiKeyInput) {
          if (geminiData.hasApiKey && !geminiKeyInput.value) {
            geminiKeyInput.placeholder = '•••••••••••••••••••••••••••••••• (API Key set)';
          }
        }
        const dailyCapInput = document.getElementById('ct-gemini-daily-cap');
        if (dailyCapInput && geminiData.dailyCap) {
          dailyCapInput.value = geminiData.dailyCap;
        }
        const dailyUsedDiv = document.getElementById('ct-gemini-daily-used');
        if (dailyUsedDiv && geminiData.dailyUsed !== undefined) {
          dailyUsedDiv.textContent = `${geminiData.dailyUsed} requests used`;
        }

        if (typeof loadGeminiModels === 'function') {
          loadGeminiModels('', geminiData.model || 'gemini-3.5-flash-lite');
        }
      }
    } catch (_) {}
  } catch {}
}

let lastRenderedFileName = null;
let isFetchingCtDetails = false;
let ctFetchDebounceTimer = null;

function debouncedFetchPendingMatchDetails() {
  if (ctFetchDebounceTimer) clearTimeout(ctFetchDebounceTimer);
  ctFetchDebounceTimer = setTimeout(() => {
    fetchPendingMatchDetails();
  }, 300);
}

async function fetchPendingMatchDetails(isManual = false) {
  if (isFetchingCtDetails && !isManual) return;
  isFetchingCtDetails = true;

  try {
    const detailsRes = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/pending-details?_t=${Date.now()}`);
    if (!detailsRes.ok) throw new Error(`Status ${detailsRes.status}`);
    const details = await detailsRes.json();

    if (!details.waitingForResponse) {
      clearCtMatches();
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) existingIndicator.remove();
      if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
      return;
    }

    const matchesToRender = details.matches || [];

    if (details.fileName !== lastRenderedFileName) {
      clearCtMatches();
      const previewUrl = `${global.API_BASE_URL}/api/v1/tag-comics-now/preview?_t=${Date.now()}`;
      renderComicPreview(previewUrl, details.fileName);
      lastRenderedFileName = details.fileName;
    }

    let matchHtml = '';
    matchesToRender.forEach(match => {
      matchHtml += getCtMatchHtml(match);
    });

    const noMatchesDiv = document.getElementById('ct-no-matches');
    const matchTable = document.getElementById('ct-match-table');
    if (noMatchesDiv) noMatchesDiv.classList.add('hidden');
    if (matchTable) matchTable.classList.remove('hidden');
    
    if (ctMatchBody) ctMatchBody.innerHTML = matchHtml;
  } catch (error) {
    console.error('[CT] Error fetching match details:', error);
  } finally {
    isFetchingCtDetails = false;
  }
}

function getCtMatchHtml(match) {
  const meta = match.fullMetadata || {};
  const coverUrl = match.coverUrl || meta.cover_image_url || null;
  const score = match.score ? Math.round(match.score) : 85;
  const source = match.source || 'Online';
  const creators = [meta.writer, meta.penciller].filter(Boolean).join(', ');

  const sourceBadgeColors = {
    comicvine: 'bg-blue-900/60 text-blue-300 border-blue-700',
    metron: 'bg-purple-900/60 text-purple-300 border-purple-700',
    gcd: 'bg-green-900/60 text-green-300 border-green-700',
    lcg: 'bg-amber-900/60 text-amber-300 border-amber-700',
    goodreads: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
    blackwells: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
    waterstones: 'bg-indigo-900/60 text-indigo-300 border-indigo-700',
    googlebooks: 'bg-rose-900/60 text-rose-300 border-rose-700',
    google: 'bg-rose-900/60 text-rose-300 border-rose-700',
    amazon: 'bg-amber-900/60 text-amber-300 border-amber-700',
    amz: 'bg-amber-900/60 text-amber-300 border-amber-700'
  };
  const srcKey = (source || '').toLowerCase().replace(/[^a-z]/g, '');
  const badgeClass = sourceBadgeColors[srcKey] || 'bg-gray-800 text-gray-300 border-gray-600';

  return `
    <tr class="border-b border-gray-700 hover:bg-gray-800/80 transition-colors cursor-pointer" 
        onclick="const radio = this.querySelector('input[type=\\'radio\\']'); if (radio) radio.checked = true;">
      <td class="px-4 py-4 align-top w-12">
        <div class="flex items-center justify-center pt-2">
          <input type="radio"
                 name="ct-match-choice"
                 class="ct-match-select w-5 h-5 cursor-pointer accent-blue-500"
                 data-choice="${escapeHtml(match.choice)}"
                 id="match-${escapeHtml(match.choice)}"
                 ${match.choice === '1' ? 'checked' : ''}>
        </div>
      </td>
      <td class="py-4 pr-4">
        <div class="flex space-x-4">
          <div class="shrink-0 w-24">
            ${coverUrl
              ? `<img src="${escapeHtml(coverUrl)}" alt="Cover" class="w-full h-auto rounded border border-gray-700 shadow-md object-cover" loading="lazy">`
              : `<div class="w-full h-32 rounded border border-gray-700 bg-gray-950 flex items-center justify-center text-[10px] text-gray-600 uppercase text-center p-1">No Cover</div>`
            }
          </div>
          <label for="match-${escapeHtml(match.choice)}" class="flex-1 min-w-0 cursor-pointer">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-bold text-white text-base truncate">${escapeHtml(match.choice)}. ${escapeHtml(match.title)}</span>
              <span class="text-xs px-2 py-0.5 rounded border ${badgeClass} font-semibold">${escapeHtml(source)}</span>
              <span class="text-xs px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-800 font-bold">${score}% Match</span>
            </div>
            <div class="text-xs text-gray-300 space-y-1">
              <div><span class="text-gray-500">Publisher:</span> <span class="font-medium text-gray-200">${escapeHtml(match.publisher)}</span> ${match.year ? `• <span class="text-gray-400">Year: ${escapeHtml(match.year)}</span>` : ''} • <span class="text-gray-400">Issue #${escapeHtml(match.issue || '?')}</span></div>
              ${creators ? `<div><span class="text-gray-500">Creators:</span> <span class="text-gray-300">${escapeHtml(creators)}</span></div>` : ''}
              ${match.extra ? `<div class="italic text-gray-400 line-clamp-2 mt-1">${escapeHtml(match.extra)}</div>` : ''}
            </div>
          </label>
        </div>
      </td>
    </tr>`;
}

function renderComicPreview(url, fileName) {
  const previewContainer = document.getElementById('ct-preview-container');
  if (!previewContainer) return;

  previewContainer.innerHTML = `
    <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700 flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-6">
      <div class="shrink-0">
        ${url 
          ? `<img src="${escapeHtml(url)}" class="w-40 h-auto rounded-lg shadow-xl border border-gray-600 object-cover" alt="Comic Preview">`
          : `<div class="w-40 h-56 rounded-lg bg-gray-950 flex items-center justify-center border border-dashed border-gray-700 text-gray-500 text-xs text-center px-2">Cover Preview</div>`
        }
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">Awaiting Review</div>
        <div class="text-lg font-bold text-white break-all mb-2">${escapeHtml(fileName)}</div>
        <p class="text-xs text-gray-400 mb-3">Multiple candidate matches were found across metadata sources. Select the best match below and click Apply.</p>
      </div>
    </div>
  `;
  previewContainer.classList.remove('hidden');
}

async function saveCtSettings() {
  const schedule = parseInt(ctScheduleInput?.value, 10) || 0;
  const scanFolderInput = document.getElementById('ct-scan-folder-input');
  const comicsLocation = scanFolderInput ? scanFolderInput.value.trim() : '';
  const storageInput = document.getElementById('ct-storage-input');
  const metadataStorage = storageInput ? storageInput.value : 'archive';
  
  const upperInput = document.getElementById('ct-upper-threshold-input');
  const upperThreshold = upperInput ? parseFloat(upperInput.value) / 100.0 : 0.90;

  const lowerInput = document.getElementById('ct-lower-threshold-input');
  const lowerThreshold = lowerInput ? parseFloat(lowerInput.value) / 100.0 : 0.80;

  const cvKeyInput = document.getElementById('ct-cv-key-input');
  const comicVineApiKey = cvKeyInput ? cvKeyInput.value.trim() : '';

  const gbKeyInput = document.getElementById('ct-gb-key-input');
  const googleBooksApiKey = gbKeyInput ? gbKeyInput.value.trim() : '';

  const metronUserInput = document.getElementById('ct-metron-user-input');
  const metronUser = metronUserInput ? metronUserInput.value.trim() : '';

  const metronPassInput = document.getElementById('ct-metron-pass-input');
  const metronPassword = metronPassInput ? metronPassInput.value.trim() : '';

  const portInput = document.getElementById('ct-tagger-port-input');
  const taggerServicePort = portInput ? parseInt(portInput.value, 10) : NaN;

  const forceSettingCb = document.getElementById('ct-force-setting-cb');
  const forceReprocess = forceSettingCb ? forceSettingCb.checked : false;

  const enabledSources = [];
  ['comicvine', 'metron', 'gcd', 'lcg', 'goodreads', 'blackwells', 'waterstones', 'googlebooks', 'amazon', 'forbiddenplanet'].forEach(s => {
    const cb = document.getElementById(`src-cb-${s}`);
    if (cb && cb.checked) {
      enabledSources.push(`src-${s}`);
    }
  });

  const geminiToggle = document.getElementById('ct-gemini-enabled-toggle');
  const geminiKeyInput = document.getElementById('ct-gemini-key-input');
  const geminiVal = geminiKeyInput ? geminiKeyInput.value.trim() : '';
  const geminiEnabled = geminiToggle ? geminiToggle.checked : false;
  const geminiState = (typeof window !== 'undefined' && window._geminiState) ? window._geminiState : {};

  if (geminiEnabled && (geminiVal || geminiState.hasApiKey) && !geminiState.termsAccepted) {
    initGeminiComplianceModal();
    openGeminiComplianceModal(geminiVal);
    return;
  }

  const saveBtn = document.getElementById('ct-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minutes: schedule,
        comicsLocation,
        metadataStorage,
        upperThreshold,
        lowerThreshold,
        comicVineApiKey,
        googleBooksApiKey,
        metronUser,
        metronPassword,
        enabledSources,
        forceReprocess,
        ...(Number.isInteger(taggerServicePort) && taggerServicePort >= 1 && taggerServicePort <= 65535
          ? { taggerServicePort }
          : {})
      })
    });
    if (res.ok) {
      if (geminiState.termsAccepted) {
        const geminiPayload = {
          geminiCoverMatchEnabled: geminiEnabled,
          geminiTermsAccepted: true
        };
        if (geminiVal) {
          geminiPayload.geminiApiKey = geminiVal;
        }
        fetch(`${global.API_BASE_URL}/api/v1/gemini/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload)
        }).catch(function() {});
      }

      if (saveBtn) {
        saveBtn.textContent = '✓ Saved';
        setTimeout(() => {
          saveBtn.textContent = 'Save Settings';
          saveBtn.disabled = false;
        }, 1500);
      }
    } else {
      throw new Error('Save failed');
    }
  } catch (err) {
    if (saveBtn) {
      saveBtn.textContent = '✗ Error';
      saveBtn.disabled = false;
    }
  }
}

let geminiModelFetchTimer = null;

async function loadGeminiModels(apiKey = '', targetModel = '') {
  const modelSelect = document.getElementById('ct-gemini-model-select');
  const statusSpan = document.getElementById('ct-gemini-models-status');
  if (!modelSelect) return;

  const currentVal = targetModel || modelSelect.value || (window._geminiState?.model) || 'gemini-3.5-flash-lite';
  if (statusSpan && apiKey) {
    statusSpan.textContent = 'Querying available Flash-Lite models...';
  }

  try {
    const url = apiKey
      ? `${global.API_BASE_URL}/api/v1/gemini/models?apiKey=${encodeURIComponent(apiKey)}`
      : `${global.API_BASE_URL}/api/v1/gemini/models`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];

    if (models.length > 0) {
      modelSelect.innerHTML = '';
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.displayName || m.id;
        if (m.id === currentVal) opt.selected = true;
        modelSelect.appendChild(opt);
      });

      if (!models.some(m => m.id === currentVal)) {
        const opt = document.createElement('option');
        opt.value = currentVal;
        opt.textContent = currentVal;
        opt.selected = true;
        modelSelect.appendChild(opt);
      }

      if (statusSpan) {
        if (data.source === 'gemini-api') {
          statusSpan.textContent = `✓ ${models.length} Flash-Lite models available`;
        } else {
          statusSpan.textContent = 'Default: 3.5 Flash-Lite';
        }
      }
    }
  } catch (err) {
    if (statusSpan) {
      statusSpan.textContent = 'Default: 3.5 Flash-Lite';
    }
  }
}

function openGeminiComplianceModal(prefillKey) {
  const modal = document.getElementById('gemini-compliance-modal');
  if (!modal) return;
  const keyInput = document.getElementById('gemini-modal-key-input');
  const agreeCb = document.getElementById('gemini-modal-agree-cb');
  const saveBtn = document.getElementById('gemini-modal-save-btn');

  if (agreeCb) agreeCb.checked = false;
  if (keyInput) {
    if (prefillKey) {
      keyInput.value = prefillKey;
    } else if (typeof window !== 'undefined' && window._geminiState?.hasApiKey) {
      keyInput.placeholder = '•••••••••••••••••••••••••••••••• (API Key set)';
    }
  }
  if (saveBtn) {
    const hasKey = (keyInput && keyInput.value.trim().length > 0) || !!(typeof window !== 'undefined' && window._geminiState?.hasApiKey);
    saveBtn.disabled = !agreeCb?.checked || !hasKey;
  }
  modal.classList.remove('hidden');
}

function initGeminiComplianceModal() {
  const modal = document.getElementById('gemini-compliance-modal');
  if (!modal || modal.dataset.geminiInitialized) return;
  modal.dataset.geminiInitialized = 'true';

  const keyInput = document.getElementById('gemini-modal-key-input');
  const agreeCb = document.getElementById('gemini-modal-agree-cb');
  const saveBtn = document.getElementById('gemini-modal-save-btn');
  const disagreeBtn = document.getElementById('gemini-modal-disagree-btn');

  function checkFormValidity() {
    const hasAgreed = !!agreeCb?.checked;
    const keyVal = keyInput ? keyInput.value.trim() : '';
    const hasKey = keyVal.length > 0 || !!(typeof window !== 'undefined' && window._geminiState?.hasApiKey);
    if (saveBtn) {
      saveBtn.disabled = !hasAgreed || !hasKey;
    }
  }

  agreeCb?.addEventListener('change', checkFormValidity);
  keyInput?.addEventListener('input', checkFormValidity);

  disagreeBtn?.addEventListener('click', function() {
    modal.classList.add('hidden');
    const ctKeyInput = document.getElementById('ct-gemini-key-input');
    const ctEnabledToggle = document.getElementById('ct-gemini-enabled-toggle');
    if (ctKeyInput) ctKeyInput.value = '';
    if (ctEnabledToggle) ctEnabledToggle.checked = false;

    fetch(`${global.API_BASE_URL}/api/v1/gemini/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geminiCoverMatchEnabled: false, geminiTermsAccepted: false })
    }).catch(function() {});
  });

  saveBtn?.addEventListener('click', async function() {
    if (!agreeCb?.checked) return;
    const keyVal = keyInput ? keyInput.value.trim() : '';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const modelSelect = document.getElementById('ct-gemini-model-select');
      const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.5-flash-lite';
      const capInput = document.getElementById('ct-gemini-daily-cap');
      const dailyCap = capInput ? parseInt(capInput.value, 10) : 450;

      const payload = {
        geminiCoverMatchEnabled: true,
        geminiTermsAccepted: true,
        geminiModel: selectedModel,
        geminiCoverDailyCap: dailyCap
      };
      if (keyVal) payload.geminiApiKey = keyVal;

      const res = await fetch(`${global.API_BASE_URL}/api/v1/gemini/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        if (typeof window !== 'undefined') {
          window._geminiState = window._geminiState || {};
          window._geminiState.termsAccepted = true;
          window._geminiState.hasApiKey = true;
          window._geminiState.enabled = true;
          window._geminiState.model = selectedModel;
        }

        const ctKeyInput = document.getElementById('ct-gemini-key-input');
        const ctEnabledToggle = document.getElementById('ct-gemini-enabled-toggle');

        if (ctKeyInput) {
          ctKeyInput.value = '';
          ctKeyInput.placeholder = '•••••••••••••••••••••••••••••••• (API Key set)';
        }
        if (ctEnabledToggle) {
          ctEnabledToggle.checked = true;
        }

        modal.classList.add('hidden');

        // Continue saving settings
        saveCtSettings();
      } else {
        const errData = await res.json().catch(function() { return {}; });
        alert('Failed to save configuration: ' + (errData.error || 'Server error'));
      }
    } catch (err) {
      alert('Network error saving configuration');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Configuration';
    }
  });

  // Key toggle show/hide
  const toggleBtn = document.getElementById('ct-gemini-key-toggle');
  const ctKeyInput = document.getElementById('ct-gemini-key-input');
  if (toggleBtn && ctKeyInput) {
    toggleBtn.addEventListener('click', function() {
      if (ctKeyInput.type === 'password') {
        ctKeyInput.type = 'text';
        toggleBtn.textContent = 'Hide';
      } else {
        ctKeyInput.type = 'password';
        toggleBtn.textContent = 'Show';
      }
    });
  }

  // Dynamic model querying on entering API key
  if (ctKeyInput) {
    ctKeyInput.addEventListener('input', function() {
      const val = ctKeyInput.value.trim();
      if (geminiModelFetchTimer) clearTimeout(geminiModelFetchTimer);
      if (val.length >= 8) {
        geminiModelFetchTimer = setTimeout(() => {
          loadGeminiModels(val);
        }, 600);
      }
    });
  }

  // Dedicated Save Gemini Settings Button
  const geminiSaveBtn = document.getElementById('ct-gemini-save-btn');
  if (geminiSaveBtn && !geminiSaveBtn.dataset.bound) {
    geminiSaveBtn.dataset.bound = 'true';
    geminiSaveBtn.addEventListener('click', async function() {
      const isEnabled = document.getElementById('ct-gemini-enabled-toggle')?.checked ?? true;
      const keyVal = ctKeyInput ? ctKeyInput.value.trim() : '';
      const modelSelect = document.getElementById('ct-gemini-model-select');
      const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.5-flash-lite';
      const capInput = document.getElementById('ct-gemini-daily-cap');
      const dailyCap = capInput ? parseInt(capInput.value, 10) : 450;
      const state = window._geminiState || {};

      if (!state.termsAccepted && isEnabled && (keyVal || state.hasApiKey)) {
        openGeminiComplianceModal(keyVal);
        return;
      }

      geminiSaveBtn.disabled = true;
      geminiSaveBtn.textContent = 'Saving...';

      try {
        const payload = {
          geminiCoverMatchEnabled: isEnabled,
          geminiTermsAccepted: true,
          geminiModel: selectedModel,
          geminiCoverDailyCap: dailyCap
        };
        if (keyVal) payload.geminiApiKey = keyVal;

        const res = await fetch(`${global.API_BASE_URL}/api/v1/gemini/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          state.termsAccepted = true;
          if (keyVal) state.hasApiKey = true;
          state.enabled = isEnabled;
          state.model = selectedModel;

          geminiSaveBtn.textContent = '✓ Saved';
          if (keyVal && ctKeyInput) {
            ctKeyInput.value = '';
            ctKeyInput.placeholder = '•••••••••••••••••••••••••••••••• (API Key set)';
          }
          setTimeout(() => {
            geminiSaveBtn.textContent = 'Save Gemini Settings';
            geminiSaveBtn.disabled = false;
          }, 1500);
        } else {
          geminiSaveBtn.textContent = '✗ Error';
          geminiSaveBtn.disabled = false;
        }
      } catch (_) {
        geminiSaveBtn.textContent = '✗ Error';
        geminiSaveBtn.disabled = false;
      }
    });
  }
}

async function loadScanLogs() {
  const container = document.getElementById('ct-logs-container');
  if (!container) return;

  container.innerHTML = '<div class="text-center py-8 text-sm text-gray-400">Loading scan logs...</div>';

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
      container.innerHTML = '<div class="text-center py-8 text-sm text-gray-500">No past scan logs found.</div>';
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
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="text-center py-8 text-sm text-red-400">Failed to load scan logs: ${escapeHtml(err.message)}</div>`;
  }
}

async function clearTrackingHistory() {
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

function showCtConfirm(action) {
  if (!ctConfirmBar) return;
  ctConfirmBar.classList.remove('hidden');
  ctConfirmBar.dataset.action = action;
  if (ctConfirmMessage) {
    ctConfirmMessage.textContent = action === 'apply' ? 'Apply this match metadata to comic?' : 'Skip this comic?';
  }
  if (ctConfirmYes) ctConfirmYes.focus();
}

async function handleCtConfirmYes() {
  // Single-flight: the button can be double-clicked and Enter fires too;
  // a second in-flight confirmation would hit the server after the first
  // already resolved the review.
  if (isConfirmingCt) return;
  const action = ctConfirmBar?.dataset.action;
  isConfirmingCt = true;

  try {
    let res;
    if (action === 'apply') {
      const selected = document.querySelector('.ct-match-select:checked');
      const choice = selected ? selected.dataset.choice : '1';

      res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections: [choice] })
      });
    } else {
      res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/skip`, {
        method: 'POST'
      });
    }

    if (!res || !res.ok) {
      let detail = res ? `request failed (${res.status})` : 'network error';
      try {
        const data = await res.json();
        if (data && data.message) detail = data.message;
      } catch (_) {}
      appendLocalCtLogLine(`✗ Error: ${detail}`);
      return;
    }

    ctConfirmBar?.classList.add('hidden');
    clearCtMatches();
    fetchCtScopeCounts();
    setTimeout(() => checkPendingMatch(), 500);
  } catch (err) {
    appendLocalCtLogLine(`✗ Error: ${err.message}`);
  } finally {
    isConfirmingCt = false;
  }
}

function handleCtConfirmNo() {
  ctConfirmBar?.classList.add('hidden');
}

async function migrateLibraryMetadata() {
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

async function cancelCtScan() {
  const cancelBtn = document.getElementById('ct-cancel-btn');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling...';
  }
  try {
    await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/cancel`, { method: 'POST' });
    await checkPendingMatch();
    if (ctTabMatches && ctTabMatches.classList.contains('active')) {
      debouncedFetchPendingMatchDetails();
    }
  } catch (err) {
    console.error('Failed to cancel scan:', err);
  } finally {
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> Cancel Scan';
    }
  }
}

// Wire buttons
if (typeof window !== 'undefined') {
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
    if (ctOutputDiv) ctOutputDiv.innerHTML = '';
    ctLogLineElements.clear();
  });
  initGeminiComplianceModal();
}

// Periodic check for pending matches on CT button
async function updateCtButtonIndicator() {
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

if (typeof window !== 'undefined') {
  setInterval(updateCtButtonIndicator, 10000);
  setTimeout(updateCtButtonIndicator, 2000);
}

export {
  checkPendingMatch,
  formatCtLogMessage,
  loadCtSavedLogs,
  openCTModal,
  clearCtMatches,
  closeCTModal,
  fetchCtSettings,
  debouncedFetchPendingMatchDetails,
  fetchPendingMatchDetails,
  getCtMatchHtml,
  renderComicPreview,
  saveCtSettings,
  loadScanLogs,
  clearTrackingHistory,
  showCtConfirm,
  handleCtConfirmYes,
  handleCtConfirmNo,
  updateCtButtonIndicator,
  ctSyncLogsAndState
};

state.checkPendingMatch = checkPendingMatch;
state.formatCtLogMessage = formatCtLogMessage;
state.loadCtSavedLogs = loadCtSavedLogs;
state.ctSyncLogsAndState = ctSyncLogsAndState;
state.openCTModal = openCTModal;
state.clearCtMatches = clearCtMatches;
state.closeCTModal = closeCTModal;
state.fetchCtSettings = fetchCtSettings;
state.debouncedFetchPendingMatchDetails = debouncedFetchPendingMatchDetails;
state.fetchPendingMatchDetails = fetchPendingMatchDetails;
state.getCtMatchHtml = getCtMatchHtml;
state.renderComicPreview = renderComicPreview;
state.saveCtSettings = saveCtSettings;
state.loadScanLogs = loadScanLogs;
state.clearTrackingHistory = clearTrackingHistory;
state.showCtConfirm = showCtConfirm;
state.handleCtConfirmYes = handleCtConfirmYes;
state.handleCtConfirmNo = handleCtConfirmNo;
state.updateCtButtonIndicator = updateCtButtonIndicator;

if (typeof window !== 'undefined') {
  window.checkPendingMatch = checkPendingMatch;
  window.formatCtLogMessage = formatCtLogMessage;
  window.loadCtSavedLogs = loadCtSavedLogs;
  window.ctSyncLogsAndState = ctSyncLogsAndState;
  window.openCTModal = openCTModal;
  window.clearCtMatches = clearCtMatches;
  window.closeCTModal = closeCTModal;
  window.fetchCtSettings = fetchCtSettings;
  window.debouncedFetchPendingMatchDetails = debouncedFetchPendingMatchDetails;
  window.fetchPendingMatchDetails = fetchPendingMatchDetails;
  window.getCtMatchHtml = getCtMatchHtml;
  window.renderComicPreview = renderComicPreview;
  window.saveCtSettings = saveCtSettings;
  window.loadScanLogs = loadScanLogs;
  window.clearTrackingHistory = clearTrackingHistory;
  window.showCtConfirm = showCtConfirm;
  window.handleCtConfirmYes = handleCtConfirmYes;
  window.handleCtConfirmNo = handleCtConfirmNo;
  window.updateCtButtonIndicator = updateCtButtonIndicator;
}
