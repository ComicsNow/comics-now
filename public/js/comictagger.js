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
      indicator.innerHTML = `⚠️ Waiting for response on: <strong>${pending.fileName}</strong> (since ${new Date(pending.timestamp).toLocaleTimeString()})`;

      // Insert at top of settings tab
      const settingsContent = document.getElementById('ct-content-settings');
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) {
        existingIndicator.remove();
      }
      settingsContent.insertBefore(indicator, settingsContent.firstChild);

      // Enable apply/skip buttons
      if (ctApplyBtn) ctApplyBtn.disabled = false;
      if (ctSkipBtn) ctSkipBtn.disabled = false;
    } else {
      // Remove indicator if no pending match
      const existingIndicator = document.getElementById('ct-pending-indicator');
      if (existingIndicator) {
        existingIndicator.remove();
      }
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
  ctModal.classList.remove('hidden');
  fetchCtSettings();
  clearCtMatches();
  ctOutputDiv.innerHTML = ''; // Use innerHTML instead of textContent for formatted output

  // Load saved logs first
  loadCtSavedLogs();

  // Check for pending matches
  checkPendingMatch();

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
}

function clearCtMatches() {
  ctMatchBody.innerHTML = '';
  const noMatchesDiv = document.getElementById('ct-no-matches');
  const matchTable = document.getElementById('ct-match-table');
  if (noMatchesDiv) noMatchesDiv.classList.remove('hidden');
  if (matchTable) matchTable.classList.add('hidden');
}

function closeCTModal() {
  ctModal.classList.add('hidden');
  ctConfirmBar.classList.add('hidden');
  if (ctEventSource) {
    ctEventSource.close();
    ctEventSource = null;
  }
}

async function fetchCtSettings() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/comictagger/schedule`);
    const data = await res.json();
    ctScheduleInput.value = data.minutes || 60;
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

/**
 * Fetch pending match details including images and render UI
 */
async function fetchPendingMatchDetails() {
  try {
    console.log('[CT] Fetching pending match details...');

    // Get pending match details including first page URL
    const detailsRes = await fetch(`${API_BASE_URL}/api/v1/comictagger/pending-details`);
    if (!detailsRes.ok) {
      throw new Error(`Failed to fetch pending details: ${detailsRes.status}`);
    }
    const details = await detailsRes.json();

    if (!details.waitingForResponse) {
      console.log('[CT] No pending matches to fetch');
      return;
    }

    const firstPageUrl = details.firstPageUrl;

    // Use matches from backend if available, otherwise use temp collected matches
    const matchesToEnrich = details.matches && details.matches.length > 0
      ? details.matches
      : tempMatches;

    console.log('[CT] Found', matchesToEnrich.length, 'matches to enrich');

    if (matchesToEnrich.length === 0) {
      console.warn('[CT] No matches to render!');
      return;
    }

    try {
      // Enrich matches with ComicVine cover images
      console.log('[CT] Fetching cover images from ComicVine...');
      const coversRes = await fetch(`${API_BASE_URL}/api/v1/comictagger/match-covers`, {
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

      console.log('[CT] ✓ Rendered', enrichedMatches.length, 'matches with cover images');
    } catch (coverError) {
      // Fallback: render matches without cover images if enrichment fails
      console.warn('[CT] Cover enrichment failed, rendering without covers:', coverError.message);
      clearCtMatches();
      matchesToEnrich.forEach(match => {
        renderCtMatch({ ...match, coverUrl: null }, firstPageUrl);
      });
      console.log('[CT] ✓ Rendered', matchesToEnrich.length, 'matches without covers');
    }

    // Clear temp matches
    tempMatches = [];

  } catch (error) {
    console.error('[CT] Fatal error fetching match details:', error);

    // Last resort fallback: try to render tempMatches if we have them
    if (tempMatches.length > 0) {
      console.warn('[CT] Using tempMatches as last resort fallback');
      clearCtMatches();
      tempMatches.forEach(match => renderCtMatch(match, null));
      console.log('[CT] ✓ Rendered', tempMatches.length, 'matches from temp cache');
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
          ? `<img src="${comicFirstPageUrl}"
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
          ? `<img src="${match.coverUrl}"
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
               data-choice="${match.choice}"
               id="match-${match.choice}">
      </td>
      <td class="py-2">
        <label for="match-${match.choice}" class="cursor-pointer block">
          <div class="font-semibold text-white text-lg mb-2">
            ${match.choice}. ${match.title} ${match.year ? `(${match.year})` : ''}
          </div>
          ${imageComparisonHtml}
          <div class="text-sm text-gray-300 space-y-1">
            <div><span class="text-gray-400">Issue:</span> #${match.issue || match.number}</div>
            <div><span class="text-gray-400">Publisher:</span> ${match.publisher}</div>
            ${match.subtitle ? `<div><span class="text-gray-400">Subtitle:</span> ${match.subtitle}</div>` : ''}
          </div>
        </label>
      </td>`;
  ctMatchBody.appendChild(tr);
}

async function saveCtSettings() {
  const schedule = parseInt(ctScheduleInput.value, 10) || 0;
  await fetch(`${API_BASE_URL}/api/v1/comictagger/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: schedule })
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
