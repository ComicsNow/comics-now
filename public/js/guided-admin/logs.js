import { state, global as canonicalGlobal, clearElement } from '../globals.js';
import { raw, render } from '../ui/template.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const clear = typeof clearElement === 'function' ? clearElement : (el) => {
  if (el) {
    if (typeof el.replaceChildren === 'function') el.replaceChildren();
    else el.innerHTML = '';
  }
};

const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  const toStr = (c) => {
    if (c === null || c === undefined) return '';
    if (Array.isArray(c)) return c.map(toStr).join('');
    if (typeof c === 'object' && typeof c.toHTML === 'function') return c.toHTML();
    if (typeof c === 'object' && c.__isRawHtml) return c.html;
    return String(c);
  };
  el.innerHTML = toStr(content);
};

const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({ __isRawHtml: true, html: String(v ?? '') });

function api(path) {
  const base = (typeof global.API_BASE_URL !== 'undefined' ? global.API_BASE_URL : '') || '';
  return `${base}${path}`;
}

function el(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

export const logBuffer = [];
export const LOG_BUFFER_MAX = 500;
let guidedEventSource = null;
let guidedLogPollInterval = null;

export function getLevelFilter() {
  const sel = el('guided-log-level-filter');
  return sel ? sel.value : 'ALL';
}

export function entryMatches(entry, levelFilter) {
  if (levelFilter === 'ALL') return true;
  return (entry.level || 'INFO').toUpperCase() === levelFilter;
}

export function entryHtml(entry) {
  const level = (entry.level || 'INFO').toUpperCase();
  const escapeFn = typeof global.escapeHtml === 'function' ? global.escapeHtml : String;
  const idAttr = entry.id ? ` data-log-id="${escapeFn(entry.id)}"` : '';
  return `<div class="log-entry"${idAttr}><span class="log-${level}">${level}</span> ${escapeFn(entry.message || '')}</div>`;
}

export function rerenderLog() {
  const logBox = el('guided-log');
  if (!logBox) return;
  const filter = getLevelFilter();
  renderContent(logBox, safeRaw(logBuffer.filter(e => entryMatches(e, filter)).map(entryHtml).join('')));
  requestAnimationFrame(() => { logBox.scrollTop = logBox.scrollHeight; });
}

export function appendLogLine(entry) {
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

  if (entry.id) {
    const existing = logBox.querySelector(`[data-log-id="${CSS.escape(entry.id)}"]`);
    if (existing) {
      const wrap = document.createElement('div');
      renderContent(wrap, safeRaw(entryHtml(entry)));
      existing.replaceWith(wrap.firstChild);
      return;
    }
  }

  const wrap = document.createElement('div');
  renderContent(wrap, safeRaw(entryHtml(entry)));
  logBox.appendChild(wrap.firstChild);
  while (logBox.children.length > LOG_BUFFER_MAX) logBox.removeChild(logBox.firstChild);

  if (isAtBottom || logBox.children.length < 5) {
    requestAnimationFrame(() => { logBox.scrollTop = logBox.scrollHeight; });
  }
}

export function clearLogs() {
  logBuffer.length = 0;
  const logBox = el('guided-log');
  if (logBox) clear(logBox);
}

export function startStream() {
  if (guidedEventSource) return;
  try {
    guidedEventSource = new EventSource(api('/api/v1/guided/stream'));
    guidedEventSource.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        appendLogLine(entry);
      } catch (_) {}
    };
    guidedEventSource.onerror = () => {};
  } catch (e) {}
}

export function stopStream() {
  if (guidedEventSource) {
    guidedEventSource.close();
    guidedEventSource = null;
  }
}

export async function reconcileLogs() {
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
    for (const entry of serverLogs) {
      if (entry.id) {
        const existing = logBuffer.find(e => e.id === entry.id);
        if (!existing || existing.message !== entry.message) {
          appendLogLine(entry);
        }
      } else {
        const key = `${entry.timestamp}|${entry.message}`;
        if (!seenStamps.has(key)) {
          appendLogLine(entry);
        }
      }
    }
  } catch (_) {}
}

export function startLogPolling() {
  if (guidedLogPollInterval) return;
  reconcileLogs();
  guidedLogPollInterval = setInterval(reconcileLogs, 1000);
}

export function stopLogPolling() {
  if (guidedLogPollInterval) {
    clearInterval(guidedLogPollInterval);
    guidedLogPollInterval = null;
  }
}
