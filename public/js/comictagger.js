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

// --- COMICTAGGER ---
async function checkPendingMatch() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/pending`);

    // If forbidden (not admin), silently ignore
    if (res.status === 403) {
      return;
    }

    const pending = await res.json();

    if (pending && pending.waitingForResponse) {
      // Show indicator that there's a pending match
      const indicator = document.createElement('div');
      indicator.id = 'ct-pending-indicator';
      indicator.className = 'bg-yellow-600 text-white px-4 py-2 rounded-lg mb-3 text-sm font-semibold';
      indicator.innerHTML = `⚠️ Waiting for response on: <strong>${escapeHtml(pending.fileName)}</strong> (since ${escapeHtml(new Date(pending.timestamp).toLocaleTimeString())})`;

      // Insert at top of matches tab
      const matchesContent = document.getElementById('ct-content-matches');
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) {
        existingIndicator.remove();
      }
      if (matchesContent) {
        matchesContent.insertBefore(indicator, matchesContent.firstChild);
      }

      // Show notification badge on Matches tab if not already active
      if (ctMatchesBadge && !ctTabMatches.classList.contains('active')) {
        ctMatchesBadge.classList.remove('hidden');
      }

      // Enable apply/skip buttons
      if (ctApplyBtn) ctApplyBtn.disabled = false;
      if (ctSkipBtn) ctSkipBtn.disabled = false;
    } else {
      // Remove indicator if no pending match
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) {
        existingIndicator.remove();
      }
      // Hide badge
      if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
    }
  } catch (error) {
    
  }
}

// Helper function to colorize and format log messages
function formatCtLogMessage(timestamp, message) {
  const line = document.createElement('div');
  line.className = 'ct-log-line py-0.5 font-mono text-sm';

  // Check if this is a separator line
  if (/^[━─]+$/.test(message)) {
    line.className = 'ct-log-separator border-b border-gray-700 my-1';
    return line;
  }

  // Parse message type and apply colors
  let colorClass = 'text-gray-300'; // default
  let icon = '';
  let bold = false;

  // Success patterns (green)
  if (/tag\s+written|archive\s+already\s+tagged|success|✓|SUCCESS/i.test(message)) {
    colorClass = 'text-green-400';
    if (!message.includes('✓')) icon = '✓ ';
    bold = true;
  }
  // Error/failure patterns (red)
  else if (/error|failed|no\s+match|could\s+not|KEEP:|✗/i.test(message)) {
    colorClass = 'text-red-400';
    if (!message.includes('✗')) icon = '✗ ';
  }
  // Warning patterns (yellow/amber)
  else if (/warning|caution|pending|>>>.*WAITING/i.test(message)) {
    colorClass = 'text-yellow-400';
    if (!message.includes('⚠')) icon = '⚠ ';
    bold = true;
  }
  // Skip patterns (orange)
  else if (/skip|⊘/i.test(message)) {
    colorClass = 'text-orange-400';
    if (!message.includes('⊘')) icon = '⊘ ';
  }
  // User input prompts (cyan)
  else if (/choose|select|enter/i.test(message)) {
    colorClass = 'text-cyan-400';
    if (!message.includes('❯')) icon = '❯ ';
  }
  // Processing/info (blue)
  else if (/processing:|starting|completed|found.*file|ⓘ/i.test(message)) {
    colorClass = 'text-blue-400';
    if (!message.includes('ⓘ')) icon = 'ⓘ ';
  }
  // File operations (purple)
  else if (/moved?|rename|→|➜/i.test(message)) {
    colorClass = 'text-purple-400';
    if (!message.includes('➜') && !message.includes('→')) icon = '➜ ';
  }

  // Format timestamp (smaller and dimmer)
  const timeSpan = document.createElement('span');
  timeSpan.className = 'text-gray-600 mr-2';
  timeSpan.textContent = `[${timestamp}]`;

  // Format message
  const msgSpan = document.createElement('span');
  msgSpan.className = colorClass + (bold ? ' font-semibold' : '');

  // Don't duplicate icons if message already has one
  const hasIcon = /^[✓✗⚠⊘❯ⓘ➜→]/.test(message);
  msgSpan.textContent = (hasIcon ? '' : icon) + message;

  line.appendChild(timeSpan);
  line.appendChild(msgSpan);

  return line;
}

async function loadCtSavedLogs() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/logs`);
    const logs = await res.json();
    if (Array.isArray(logs) && logs.length > 0) {
      ctOutputDiv.innerHTML = ''; // Clear previous content
      logs.forEach(entry => {
        const logLine = formatCtLogMessage(entry.timestamp, entry.message);
        ctOutputDiv.appendChild(logLine);
      });
      ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
    }
  } catch (error) {
    // If loading saved logs fails, just continue without them
  }
}

