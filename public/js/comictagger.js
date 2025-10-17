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
      } else if (ctAwaitingMatches) {
        if (/^Choose a match/i.test(msg) || /^\s*Enter selection/i.test(msg)) {
          ctAwaitingMatches = false;
          // Don't clear matches here - user needs to see them to make a choice
        } else {
          const parsed = parseCtSuggestion(msg);
          if (parsed) renderCtMatch(parsed);
        }
      } else if (/^Choose a match/i.test(msg)) {
        // If we see "Choose a match" prompt when not awaiting, it's a new file
        // This happens after user skipped/applied the previous file
        ctAwaitingMatches = false;
        clearCtMatches();
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

function renderCtMatch(match) {
  // Show the table and hide the "no matches" message
  const noMatchesDiv = document.getElementById('ct-no-matches');
  const matchTable = document.getElementById('ct-match-table');
  if (noMatchesDiv) noMatchesDiv.classList.add('hidden');
  if (matchTable) matchTable.classList.remove('hidden');

  const tr = document.createElement('tr');
  tr.className = 'border-b border-gray-700 hover:bg-gray-800';
  tr.innerHTML = `
      <td class="pr-3 py-2 align-top">
        <input type="checkbox" class="ct-match-select w-4 h-4 cursor-pointer" data-choice="${match.choice}">
      </td>
      <td class="py-2">
        <details open>
          <summary class="cursor-pointer font-semibold text-white hover:text-purple-400">
            ${match.choice}. ${match.title}
          </summary>
          <div class="pl-4 text-sm text-gray-300 space-y-1 mt-2">
            <div><span class="text-gray-400">Number:</span> ${match.number}</div>
            <div><span class="text-gray-400">Publisher:</span> ${match.publisher}</div>
            <div><span class="text-gray-400">Year:</span> ${match.year}</div>
            <div><span class="text-gray-400">Confidence:</span> ${match.confidence}</div>
          </div>
        </details>
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
  const selected = Array.from(ctMatchBody.querySelectorAll('.ct-match-select:checked')).map(cb => cb.dataset.choice);
  await fetch(`${API_BASE_URL}/api/v1/comictagger/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selections: selected })
  });
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
