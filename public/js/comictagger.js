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
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/pending`);
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
    }
  } catch (error) {}
}

const seenLogEntries = new Set();
let ctSyncInterval = null;

function updateCtProgressFromLog(message) {
  if (!message || typeof message !== 'string') return;

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
      badge.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-blue-900/60 text-blue-300 border border-blue-700/50 flex-shrink-0';
    }
    if (pulse) {
      pulse.className = 'inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0';
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

    if (/Rate defense|cooldown|waiting/i.test(msg)) {
      if (badge) {
        badge.textContent = 'Rate Limit Wait';
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-amber-900/60 text-amber-300 border border-amber-700/50 flex-shrink-0';
      }
      if (pulse) {
        pulse.className = 'inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0';
      }
    } else if (/Candidate found|Match found|High-confidence/i.test(msg)) {
      if (badge) {
        badge.textContent = 'Match Found';
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 flex-shrink-0';
      }
      if (pulse) {
        pulse.className = 'inline-block w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0';
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
      badge.className = 'px-2 py-0.5 rounded text-[10px] font-medium bg-green-900/60 text-green-300 border border-green-700/50 flex-shrink-0';
    }
    if (pulse) {
      pulse.className = 'inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0';
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

function formatCtLogMessage(timestamp, message) {
  const line = document.createElement('div');
  line.className = 'ct-log-line py-0.5 font-mono text-sm';

  if (/^[━─]+$/.test(message)) {
    line.className = 'ct-log-separator border-b border-gray-700 my-1';
    return line;
  }

  let colorClass = 'text-gray-300';
  let icon = '';
  let bold = false;

  // Check for live step progress "↳ [Source] ..."
  const streamStepMatch = /^\s*↳\s*\[(.*?)\]\s*(.*)$/.exec(message);
  if (streamStepMatch) {
    line.className = 'ct-log-line py-0.5 font-mono text-xs pl-4 flex flex-wrap items-baseline gap-1.5 max-w-full break-words';
    const src = streamStepMatch[1];
    const subMsg = streamStepMatch[2];

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-gray-600 mr-1 text-[11px] flex-shrink-0';
    timeSpan.textContent = `[${timestamp}]`;

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'text-gray-500 font-bold flex-shrink-0';
    arrowSpan.textContent = '↳';

    const srcBadge = document.createElement('span');
    srcBadge.className = 'px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-blue-300 border border-blue-900/50 flex-shrink-0';
    srcBadge.textContent = src;

    const msgSpan = document.createElement('span');
    msgSpan.style.wordBreak = 'break-word';
    msgSpan.style.overflowWrap = 'anywhere';
    if (/Rate defense|cooldown|waiting/i.test(subMsg)) {
      line.dataset.logType = 'rate-defense';
      msgSpan.className = 'text-amber-400 flex items-center gap-1 min-w-0 break-words flex-1';
      msgSpan.innerHTML = `<span>⏳</span> <span>${escapeHtml(subMsg)}</span>`;
    } else if (/Candidate found|Match found|High-confidence|Early exit/i.test(subMsg)) {
      msgSpan.className = 'text-emerald-400 font-semibold min-w-0 break-words flex-1';
      msgSpan.textContent = `✓ ${subMsg}`;
    } else if (/No match found/i.test(subMsg)) {
      msgSpan.className = 'text-gray-400 min-w-0 break-words flex-1';
      msgSpan.textContent = `✗ ${subMsg}`;
    } else if (/Search failed|Error/i.test(subMsg)) {
      msgSpan.className = 'text-red-400 min-w-0 break-words flex-1';
      msgSpan.textContent = `✗ ${subMsg}`;
    } else {
      msgSpan.className = 'text-teal-300 min-w-0 break-words flex-1';
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

  const timeSpan = document.createElement('span');
  timeSpan.className = 'text-gray-600 mr-2 text-xs flex-shrink-0';
  timeSpan.textContent = `[${timestamp}]`;

  const msgSpan = document.createElement('span');
  msgSpan.className = colorClass + (bold ? ' font-semibold' : '') + ' break-words';
  msgSpan.style.wordBreak = 'break-word';
  msgSpan.style.overflowWrap = 'anywhere';

  const hasIcon = /^[✓✗⚠⊘❯ⓘ➜→⏳📊]/.test(message);
  msgSpan.textContent = (hasIcon ? '' : icon) + message;

  line.appendChild(timeSpan);
  line.appendChild(msgSpan);
  return line;
}

async function loadCtSavedLogs() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/logs`);
    const logs = await res.json();
    if (Array.isArray(logs) && logs.length > 0 && ctOutputDiv) {
      ctOutputDiv.innerHTML = '';
      seenLogEntries.clear();
      logs.forEach(entry => {
        const isRateDefense = /Rate defense|cooldown|waiting/i.test(entry.message);
        const lastChild = ctOutputDiv.lastElementChild;
        if (isRateDefense && lastChild && lastChild.dataset && lastChild.dataset.logType === 'rate-defense') {
          const logLine = formatCtLogMessage(entry.timestamp, entry.message);
          ctOutputDiv.replaceChild(logLine, lastChild);
        } else {
          const entryKey = `${entry.timestamp}_${entry.message}`;
          seenLogEntries.add(entryKey);
          const logLine = formatCtLogMessage(entry.timestamp, entry.message);
          ctOutputDiv.appendChild(logLine);
        }
        updateCtProgressFromLog(entry.message);
      });
      ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
    }
  } catch (error) {}
}