let isCtModalInitializing = false;

function openCTModal() {
  // Guard against recursive calls from the router/tabs
  if (isCtModalInitializing) return;
  if (!ctModal.classList.contains('hidden')) {
    // Modal is already open, just ensure settings/logs are fresh if needed
    // but don't re-initialize the whole thing (breaks EventSource)
    return;
  }
  
  isCtModalInitializing = true;

  if (!global._isNavigatingFromRouter && global.router) {
    if (!getRelativePath().startsWith('/comictagger')) {
      global.router.navigate('/comictagger', true);
    }
  }
  ctModal.classList.remove('hidden');

  // Clean up existing resources if they exist
  if (global.ctEventSource) {
    global.ctEventSource.close();
    global.ctEventSource = null;
  }

  fetchCtSettings();
  clearCtMatches();
  ctOutputDiv.innerHTML = ''; // Use innerHTML instead of textContent for formatted output

  // Load saved logs first
  loadCtSavedLogs();

  // Check for pending matches
  checkPendingMatch().then(() => {
    // If a match is pending, switch to the Matches tab automatically
    // BUT only if we aren't already there
    const indicator = document.getElementById('ct-pending-indicator');
    if (indicator && ctTabMatches && !ctTabMatches.classList.contains('active')) {
      ctTabMatches.click();
    }
    isCtModalInitializing = false;
  }).catch(() => {
    isCtModalInitializing = false;
  });

  global.ctEventSource = new EventSource(`${global.API_BASE_URL}/api/v1/comictagger/stream`);
  
  global.ctEventSource.onopen = () => {
    console.log('[CT] SSE stream connected successfully');
  };

  global.ctEventSource.onerror = (err) => {
    console.error('[CT] SSE stream error:', err);
    // Browser will auto-reconnect, but we should log it
  };

  global.ctEventSource.onmessage = (e) => {
    try {
      if (e.data === ':ok' || e.data === ': keepalive') return;
      
      const data = JSON.parse(e.data);
      const msg = data.message;

      // Append formatted log line
      const logLine = formatCtLogMessage(data.timestamp, msg);
      ctOutputDiv.appendChild(logLine);
      ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;

      if (/low-confidence match/i.test(msg) || /matches found/i.test(msg) || /Multiple.*matches/i.test(msg) || /Archives with/i.test(msg)) {
        global.ctAwaitingMatches = true;
        tempMatches = []; 
      } else if (global.ctAwaitingMatches) {
        if (/Choose a match/i.test(msg) || /Enter selection/i.test(msg)) {
          console.log('[CT] Match prompt detected in stream');
          global.ctAwaitingMatches = false;
          checkPendingMatch();
          
          if (ctTabMatches && ctTabMatches.classList.contains('active')) {
            debouncedFetchPendingMatchDetails();
          }
        } else {
          const parsed = parseCtSuggestion(msg);
          if (parsed) {
            tempMatches.push(parsed);
          }
        }
      }
    } catch (err) {
      // Ignore parse errors for heartbeats
    }
  };
}

async function fetchSingleMatchCover(matchChoice, btn) {
  if (!matchChoice || !btn) return;
  
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="animate-spin h-6 w-6 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  `;

  try {
    const matchObj = {
      choice: matchChoice,
      title: btn.dataset.title,
      year: btn.dataset.year,
      issue: btn.dataset.issue,
      publisher: btn.dataset.publisher
    };

    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/match-covers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches: [matchObj] })
    });

    if (!res.ok) throw new Error('Failed to fetch cover');
    
    const data = await res.json();
    const coverUrl = data.matches && data.matches[0] ? data.matches[0].coverUrl : null;

    const container = btn.closest('.ct-cover-container');
    if (coverUrl) {
      container.innerHTML = `
        <img src="${escapeHtml(coverUrl)}"
             alt="Cover"
             class="w-full h-auto rounded border border-purple-500/30 shadow-lg group-hover:border-purple-500 transition-colors"
             loading="lazy">
      `;
    } else {
      container.innerHTML = `
        <div class="w-full h-32 rounded border border-gray-700 bg-gray-900 flex items-center justify-center text-[10px] text-gray-600 uppercase tracking-tighter text-center px-1">No Cover Found</div>
      `;
    }
  } catch (error) {
    console.error('[CT] Error fetching single cover:', error);
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    
    // Add a small error indicator
    if (!btn.querySelector('.ct-retry-text')) {
      const errSpan = document.createElement('span');
      errSpan.className = 'ct-retry-text text-[8px] text-red-500 absolute bottom-1';
      errSpan.textContent = 'Retry';
      btn.appendChild(errSpan);
    }
  }
}

