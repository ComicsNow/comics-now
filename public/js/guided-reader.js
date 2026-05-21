import { state } from './globals.js';

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

// Guided Reader settings tab — UI logic.
// Loads/saves settings, drives manual run/cancel, polls status, streams the live log.

let guidedEventSource = null;
let guidedStatusInterval = null;
let initialized = false;
const logBuffer = [];
const LOG_BUFFER_MAX = 500;

function getLevelFilter() {
  const sel = document.getElementById('guided-log-level-filter');
  return sel ? sel.value : 'ALL';
}

function entryMatches(entry, levelFilter) {
  if (levelFilter === 'ALL') return true;
  return (entry.level || 'INFO').toUpperCase() === levelFilter;
}

function entryHtml(entry) {
  const level = (entry.level || 'INFO').toUpperCase();
  const idAttr = entry.id ? ` data-log-id="${global.escapeHtml(entry.id)}"` : '';
  return `<div class="log-entry"${idAttr}><span class="log-${level}">${level}</span> ${global.escapeHtml(entry.message || '')}</div>`;
}

function rerenderLog() {
  const logBox = document.getElementById('guided-log');
  if (!logBox) return;
  const filter = getLevelFilter();
  logBox.innerHTML = logBuffer.filter(e => entryMatches(e, filter)).map(entryHtml).join('');
  requestAnimationFrame(() => { logBox.scrollTop = logBox.scrollHeight; });
}

function api(path) {
  // API_BASE_URL is declared at script scope in globals.js / app.js
  const base = (typeof global.API_BASE_URL !== 'undefined' ? global.API_BASE_URL : '') || '';
  return `${base}${path}`;
}

function el(id) {
  return document.getElementById(id);
}

function appendLogLine(entry) {
  // In-place updates: replace the prior buffer entry sharing this id.
  if (entry.id) {
    const i = logBuffer.findIndex(e => e.id === entry.id);
    if (i >= 0) logBuffer[i] = entry;
    else logBuffer.push(entry);
  } else {
    logBuffer.push(entry);
  }
  while (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();

  const logBox = el('guided-log');
  if (!logBox) return;
  if (!entryMatches(entry, getLevelFilter())) return;

  const isAtBottom = logBox.scrollHeight - logBox.clientHeight <= logBox.scrollTop + 20;

  // If this is an in-place update and the line is already on screen, swap
  // its content instead of appending a new row.
  if (entry.id) {
    const existing = logBox.querySelector(`[data-log-id="${CSS.escape(entry.id)}"]`);
    if (existing) {
      const wrap = document.createElement('div');
      wrap.innerHTML = entryHtml(entry);
      existing.replaceWith(wrap.firstChild);
      return;
    }
  }

  const wrap = document.createElement('div');
  wrap.innerHTML = entryHtml(entry);
  logBox.appendChild(wrap.firstChild);
  while (logBox.children.length > LOG_BUFFER_MAX) logBox.removeChild(logBox.firstChild);

  if (isAtBottom || logBox.children.length < 5) {
    requestAnimationFrame(() => { logBox.scrollTop = logBox.scrollHeight; });
  }
}

function applyStatusToUI(s) {
  if (!s) return;
  const counts = s.counts || {};
  el('guided-count-pending').textContent = counts.pending ?? 0;
  el('guided-count-processing').textContent = counts.processing ?? 0;
  el('guided-count-completed').textContent = counts.completed ?? 0;
  el('guided-count-failed').textContent = counts.failed ?? 0;
  el('guided-count-total').textContent = counts.total ?? 0;

  const cur = s.current;
  const currentEl = el('guided-current');
  if (s.isRunning && cur) {
    currentEl.textContent = `Running: [${cur.index}/${cur.total}] ${cur.name}`;
    currentEl.className = 'text-sm text-blue-400 mt-3';
  } else if (s.isRunning) {
    currentEl.textContent = 'Running…';
    currentEl.className = 'text-sm text-blue-400 mt-3';
  } else {
    currentEl.textContent = s.lastFinishedAt
      ? `Idle. Last run finished ${new Date(s.lastFinishedAt).toLocaleString()}`
      : 'Idle.';
    currentEl.className = 'text-sm text-gray-400 mt-3';
  }

  const runBtn = el('guided-run-btn');
  const cancelBtn = el('guided-cancel-btn');
  if (runBtn) runBtn.disabled = !!s.isRunning;
  if (cancelBtn) cancelBtn.disabled = !s.isRunning;
}

function applySettingsToUI(settings) {
  if (!settings) return;
  el('guided-auto-on-add').checked = !!settings.autoOnAdd;
  el('guided-schedule-enabled').checked = !!settings.scheduleEnabled;
  el('guided-schedule-interval').value = settings.scheduleInterval ?? 24;
  const unitSel = el('guided-schedule-unit');
  if (unitSel) unitSel.value = settings.scheduleUnit === 'days' ? 'days' : 'hours';
}

async function fetchStatus() {
  try {
    const res = await fetch(api('/api/v1/guided/status'));
    if (!res.ok) return;
    const data = await res.json();
    applyStatusToUI(data);
    applySettingsToUI(data.settings);
  } catch (e) {
    // Silent — polling, will retry.
  }
}

function startStream() {
  if (guidedEventSource) return;
  try {
    guidedEventSource = new EventSource(api('/api/v1/guided/stream'));
    guidedEventSource.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        appendLogLine(entry);
      } catch (_) {}
    };
    guidedEventSource.onerror = () => {
      // Browser will auto-reconnect; nothing to do.
    };
  } catch (e) {
    // EventSource not available — fall back to manual log fetch.
  }
}