async function ctSyncLogsAndState() {
  if (!ctModal || ctModal.classList.contains('hidden')) return;

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/logs`);
    if (!res.ok) return;
    const logs = await res.json();
    if (Array.isArray(logs) && ctOutputDiv) {
      let appended = false;
      logs.forEach(entry => {
        const isRateDefense = /Rate defense|cooldown|waiting/i.test(entry.message);
        const lastChild = ctOutputDiv.lastElementChild;
        if (isRateDefense && lastChild && lastChild.dataset && lastChild.dataset.logType === 'rate-defense') {
          const logLine = formatCtLogMessage(entry.timestamp, entry.message);
          ctOutputDiv.replaceChild(logLine, lastChild);
          updateCtProgressFromLog(entry.message);
          appended = true;
        } else {
          const entryKey = `${entry.timestamp}_${entry.message}`;
          if (!seenLogEntries.has(entryKey)) {
            seenLogEntries.add(entryKey);
            const logLine = formatCtLogMessage(entry.timestamp, entry.message);
            ctOutputDiv.appendChild(logLine);
            updateCtProgressFromLog(entry.message);
            appended = true;
          }
        }
      });
      if (appended) {
        ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
      }
    }

    // Also update pending/running state
    const pendingRes = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/pending`);
    if (pendingRes.ok) {
      const pending = await pendingRes.json();
      if (pending && pending.isRunning !== undefined) {
        setScanRunningUI(!!pending.isRunning);
      }
      if (pending && pending.waitingForResponse) {
        checkPendingMatch();
      }
    }
  } catch (_) {}
}

let isCtModalInitializing = false;

function openCTModal() {
  const sm = global.syncManager;
  if (sm && sm.authEnabled && sm.userRole !== 'admin') {
    if (global.router && getRelativePath().startsWith('/comictagger')) {
      const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
      global.router.navigate(path, true);
    }
    return;
  }

  if (isCtModalInitializing) return;
  if (!ctModal?.classList.contains('hidden')) return;
  
  isCtModalInitializing = true;

  if (!global._isNavigatingFromRouter && global.router) {
    if (!getRelativePath().startsWith('/comictagger')) {
      global.router.navigate('/comictagger/output', true);
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

  loadCtSavedLogs();

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

  global.ctEventSource = new EventSource(`${global.API_BASE_URL}/api/v1/comictagger/stream`);
  
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
      const entryKey = `${data.timestamp}_${msg}`;
      const isRateDefense = /Rate defense|cooldown|waiting/i.test(msg);
      const lastChild = ctOutputDiv ? ctOutputDiv.lastElementChild : null;

      if ((data.isUpdate || isRateDefense) && lastChild && lastChild.dataset && lastChild.dataset.logType === 'rate-defense') {
        const updatedLine = formatCtLogMessage(data.timestamp, msg);
        ctOutputDiv.replaceChild(updatedLine, lastChild);
      } else if (ctOutputDiv && !seenLogEntries.has(entryKey)) {
        seenLogEntries.add(entryKey);
        const logLine = formatCtLogMessage(data.timestamp, msg);
        ctOutputDiv.appendChild(logLine);
        ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
      }

      updateCtProgressFromLog(msg);

      if (/Review required/i.test(msg) || /WAITING FOR USER SELECTION/i.test(msg)) {
        checkPendingMatch();
        if (ctTabMatches && ctTabMatches.classList.contains('active')) {
          debouncedFetchPendingMatchDetails();
        }
      }
    } catch (err) {}
  };
}