function clearCtMatches() {
  console.log('[CT] Clearing matches UI');
  ctMatchBody.innerHTML = '';
  const previewContainer = document.getElementById('ct-preview-container');
  if (previewContainer) {
    previewContainer.innerHTML = '';
    previewContainer.classList.add('hidden');
  }
  
  const noMatchesDiv = document.getElementById('ct-no-matches');
  const matchTable = document.getElementById('ct-match-table');
  if (noMatchesDiv) {
    noMatchesDiv.innerHTML = 'No matches to select. Matches will appear here when ComicTagger finds multiple options.';
    noMatchesDiv.classList.remove('hidden');
  }
  if (matchTable) matchTable.classList.add('hidden');
  if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
  lastRenderedMatchesHash = null; // Reset hash so fetchPendingMatchDetails will re-render
  lastRenderedFileName = null;
}

function closeCTModal() {
  ctModal.classList.add('hidden');
  ctConfirmBar.classList.add('hidden');
  if (global.ctEventSource) {
    global.ctEventSource.close();
    global.ctEventSource = null;
  }
  // Reset hash so fresh matches render on next modal open
  lastRenderedMatchesHash = null;

  if (global.router && getRelativePath().startsWith('/comictagger')) {
    const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
    global.router.navigate(path, true);
  }

  // Stop management streams if they were running
  if (typeof global.stopRenameStream === 'function') global.stopRenameStream();
  if (typeof global.stopMoveStream === 'function') global.stopMoveStream();
}