function stopStream() {
  if (guidedEventSource) {
    guidedEventSource.close();
    guidedEventSource = null;
  }
}

// Polling fallback: some reverse proxies still buffer SSE despite
// X-Accel-Buffering: no, leaving the log frozen during long ML inference.
// Reconcile against /api/v1/guided/logs every few seconds so missed entries
// still appear without the user having to reload the tab.
let guidedLogPollInterval = null;
async function reconcileLogs() {
  try {
    const res = await fetch(api('/api/v1/guided/logs'));
    if (!res.ok) return;
    const serverLogs = await res.json();
    if (!Array.isArray(serverLogs) || serverLogs.length === 0) return;
    const seenIds = new Set();
    const seenStamps = new Set();
    for (const e of logBuffer) {
      if (e.id) seenIds.add(e.id);
      else seenStamps.add(`${e.timestamp}|${e.message}`);
    }
    let changed = false;
    for (const entry of serverLogs) {
      if (entry.id) {
        // For id'd entries, replace if message differs (in-place update)
        const existing = logBuffer.find(e => e.id === entry.id);
        if (!existing || existing.message !== entry.message) {
          appendLogLine(entry);
          changed = true;
        }
      } else {
        const key = `${entry.timestamp}|${entry.message}`;
        if (!seenStamps.has(key)) {
          appendLogLine(entry);
          changed = true;
        }
      }
    }
    // Autoscroll handled inside appendLogLine.
    void changed;
  } catch (_) {}
}

function startLogPolling() {
  if (guidedLogPollInterval) return;
  reconcileLogs();
  guidedLogPollInterval = setInterval(reconcileLogs, 1000);
}

function stopLogPolling() {
  if (guidedLogPollInterval) {
    clearInterval(guidedLogPollInterval);
    guidedLogPollInterval = null;
  }
}

function startPolling() {
  if (guidedStatusInterval) return;
  fetchStatus();
  guidedStatusInterval = setInterval(fetchStatus, 1000);
}

function stopPolling() {
  if (guidedStatusInterval) {
    clearInterval(guidedStatusInterval);
    guidedStatusInterval = null;
  }
}

function bindOnce() {
  if (initialized) return;
  initialized = true;

  el('guided-run-btn')?.addEventListener('click', async () => {
    try {
      await fetch(api('/api/v1/guided/run'), { method: 'POST' });
      fetchStatus();
    } catch (_) {}
  });

  el('guided-cancel-btn')?.addEventListener('click', async () => {
    try {
      await fetch(api('/api/v1/guided/cancel'), { method: 'POST' });
      fetchStatus();
    } catch (_) {}
  });

  el('guided-log-clear')?.addEventListener('click', async () => {
    logBuffer.length = 0;
    const logBox = el('guided-log');
    if (logBox) logBox.innerHTML = '';
    try {
      await fetch(api('/api/v1/guided/logs/clear'), { method: 'POST' });
    } catch (_) {}
  });

  el('guided-log-level-filter')?.addEventListener('change', rerenderLog);

  el('guided-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = el('guided-settings-status');
    if (status) {
      status.textContent = 'Saving…';
      status.className = 'text-sm text-center text-gray-400';
    }
    const payload = {
      autoOnAdd: el('guided-auto-on-add').checked,
      scheduleEnabled: el('guided-schedule-enabled').checked,
      scheduleInterval: parseInt(el('guided-schedule-interval').value, 10) || 24,
      scheduleUnit: el('guided-schedule-unit').value
    };
    try {
      const res = await fetch(api('/api/v1/guided/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || 'Save failed');
      if (status) {
        status.textContent = '✓ Saved';
        status.className = 'text-sm text-center text-green-400';
      }
      setTimeout(() => { if (status) status.textContent = ''; }, 2500);
    } catch (err) {
      if (status) {
        status.textContent = `✗ ${err.message || err}`;
        status.className = 'text-sm text-center text-red-400';
      }
    }
  });
}

// Called by events.js when the user clicks the Guided Reader tab.
function openGuidedReaderTab() {
  bindOnce();
  fetchStatus();
  startStream();
  startPolling();
  startLogPolling();
}

// When the settings modal closes, the tab handlers don't fire — wire teardown
// to the modal close path. closeSettingsModal is defined in settings.js.
const origClose = global.closeSettingsModal;
if (typeof origClose === 'function') {
  global.closeSettingsModal = function () {
    stopStream();
    stopPolling();
    stopLogPolling();
    return origClose.apply(this, arguments);
  };
} else {
  // If not immediately available, we can intercept calls via defineProperty or wait until it is set.
  // Using global getter/setter properties via state or Object.defineProperty is super robust!
  // Let's define it on state so it gets mirrored or intercepted by the proxy when it is called.
  let currentClose = global.closeSettingsModal;
  Object.defineProperty(state, 'closeSettingsModal', {
    get() {
      return currentClose;
    },
    set(newVal) {
      if (typeof newVal === 'function') {
        currentClose = function() {
          stopStream();
          stopPolling();
          stopLogPolling();
          return newVal.apply(this, arguments);
        };
      } else {
        currentClose = newVal;
      }
    },
    configurable: true,
    enumerable: true
  });
  
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'closeSettingsModal', {
      get() {
        return state.closeSettingsModal;
      },
      set(newVal) {
        state.closeSettingsModal = newVal;
      },
      configurable: true,
      enumerable: true
    });
  }
}

export {
  openGuidedReaderTab
};

state.openGuidedReaderTab = openGuidedReaderTab;

if (typeof window !== 'undefined') {
  window.openGuidedReaderTab = openGuidedReaderTab;
}

