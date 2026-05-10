// --- COMICTAGGER ---
async function checkPendingMatch() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/comictagger/pending`);

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
    const res = await fetch(`${API_BASE_URL}/api/v1/comictagger/logs`);
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

function openCTModal() {
  if (!window._isNavigatingFromRouter && window.router) {
    if (!getRelativePath().startsWith('/comictagger')) {
      window.router.navigate('/comictagger', true);
    }
  }
  ctModal.classList.remove('hidden');
  fetchCtSettings();
  clearCtMatches();
  ctOutputDiv.innerHTML = ''; // Use innerHTML instead of textContent for formatted output

  // Load saved logs first
  loadCtSavedLogs();

  // Check for pending matches
  checkPendingMatch().then(() => {
    // If a match is pending, switch to the Matches tab automatically
    const indicator = document.getElementById('ct-pending-indicator');
    if (indicator && ctTabMatches) {
      ctTabMatches.click();
    }
  });

  // Fetch and display pending match details if available
  // This ensures matches appear even if user opens modal hours after detection
  fetchPendingMatchDetails();

  ctEventSource = new EventSource(`${API_BASE_URL}/api/v1/comictagger/stream`);
  ctEventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      const msg = data.message;

      // Append formatted log line
      const logLine = formatCtLogMessage(data.timestamp, msg);
      ctOutputDiv.appendChild(logLine);
      ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;

      if (/Single low-confidence match:/i.test(msg) || /Multiple matches found/i.test(msg)) {
        ctAwaitingMatches = true;
        clearCtMatches();
        tempMatches = []; // Reset temp matches
      } else if (ctAwaitingMatches) {
        if (/^Choose a match/i.test(msg) || /^\s*Enter selection/i.test(msg)) {
          ctAwaitingMatches = false;
          // Fetch and render matches with images
          fetchPendingMatchDetails();
        } else {
          const parsed = parseCtSuggestion(msg);
          if (parsed) {
            tempMatches.push(parsed);
          }
        }
      } else if (/^Choose a match/i.test(msg)) {
        // If we see "Choose a match" prompt when not awaiting, it's a new file
        // This happens after user skipped/applied the previous file
        ctAwaitingMatches = false;
        clearCtMatches();
        tempMatches = [];
      }
    } catch {}
  };

  // Auto-refresh pending matches every 2 seconds while modal is open
  // This ensures matches appear immediately even if modal was opened before detection
  ctPollInterval = setInterval(async () => {
    if (ctModal.classList.contains('hidden')) {
      clearInterval(ctPollInterval);
      ctPollInterval = null;
      return;
    }
    await fetchPendingMatchDetails();
  }, 2000);
}

function clearCtMatches() {
  ctMatchBody.innerHTML = '';
  const noMatchesDiv = document.getElementById('ct-no-matches');
  const matchTable = document.getElementById('ct-match-table');
  if (noMatchesDiv) noMatchesDiv.classList.remove('hidden');
  if (matchTable) matchTable.classList.add('hidden');
  if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
}

function closeCTModal() {
  ctModal.classList.add('hidden');
  ctConfirmBar.classList.add('hidden');
  if (ctEventSource) {
    ctEventSource.close();
    ctEventSource = null;
  }
  if (ctPollInterval) {
    clearInterval(ctPollInterval);
    ctPollInterval = null;
  }
  // Reset hash so fresh matches render on next modal open
  lastRenderedMatchesHash = null;

  if (window.router && getRelativePath().startsWith('/comictagger')) {
    const path = window.getPathForCurrentView ? window.getPathForCurrentView() : '/';
    window.router.navigate(path, true);
  }

  // Stop management streams if they were running
  if (typeof window.stopRenameStream === 'function') window.stopRenameStream();
  if (typeof window.stopMoveStream === 'function') window.stopMoveStream();
}

async function fetchCtSettings() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/comictagger/schedule`);
    const data = await res.json();
    ctScheduleInput.value = data.minutes || 0;
    const scanDirInput = document.getElementById('ct-scan-dir-input');
    if (scanDirInput) {
      scanDirInput.value = data.comicsLocation || '';
    }
  } catch {}
}

