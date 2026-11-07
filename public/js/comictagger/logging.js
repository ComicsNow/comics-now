import {
  state,
  clearElement,
  render,
  html,
  raw,
  escapeHtml,
  ctOutputDiv,
  global as canonicalGlobal
} from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };
const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
    el.innerHTML = content.toHTML();
  } else if (content && typeof content === 'object' && content.__isRawHtml) {
    el.innerHTML = content.html;
  } else {
    el.innerHTML = String(content ?? '');
  }
};

const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__isRawHtml) out += v.html;
      else if (v && typeof v === 'object' && typeof v.toHTML === 'function') out += v.toHTML();
      else out += (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''));
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

export const seenLogEntries = new Set();
export const ctLogLineElements = new Map();

export function isRateDefenseMessage(message) {
  return /Rate defense|cooldown/i.test(String(message || ''));
}

export function ctLogEntryKey(entry) {
  if (entry && entry.id) return `id:${entry.id}:${entry.timestamp || ''}`;
  return `${entry.timestamp}_${entry.message}`;
}

export function formatLogTime(isoString) {
  if (!isoString) return '';
  const str = String(isoString).trim();
  const m = str.match(/T?(\d{2}:\d{2}:\d{2})/);
  if (m) return m[1];
  return str;
}

export function formatCtLogMessage(timestamp, message) {
  const line = document.createElement('div');
  line.className = 'ct-log-line py-0.5 font-mono text-xs sm:text-sm';

  if (/^[━─]+$/.test(message)) {
    line.className = 'ct-log-separator border-b border-gray-700/60 my-1';
    return line;
  }

  let colorClass = 'text-gray-300';
  let icon = '';
  let bold = false;

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
      renderContent(msgSpan, safeHtml`<span class="shrink-0">⏳</span> <span>${subMsg}</span>`);
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

export function upsertCtLogLine(entry) {
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

export function upsertRateDefenseLine(entry) {
  const lastChild = ctOutputDiv ? ctOutputDiv.lastElementChild : null;
  if (lastChild && lastChild.dataset && lastChild.dataset.logType === 'rate-defense') {
    ctOutputDiv.replaceChild(formatCtLogMessage(entry.timestamp, entry.message), lastChild);
    return true;
  }
  return false;
}

export function smartScrollToBottom(container, threshold = 35) {
  if (!container) return;
  const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + threshold;
  if (isAtBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

export function appendLocalCtLogLine(message) {
  if (!ctOutputDiv) return;
  const line = formatCtLogMessage(new Date().toISOString(), message);
  line.dataset.local = 'true';
  ctOutputDiv.appendChild(line);
  smartScrollToBottom(ctOutputDiv);
}

export function applyCtLogEntry(entry) {
  if (!entry || typeof entry.message !== 'string') return false;
  if (!entry.id && (entry.isUpdate || isRateDefenseMessage(entry.message)) && upsertRateDefenseLine(entry)) {
    return true;
  }
  return upsertCtLogLine(entry);
}

export async function loadCtSavedLogs(onProgress) {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/logs`);
    const logs = await res.json();
    if (Array.isArray(logs) && logs.length > 0 && ctOutputDiv) {
      clear(ctOutputDiv);
      seenLogEntries.clear();
      ctLogLineElements.clear();
      logs.forEach(entry => {
        applyCtLogEntry(entry);
        if (typeof onProgress === 'function') {
          onProgress(entry.message);
        } else if (typeof global.updateCtProgressFromLog === 'function') {
          global.updateCtProgressFromLog(entry.message);
        }
      });
      ctOutputDiv.scrollTop = ctOutputDiv.scrollHeight;
    }
  } catch (error) {}
}

global.smartScrollToBottom = smartScrollToBottom;
global.isRateDefenseMessage = isRateDefenseMessage;
global.ctLogEntryKey = ctLogEntryKey;
global.formatLogTime = formatLogTime;
global.formatCtLogMessage = formatCtLogMessage;
global.upsertCtLogLine = upsertCtLogLine;
global.upsertRateDefenseLine = upsertRateDefenseLine;
global.appendLocalCtLogLine = appendLocalCtLogLine;
global.applyCtLogEntry = applyCtLogEntry;
global.loadCtSavedLogs = loadCtSavedLogs;