function setScanRunningUI(isRunning) {
  const runBtn = document.getElementById('ct-run-btn');
  const cancelBtn = document.getElementById('ct-cancel-btn');
  const statusText = document.getElementById('ct-scan-status-text');

  if (isRunning) {
    if (runBtn) runBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (statusText) statusText.textContent = 'Scanning comic library in progress...';
  } else {
    if (runBtn) runBtn.classList.remove('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (statusText) statusText.textContent = 'Ready to scan comic library';
  }
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
  lastRenderedMatchesHash = null;
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
  lastRenderedMatchesHash = null;

  if (global.router && getRelativePath().startsWith('/comictagger')) {
    const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
    global.router.navigate(path, true);
  }

  if (typeof global.stopRenameStream === 'function') global.stopRenameStream();
  if (typeof global.stopMoveStream === 'function') global.stopMoveStream();
}

async function fetchCtSettings() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/schedule`);
    const data = await res.json();
    
    if (ctScheduleInput) ctScheduleInput.value = data.minutes || 0;
    
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

    // Source checkboxes
    const enabled = data.enabledSources || [];
    ['comicvine', 'metron', 'gcd', 'lcg', 'goodreads', 'blackwells', 'waterstones', 'googlebooks', 'amazon'].forEach(s => {
      const cb = document.getElementById(`src-cb-${s}`);
      if (cb) {
        cb.checked = enabled.length === 0 || enabled.includes(`src-${s}`) || enabled.includes(s);
      }
    });

    const forceScanCb = document.getElementById('ct-force-scan-cb');
    const forceSettingCb = document.getElementById('ct-force-setting-cb');
    const isForce = !!data.forceReprocess;
    if (forceScanCb) forceScanCb.checked = isForce;
    if (forceSettingCb) forceSettingCb.checked = isForce;
  } catch {}
}

let lastRenderedMatchesHash = null;
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
    const detailsRes = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/pending-details?_t=${Date.now()}`);
    if (!detailsRes.ok) throw new Error(`Status ${detailsRes.status}`);
    const details = await detailsRes.json();

    if (!details.waitingForResponse) {
      return;
    }

    const matchesToRender = details.matches || [];

    if (details.fileName !== lastRenderedFileName) {
      clearCtMatches();
      const previewUrl = `${global.API_BASE_URL}/api/v1/comictagger/preview?_t=${Date.now()}`;
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
          <div class="flex-shrink-0 w-24">
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
      <div class="flex-shrink-0">
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

  const forceSettingCb = document.getElementById('ct-force-setting-cb');
  const forceScanCb = document.getElementById('ct-force-scan-cb');
  const forceReprocess = forceSettingCb ? forceSettingCb.checked : (forceScanCb ? forceScanCb.checked : false);

  const enabledSources = [];
  ['comicvine', 'metron', 'gcd', 'lcg', 'goodreads', 'blackwells', 'waterstones', 'googlebooks', 'amazon'].forEach(s => {
    const cb = document.getElementById(`src-cb-${s}`);
    if (cb && cb.checked) {
      enabledSources.push(`src-${s}`);
    }
  });

  const saveBtn = document.getElementById('ct-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minutes: schedule,
        metadataStorage,
        upperThreshold,
        lowerThreshold,
        comicVineApiKey,
        googleBooksApiKey,
        metronUser,
        metronPassword,
        enabledSources,
        forceReprocess
      })
    });
    if (res.ok) {
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

async function performManualSearch() {
  const queryInput = document.getElementById('ct-search-query-input');
  const sourceSelect = document.getElementById('ct-search-source-select');
  const resultsContainer = document.getElementById('ct-search-results-container');
  const submitBtn = document.getElementById('ct-search-submit-btn');

  const query = queryInput ? queryInput.value.trim() : '';
  const source = sourceSelect ? sourceSelect.value : 'comicvine';

  if (!query) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Searching...';
  }
  if (resultsContainer) {
    resultsContainer.innerHTML = '<div class="text-center py-8 text-sm text-gray-400"><svg class="animate-spin h-6 w-6 text-blue-400 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Searching across providers...</div>';
  }

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, source })
    });
    const data = await res.json();
    const results = data.results || [];

    if (!resultsContainer) return;

    if (results.length === 0) {
      resultsContainer.innerHTML = `<div class="text-center py-8 text-sm text-gray-500">No results found on ${escapeHtml(source)} for "${escapeHtml(query)}".</div>`;
      return;
    }

    let html = '';
    results.forEach((item, idx) => {
      const cover = item.cover_image_url || null;
      html += `
        <div class="bg-gray-800 p-4 rounded-lg border border-gray-700 flex gap-4 items-start">
          <div class="w-20 flex-shrink-0">
            ${cover
              ? `<img src="${escapeHtml(cover)}" class="w-full rounded border border-gray-700" alt="Cover">`
              : `<div class="w-full h-28 rounded bg-gray-900 flex items-center justify-center text-[10px] text-gray-600 text-center">No Cover</div>`
            }
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h5 class="font-bold text-white text-base truncate">${escapeHtml(item.title || 'Untitled')}</h5>
              <span class="text-xs px-2 py-0.5 rounded bg-blue-900/50 text-blue-300 border border-blue-700 font-semibold">${escapeHtml(source)}</span>
            </div>
            <div class="text-xs text-gray-300 space-y-0.5 mb-2">
              <div><span class="text-gray-500">Publisher:</span> ${escapeHtml(item.publisher || 'Unknown')} • <span class="text-gray-500">Issue:</span> #${escapeHtml(item.issue || item.number || '?')} ${item.year ? `• Year: ${escapeHtml(item.year)}` : ''}</div>
              ${item.writer ? `<div><span class="text-gray-500">Writer:</span> ${escapeHtml(item.writer)}</div>` : ''}
              ${item.description ? `<div class="text-gray-400 line-clamp-2 italic">${escapeHtml(item.description)}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    });
    resultsContainer.innerHTML = html;
  } catch (err) {
    if (resultsContainer) {
      resultsContainer.innerHTML = `<div class="text-center py-8 text-sm text-red-400">Search failed: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><use href="#icon-search"></use></svg> Search';
    }
  }
}

async function loadScanLogs() {
  const container = document.getElementById('ct-logs-container');
  if (!container) return;

  container.innerHTML = '<div class="text-center py-8 text-sm text-gray-400">Loading scan logs...</div>';

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/scan-logs`);
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
          <div class="flex items-center gap-2 flex-shrink-0">
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
    await fetch(`${global.API_BASE_URL}/api/v1/comictagger/clear-history`, { method: 'POST' });
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
  const action = ctConfirmBar?.dataset.action;

  if (action === 'apply') {
    const selected = document.querySelector('.ct-match-select:checked');
    const choice = selected ? selected.dataset.choice : '1';

    await fetch(`${global.API_BASE_URL}/api/v1/comictagger/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections: [choice] })
    });
  } else {
    await fetch(`${global.API_BASE_URL}/api/v1/comictagger/skip`, {
      method: 'POST'
    });
  }

  ctConfirmBar?.classList.add('hidden');
  clearCtMatches();
  setTimeout(() => checkPendingMatch(), 500);
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
    await fetch(`${global.API_BASE_URL}/api/v1/comictagger/cancel`, { method: 'POST' });
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
  document.getElementById('ct-grab-btn')?.addEventListener('click', () => fetchPendingMatchDetails(true));
  document.getElementById('ct-apply-btn')?.addEventListener('click', () => showCtConfirm('apply'));
  document.getElementById('ct-skip-btn')?.addEventListener('click', () => showCtConfirm('skip'));
  document.getElementById('ct-confirm-yes')?.addEventListener('click', handleCtConfirmYes);
  document.getElementById('ct-confirm-no')?.addEventListener('click', handleCtConfirmNo);
  const forceScanCb = document.getElementById('ct-force-scan-cb');
  const forceSettingCb = document.getElementById('ct-force-setting-cb');
  forceScanCb?.addEventListener('change', () => {
    if (forceSettingCb) forceSettingCb.checked = forceScanCb.checked;
  });
  forceSettingCb?.addEventListener('change', () => {
    if (forceScanCb) forceScanCb.checked = forceSettingCb.checked;
  });

  document.getElementById('ct-run-btn')?.addEventListener('click', async () => {
    setScanRunningUI(true);
    const isForced = document.getElementById('ct-force-scan-cb')?.checked || document.getElementById('ct-force-setting-cb')?.checked || false;
    try {
      await fetch(`${global.API_BASE_URL}/api/v1/comictagger/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: isForced })
      });
    } catch (err) {
      setScanRunningUI(false);
    }
  });
  document.getElementById('ct-cancel-btn')?.addEventListener('click', cancelCtScan);
  document.getElementById('ct-clear-output')?.addEventListener('click', () => {
    if (ctOutputDiv) ctOutputDiv.innerHTML = '';
  });
}

// Periodic check for pending matches on CT button
async function updateCtButtonIndicator() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/pending`);
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
        ctButton.title = 'Comics Tagger';
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
  performManualSearch,
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
state.performManualSearch = performManualSearch;
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
  window.performManualSearch = performManualSearch;
  window.loadScanLogs = loadScanLogs;
  window.clearTrackingHistory = clearTrackingHistory;
  window.showCtConfirm = showCtConfirm;
  window.handleCtConfirmYes = handleCtConfirmYes;
  window.handleCtConfirmNo = handleCtConfirmNo;
  window.updateCtButtonIndicator = updateCtButtonIndicator;
}