function parseCtSuggestion(line) {
  // Format: "1. Jimmy's Bastards (2017) #1 [Aftershock Comics] (6/2017) - Get Daddy"
  // Pattern: number. title #issue [publisher] (date) - subtitle
  const regex = /^\s*(\d+)\.\s+(.+?)\s+#(\d+)\s+\[([^\]]+)\]\s+\(([^)]+)\)\s*-?\s*(.*)$/;
  const m = line.match(regex);
  if (!m) return null;

  // Extract year from title if it contains (YYYY)
  const titleWithYear = m[2];
  const yearMatch = titleWithYear.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';
  const title = titleWithYear.replace(/\s*\(\d{4}\)\s*/, '').trim();

  return {
    choice: m[1],
    title: title,
    year: year,
    number: m[3],
    publisher: m[4],
    confidence: m[6] || ''
  };
}

// Store temporarily collected matches
let tempMatches = [];
let lastRenderedMatchesHash = null;

/**
 * Fetch pending match details including images and render UI
 */
async function fetchPendingMatchDetails() {
  try {

    // Get pending match details including first page URL
    // Add cache-busting query parameter to prevent Cloudflare caching
    const detailsRes = await fetch(`${API_BASE_URL}/api/v1/comictagger/pending-details?_t=${Date.now()}`);
    if (!detailsRes.ok) {
      throw new Error(`Failed to fetch pending details: ${detailsRes.status}`);
    }
    const details = await detailsRes.json();

    if (!details.waitingForResponse) {
      return;
    }

    const firstPageUrl = details.firstPageUrl;

    // Use matches from backend if available, otherwise use temp collected matches
    const matchesToEnrich = details.matches && details.matches.length > 0
      ? details.matches
      : tempMatches;


    if (matchesToEnrich.length === 0) {
      return;
    }

    // Create hash of current matches to detect changes
    const currentHash = JSON.stringify(matchesToEnrich.map(m => `${m.choice}|${m.title}|${m.issue}`));

    // If matches haven't changed, don't re-render (preserves radio selection)
    if (currentHash === lastRenderedMatchesHash) {
      return;
    }

    // Show notification badge if not on the matches tab
    if (ctMatchesBadge && !ctTabMatches.classList.contains('active')) {
      ctMatchesBadge.classList.remove('hidden');
    }

    try {
      // Enrich matches with ComicVine cover images
      // Add cache-busting query parameter to prevent Cloudflare caching
      const coversRes = await fetch(`${API_BASE_URL}/api/v1/comictagger/match-covers?_t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches: matchesToEnrich })
      });

      if (!coversRes.ok) {
        throw new Error(`Cover fetch failed: ${coversRes.status}`);
      }

      const { matches: enrichedMatches } = await coversRes.json();

      if (!Array.isArray(enrichedMatches) || enrichedMatches.length === 0) {
        throw new Error('No enriched matches returned');
      }

      // Clear and render each match with images
      clearCtMatches();
      enrichedMatches.forEach(match => {
        renderCtMatch(match, firstPageUrl);
      });

      // Update hash after successful render
      lastRenderedMatchesHash = currentHash;

    } catch (coverError) {
      // Fallback: render matches without cover images if enrichment fails
      clearCtMatches();
      matchesToEnrich.forEach(match => {
        renderCtMatch({ ...match, coverUrl: null }, firstPageUrl);
      });

      // Update hash after fallback render
      lastRenderedMatchesHash = currentHash;

    }

    // Clear temp matches
    tempMatches = [];

  } catch (error) {
    console.error('[CT] Fatal error fetching match details:', error);

    // Last resort fallback: try to render tempMatches if we have them
    if (tempMatches.length > 0) {
      clearCtMatches();
      tempMatches.forEach(match => renderCtMatch(match, null));
      tempMatches = [];
    } else {
      console.error('[CT] No matches available to render!');
    }
  }
}

function renderCtMatch(match, comicFirstPageUrl) {
  // Show the table and hide the "no matches" message
  const noMatchesDiv = document.getElementById('ct-no-matches');
  const matchTable = document.getElementById('ct-match-table');
  if (noMatchesDiv) noMatchesDiv.classList.add('hidden');
  if (matchTable) matchTable.classList.remove('hidden');

  // Build image comparison section
  const imageComparisonHtml = `
    <div class="flex items-center space-x-4 mb-3">
      <div class="flex-1 text-center">
        <div class="text-xs text-gray-400 mb-1">Your Comic</div>
        ${comicFirstPageUrl
          ? `<img src="${escapeHtml(comicFirstPageUrl)}"
                 alt="Comic page"
                 class="w-full max-w-[150px] h-auto mx-auto rounded border-2 border-gray-600 object-cover"
                 loading="lazy">`
          : `<div class="w-full max-w-[150px] h-48 mx-auto rounded border-2 border-gray-600 bg-gray-800 flex items-center justify-center text-xs text-gray-500">No preview</div>`
        }
      </div>
      <div class="text-2xl text-gray-500">⟷</div>
      <div class="flex-1 text-center">
        <div class="text-xs text-gray-400 mb-1">ComicVine Match</div>
        ${match.coverUrl
          ? `<img src="${escapeHtml(match.coverUrl)}"
                 alt="ComicVine cover"
                 class="w-full max-w-[150px] h-auto mx-auto rounded border-2 border-purple-500 object-cover"
                 loading="lazy">`
          : `<div class="w-full max-w-[150px] h-48 mx-auto rounded border-2 border-gray-600 bg-gray-800 flex items-center justify-center text-xs text-gray-500">No cover</div>`
        }
      </div>
    </div>
  `;

  const tr = document.createElement('tr');
  tr.className = 'border-b border-gray-700 hover:bg-gray-800';
  tr.innerHTML = `
      <td class="pr-3 py-2 align-top">
        <input type="radio"
               name="ct-match-choice"
               class="ct-match-select w-5 h-5 cursor-pointer"
               data-choice="${escapeHtml(match.choice)}"
               id="match-${escapeHtml(match.choice)}">
      </td>
      <td class="py-2">
        <label for="match-${escapeHtml(match.choice)}" class="cursor-pointer block">
          <div class="font-semibold text-white text-lg mb-2">
            ${escapeHtml(match.choice)}. ${escapeHtml(match.title)} ${match.year ? `(${escapeHtml(match.year)})` : ''}
          </div>
          ${imageComparisonHtml}
          <div class="text-sm text-gray-300 space-y-1">
            <div><span class="text-gray-400">Issue:</span> #${escapeHtml(match.issue || match.number)}</div>
            <div><span class="text-gray-400">Publisher:</span> ${escapeHtml(match.publisher)}</div>
            ${match.subtitle ? `<div><span class="text-gray-400">Subtitle:</span> ${escapeHtml(match.subtitle)}</div>` : ''}
          </div>
        </label>
      </td>`;
  ctMatchBody.appendChild(tr);
}

async function saveCtSettings() {
  const schedule = parseInt(ctScheduleInput.value, 10) || 0;
  const scanDirInput = document.getElementById('ct-scan-dir-input');
  const comicsLocation = scanDirInput ? scanDirInput.value.trim() : null;

  await fetch(`${API_BASE_URL}/api/v1/comictagger/schedule`, {
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

    await fetch(`${API_BASE_URL}/api/v1/comictagger/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections: [choice] })
    });
  } else {
    // Skip action
    await fetch(`${API_BASE_URL}/api/v1/comictagger/skip`, {
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

// Periodically check for pending matches and update CT button indicator
async function updateCtButtonIndicator() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/comictagger/pending`);

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
    
  }
}

// Check for pending matches every 10 seconds
if (typeof window !== 'undefined') {
  setInterval(updateCtButtonIndicator, 10000);
  // Initial check on page load
  setTimeout(updateCtButtonIndicator, 2000);
}