async function fetchCtSettings() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/schedule`);
    const data = await res.json();
    ctScheduleInput.value = data.minutes || 0;
    const scanDirInput = document.getElementById('ct-scan-dir-input');
    if (scanDirInput) {
      scanDirInput.value = data.comicsLocation || '';
    }
  } catch {}
}

function parseCtSuggestion(line) {
  try {
    // Remove ALL leading symbols, including dots, arrows, checkmarks, etc.
    const cleaned = line.replace(/^[^\w\d]*(\d+\.)/, '$1').trim();
    
    // Pattern: 1. Title (YEAR) #issue [Publisher] (date) - Subtitle
    const match = cleaned.match(/^(\d+)\.\s+(.+?)(?:\s+\((\d{4})\))?(?:\s+(?:#)?(\d+[\w\d]*)?)?(?:\s+\[([^\]]+)\])?(?:\s+(.+))?$/);
    
    if (match) {
      return {
        choice: match[1],
        title: match[2].trim(),
        year: match[3] || '',
        issue: match[4] || '?',
        publisher: match[5] ? match[5].trim() : 'Unknown',
        extra: match[6] ? match[6].trim() : ''
      };
    }

    // Ultra-fallback
    const fallback = cleaned.match(/^(\d+)\.\s+(.+)$/);
    if (fallback) {
      return {
        choice: fallback[1],
        title: fallback[2].trim(),
        year: '',
        issue: '?',
        publisher: 'Unknown',
        extra: ''
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Store temporarily collected matches
let tempMatches = [];
let lastRenderedMatchesHash = null;
let lastRenderedFileName = null;
let isFetchingCtDetails = false;
let ctFetchDebounceTimer = null;

function debouncedFetchPendingMatchDetails() {
  if (ctFetchDebounceTimer) clearTimeout(ctFetchDebounceTimer);
  ctFetchDebounceTimer = setTimeout(() => {
    fetchPendingMatchDetails();
  }, 500);
}

async function fetchPendingMatchDetails(isManual = false) {
  if (isFetchingCtDetails && !isManual) return;
  isFetchingCtDetails = true;

  try {
    // Get pending match details
    const detailsRes = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/pending-details?_t=${Date.now()}`);
    if (!detailsRes.ok) {
      throw new Error(`Failed to fetch pending details: ${detailsRes.status}`);
    }
    const details = await detailsRes.json();

    if (!details.waitingForResponse) {
      console.log('[CT] No process waiting for response');
      return;
    }

    const matchesToRender = details.matches || [];

    // If no matches yet, just show the preview
    if (matchesToRender.length === 0) {
      console.log('[CT] Backend returned 0 matches for:', details.fileName);
      if (details.fileName && details.fileName !== lastRenderedFileName) {
        clearCtMatches();
        const previewUrl = `${global.API_BASE_URL}/api/v1/comictagger/preview?_t=${Date.now()}`;
        renderComicPreview(previewUrl, details.fileName);
        lastRenderedFileName = details.fileName;
      }
      isFetchingCtDetails = false;
      return;
    }

    // POLICY: Render if isFinal OR if user clicked manually OR if we are on the output tab (watching progress)
    const shouldRender = details.isFinal || isManual || (matchesToRender.length > 0 && matchesToRender.length !== (JSON.parse(lastRenderedMatchesHash || '{}').count || 0));

    if (!shouldRender) {
      console.log('[CT] Matches available but not final yet, skipping auto-render to prevent flicker');
      isFetchingCtDetails = false;
      return;
    }

    // Create hash of current matches to detect changes
    const currentHash = JSON.stringify({
      file: details.fileName,
      count: matchesToRender.length,
      matches: matchesToRender.map(m => `${m.choice}|${m.title}|${m.issue || m.number}`)
    });

    // LATCH: If we are already displaying matches for this EXACT state, EXIT IMMEDIATELY.
    if (currentHash === lastRenderedMatchesHash && ctMatchBody.children.length > 0) {
      console.log('[CT] Matches already rendered and unchanged');
      isFetchingCtDetails = false;
      return;
    }

    // NEW SAFETY: If we already have matches showing for THIS file, never clear or re-render
    // unless the content (the hash) has actually changed.
    if (details.fileName === lastRenderedFileName && ctMatchBody.children.length > 0 && !isManual && currentHash === lastRenderedMatchesHash) {
       isFetchingCtDetails = false;
       return;
    }

    console.log('[CT] Rendering matches for:', details.fileName, `(Count: ${matchesToRender.length}, Final: ${details.isFinal})`);

    // ATOMIC RENDERING: Only clear and re-render preview if filename changed. 
    if (details.fileName !== lastRenderedFileName) {
      clearCtMatches();
      const previewUrl = `${global.API_BASE_URL}/api/v1/comictagger/preview?_t=${Date.now()}`;
      renderComicPreview(previewUrl, details.fileName);
      lastRenderedFileName = details.fileName;
    }

    // Build Match List in memory
    let matchHtml = '';
    matchesToRender.forEach(match => {
      matchHtml += getCtMatchHtml(match);
    });

    // Update DOM once
    const noMatchesDiv = document.getElementById('ct-no-matches');
    const matchTable = document.getElementById('ct-match-table');
    if (noMatchesDiv) noMatchesDiv.classList.add('hidden');
    if (matchTable) matchTable.classList.remove('hidden');
    
    ctMatchBody.innerHTML = matchHtml;
    lastRenderedMatchesHash = currentHash;
    tempMatches = []; 

  } catch (error) {
    console.error('[CT] Fatal error fetching match details:', error);
  } finally {
    isFetchingCtDetails = false;
  }
}

function getCtMatchHtml(match) {
  return `
      <tr class="border-b border-gray-700 hover:bg-gray-800 transition-colors duration-150 cursor-pointer" 
          onclick="if (!event.target.closest('button') && !event.target.closest('a')) { const radio = this.querySelector('input[type=\'radio\']'); if (radio) radio.checked = true; }">
      <td class="px-4 py-4 align-top w-12">
        <div class="flex items-center justify-center h-full pt-1">
          <input type="radio"
                 name="ct-match-choice"
                 class="ct-match-select w-6 h-6 cursor-pointer accent-purple-500"
                 data-choice="${escapeHtml(match.choice)}"
                 id="match-${escapeHtml(match.choice)}">
        </div>
      </td>
      <td class="py-4 pr-4">
        <div class="flex space-x-4 group">
          <div class="flex-shrink-0 w-24 ct-cover-container" id="ct-cover-container-${escapeHtml(match.choice)}">
            ${match.coverUrl
              ? `<img src="${escapeHtml(match.coverUrl)}"
                     alt="Cover"
                     class="w-full h-auto rounded border border-purple-500/30 shadow-lg group-hover:border-purple-500 transition-colors"
                     loading="lazy">`
              : `<button type="button" 
                         onclick="window.fetchSingleMatchCover('${escapeHtml(match.choice)}', this); event.stopPropagation();"
                         data-title="${escapeHtml(match.title)}"
                         data-year="${escapeHtml(match.year)}"
                         data-issue="${escapeHtml(match.issue || match.number)}"
                         data-publisher="${escapeHtml(match.publisher)}"
                         class="w-full h-32 rounded border border-purple-500/30 bg-purple-900/20 hover:bg-purple-900/40 flex flex-col items-center justify-center transition-all group/btn relative">
                  <svg class="w-8 h-8 text-purple-400 mb-2 group-hover/btn:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                  </svg>
                  <span class="text-[10px] text-purple-300 font-bold uppercase tracking-tight">Load Cover</span>
                </button>`
            }
          </div>
          <label for="match-${escapeHtml(match.choice)}" class="flex-1 min-w-0 cursor-pointer">
            <div class="font-bold text-white text-lg truncate mb-1 group-hover:text-purple-300 transition-colors">
              ${escapeHtml(match.choice)}. ${escapeHtml(match.title)} ${match.year ? `(${escapeHtml(match.year)})` : ''}
            </div>
            <div class="text-sm text-gray-300 space-y-0.5">
              <div class="flex items-center"><span class="text-gray-500 w-20 flex-shrink-0">Issue:</span> <span class="font-medium">#${escapeHtml(match.issue || match.number || '?')}</span></div>
              <div class="flex items-center"><span class="text-gray-500 w-20 flex-shrink-0">Publisher:</span> <span class="font-medium">${escapeHtml(match.publisher)}</span></div>
              ${match.extra ? `<div class="italic text-gray-400 mt-1 border-l-2 border-gray-700 pl-2">"${escapeHtml(match.extra)}"</div>` : ''}
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
    <div class="bg-gray-800/50 rounded-xl p-4 mb-6 border border-gray-700 flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-6">
      <div class="flex-shrink-0">
        ${url 
          ? `<img src="${escapeHtml(url)}" class="w-48 h-auto rounded-lg shadow-2xl border-2 border-gray-600 object-cover" alt="Comic Preview">`
          : `<div class="w-48 h-72 rounded-lg bg-gray-900 flex items-center justify-center border-2 border-dashed border-gray-700 text-gray-500 italic text-sm text-center px-4">Preview unavailable for this file</div>`
        }
      </div>
      <div class="flex-1 min-w-0 text-center md:text-left">
        <h3 class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Currently Processing</h3>
        <div class="text-xl font-bold text-white break-all mb-4">${escapeHtml(fileName)}</div>
        
        <div class="inline-flex items-center px-3 py-1 rounded-full bg-blue-900/30 text-blue-400 text-xs font-medium border border-blue-800/50">
          <svg class="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          Select the correct match from the options below
        </div>
      </div>
    </div>
  `;
  previewContainer.classList.remove('hidden');
}

async function saveCtSettings() {
  const schedule = parseInt(ctScheduleInput.value, 10) || 0;
  const scanDirInput = document.getElementById('ct-scan-dir-input');
  const comicsLocation = scanDirInput ? scanDirInput.value.trim() : null;

  await fetch(`${global.API_BASE_URL}/api/v1/comictagger/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      minutes: schedule,
      comicsLocation
    })
  });
}

function showCtConfirm(action) {
  ctConfirmBar.classList.remove('hidden');
  ctConfirmBar.dataset.action = action;
  ctConfirmMessage.textContent = action === 'apply' ? 'Apply this match?' : 'Skip this match?';
  ctConfirmYes.focus();
}

async function handleCtConfirmYes() {
  const action = ctConfirmBar.dataset.action;

  if (action === 'apply') {
    // Get selected radio button
    const selected = document.querySelector('.ct-match-select:checked');
    const choice = selected ? selected.dataset.choice : null;

    if (!choice) {
      alert('Please select a match to apply');
      return;
    }

    await fetch(`${global.API_BASE_URL}/api/v1/comictagger/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections: [choice] })
    });
  } else {
    // Skip action
    await fetch(`${global.API_BASE_URL}/api/v1/comictagger/skip`, {
      method: 'POST'
    });
  }

  ctConfirmBar.classList.add('hidden');

  // Clear matches after action - will be populated again for next file
  clearCtMatches();

  // Re-check pending status
  setTimeout(() => checkPendingMatch(), 500);
}

function handleCtConfirmNo() {
  ctConfirmBar.classList.add('hidden');
}

let isUpdatingCtIndicator = false;

// Periodically check for pending matches and update CT button indicator
async function updateCtButtonIndicator() {
  if (isUpdatingCtIndicator) return;
  isUpdatingCtIndicator = true;
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/comictagger/pending`);

    // If forbidden (not admin), silently ignore
    if (res.status === 403) {
      return;
    }

    const pending = await res.json();

    if (pending && pending.waitingForResponse) {
      // Add pulsing indicator to CT button
      if (ctButton && !ctButton.classList.contains('ct-pending')) {
        ctButton.classList.add('ct-pending');
        ctButton.style.animation = 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite';
        ctButton.style.boxShadow = '0 0 0 3px rgba(251, 191, 36, 0.5)';
        ctButton.title = `Pending match: ${pending.fileName}`;
      }
    } else {
      // Remove indicator
      if (ctButton && ctButton.classList.contains('ct-pending')) {
        ctButton.classList.remove('ct-pending');
        ctButton.style.animation = '';
        ctButton.style.boxShadow = '';
        ctButton.title = 'ComicTagger';
      }
    }
  } catch (error) {
    
  } finally {
    isUpdatingCtIndicator = false;
  }
}

// Check for pending matches every 10 seconds
if (typeof window !== 'undefined') {
  setInterval(updateCtButtonIndicator, 10000);
  // Initial check on page load
  setTimeout(updateCtButtonIndicator, 2000);
}

// Hook Fetch to Tab Click
if (typeof ctTabMatches !== 'undefined' && ctTabMatches) {
  ctTabMatches.addEventListener('click', () => {
    // Small delay to let the tab UI switch happen first
    setTimeout(() => {
      fetchPendingMatchDetails();
    }, 50);
  });
}

export {
  checkPendingMatch,
  formatCtLogMessage,
  loadCtSavedLogs,
  openCTModal,
  fetchSingleMatchCover,
  clearCtMatches,
  closeCTModal,
  fetchCtSettings,
  parseCtSuggestion,
  debouncedFetchPendingMatchDetails,
  fetchPendingMatchDetails,
  getCtMatchHtml,
  renderComicPreview,
  saveCtSettings,
  showCtConfirm,
  handleCtConfirmYes,
  handleCtConfirmNo,
  updateCtButtonIndicator
};

state.checkPendingMatch = checkPendingMatch;
state.formatCtLogMessage = formatCtLogMessage;
state.loadCtSavedLogs = loadCtSavedLogs;
state.openCTModal = openCTModal;
state.fetchSingleMatchCover = fetchSingleMatchCover;
state.clearCtMatches = clearCtMatches;
state.closeCTModal = closeCTModal;
state.fetchCtSettings = fetchCtSettings;
state.parseCtSuggestion = parseCtSuggestion;
state.debouncedFetchPendingMatchDetails = debouncedFetchPendingMatchDetails;
state.fetchPendingMatchDetails = fetchPendingMatchDetails;
state.getCtMatchHtml = getCtMatchHtml;
state.renderComicPreview = renderComicPreview;
state.saveCtSettings = saveCtSettings;
state.showCtConfirm = showCtConfirm;
state.handleCtConfirmYes = handleCtConfirmYes;
state.handleCtConfirmNo = handleCtConfirmNo;
state.updateCtButtonIndicator = updateCtButtonIndicator;

if (typeof window !== 'undefined') {
  window.checkPendingMatch = checkPendingMatch;
  window.formatCtLogMessage = formatCtLogMessage;
  window.loadCtSavedLogs = loadCtSavedLogs;
  window.openCTModal = openCTModal;
  window.fetchSingleMatchCover = fetchSingleMatchCover;
  window.clearCtMatches = clearCtMatches;
  window.closeCTModal = closeCTModal;
  window.fetchCtSettings = fetchCtSettings;
  window.parseCtSuggestion = parseCtSuggestion;
  window.debouncedFetchPendingMatchDetails = debouncedFetchPendingMatchDetails;
  window.fetchPendingMatchDetails = fetchPendingMatchDetails;
  window.getCtMatchHtml = getCtMatchHtml;
  window.renderComicPreview = renderComicPreview;
  window.saveCtSettings = saveCtSettings;
  window.showCtConfirm = showCtConfirm;
  window.handleCtConfirmYes = handleCtConfirmYes;
  window.handleCtConfirmNo = handleCtConfirmNo;
  window.updateCtButtonIndicator = updateCtButtonIndicator;
}
