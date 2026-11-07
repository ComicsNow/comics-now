import {
  state,
  scanIntervalInput,
  settingsStatusDiv,
  scanButton,
  fullScanButton,
  logsContainer,
  settingsForm,
  global as canonicalGlobal,
  escapeHtml
} from '../globals.js';
import { html, render } from '../ui/template.js';
import { triggerScan } from '../events.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

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

const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__isRawHtml) out += v.html;
      else if (v && typeof v === 'object' && typeof v.toHTML === 'function') out += v.toHTML();
      else out += (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v));
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

export async function fetchSettings() {
  try {
    const response = await fetch(`${global.API_BASE_URL}/api/v1/settings`);
    const data = await response.json();
    if (scanIntervalInput) {
      scanIntervalInput.value = data.scanInterval || 5;
    }

    const pageCacheInput = document.getElementById('page-cache-max-input');
    if (pageCacheInput && data.pageCacheMaxMb) {
      pageCacheInput.value = data.pageCacheMaxMb;
    }

    const pageCacheUsage = document.getElementById('page-cache-usage');
    if (pageCacheUsage) {
      if (data.pageCacheUsageBytes === null || data.pageCacheUsageBytes === undefined) {
        pageCacheUsage.textContent = 'Current usage unavailable.';
      } else {
        const usedMb = Math.round(data.pageCacheUsageBytes / (1024 * 1024));
        const files = Number(data.pageCacheFileCount || 0).toLocaleString();
        const limit = data.pageCacheMaxMb ? ` of ${data.pageCacheMaxMb} MB` : '';
        pageCacheUsage.textContent = `Using ${usedMb} MB${limit} across ${files} files`;
      }
    }

    const allowedFormatsSelect = document.getElementById('allowed-formats-select');
    if (allowedFormatsSelect && data.allowedFormats) {
      allowedFormatsSelect.value = data.allowedFormats;
    }

    const cbrConversionSelect = document.getElementById('cbr-conversion-originals-select');
    if (cbrConversionSelect && data.deleteCbrAfterConversion !== undefined) {
      cbrConversionSelect.value = data.deleteCbrAfterConversion ? 'delete' : 'keep';
    }

    const pdfConversionSelect = document.getElementById('pdf-conversion-originals-select');
    if (pdfConversionSelect && data.deletePdfAfterConversion !== undefined) {
      pdfConversionSelect.value = data.deletePdfAfterConversion ? 'delete' : 'keep';
    }

    const readingOrdersIntervalInput = document.getElementById('reading-orders-interval-input');
    if (readingOrdersIntervalInput && data.readingOrdersIntervalDays !== undefined) {
      readingOrdersIntervalInput.value = data.readingOrdersIntervalDays;
    }

    const readingOrdersModeSelect = document.getElementById('reading-orders-mode-select');
    if (readingOrdersModeSelect && data.readingOrdersMode) {
      readingOrdersModeSelect.value = data.readingOrdersMode;
    }
  } catch (error) {
    if (settingsStatusDiv) {
      settingsStatusDiv.textContent = 'Failed to load settings.';
    }
  }
}

export async function fetchLogs() {
  const levelFilter = document.getElementById('log-level-filter');
  const categoryFilter = document.getElementById('log-category-filter');
  if (!levelFilter || !categoryFilter || !logsContainer) return;

  const level = levelFilter.value;
  const category = categoryFilter.value;
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/logs?level=${level}&category=${category}`);
    if (!res.ok) throw new Error('Server returned an error');
    const logs = await res.json();
    const logRows = logs.reverse().map(log =>
      safeHtml`<div class="log-entry"><span class="log-${log.level}">${log.level}</span> <span class="log-${log.category}">[${log.category}]</span> ${log.message}</div>`
    );
    renderContent(logsContainer, logRows);
  } catch (e) {
    renderContent(logsContainer, safeHtml`<div class="text-red-500">Failed to fetch logs.</div>`);
  }
}

export function initSettingsFormEvents() {
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (settingsStatusDiv) settingsStatusDiv.textContent = 'Saving...';

      const interval = scanIntervalInput ? scanIntervalInput.value : null;
      const pageCacheInput = document.getElementById('page-cache-max-input');
      const pageCacheMaxMb = pageCacheInput && pageCacheInput.value !== ''
        ? Number(pageCacheInput.value)
        : undefined;
      const readingOrdersIntervalInput = document.getElementById('reading-orders-interval-input');
      const readingOrdersIntervalDays = readingOrdersIntervalInput && readingOrdersIntervalInput.value !== ''
        ? Number(readingOrdersIntervalInput.value)
        : undefined;
      const readingOrdersModeSelect = document.getElementById('reading-orders-mode-select');
      const readingOrdersMode = readingOrdersModeSelect ? readingOrdersModeSelect.value : undefined;
      let apiKey = '';
      let allowedFormats = 'cbz';
      let metadataStorage = 'archive';
      let deleteCbrAfterConversion = false;
      let deletePdfAfterConversion = false;
      try {
        const existing = await (await fetch(`${global.API_BASE_URL}/api/v1/settings`)).json();
        apiKey = existing.comicVineApiKey || '';
        allowedFormats = existing.allowedFormats || 'cbz';
        metadataStorage = existing.metadataStorage || 'archive';
        deleteCbrAfterConversion = existing.deleteCbrAfterConversion === true;
        deletePdfAfterConversion = existing.deletePdfAfterConversion === true;
      } catch (err) {
        console.error('Failed to read existing settings before save:', err);
      }

      try {
        const res = await fetch(`${global.API_BASE_URL}/api/v1/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interval,
            apiKey,
            allowedFormats,
            metadataStorage,
            pageCacheMaxMb,
            deleteCbrAfterConversion,
            deletePdfAfterConversion,
            readingOrdersIntervalDays,
            readingOrdersMode
          })
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ message: 'An unknown error occurred.' }));
          throw new Error(errorData.message);
        }

        if (settingsStatusDiv) {
          if (typeof global.showSettingsMessage === 'function') {
            global.showSettingsMessage('Settings saved!', 'success');
          }
        }
        await fetchSettings();
        if (typeof global.fetchLibrary === 'function') {
          global.fetchLibrary();
        }
      } catch (error) {
        if (settingsStatusDiv) {
          if (typeof global.showSettingsMessage === 'function') {
            global.showSettingsMessage(`Error: ${error.message}`, 'error');
          }
        }
      }
    });
  }

  if (scanButton) {
    scanButton.addEventListener('click', async () => {
      scanButton.textContent = 'Scanning...';
      scanButton.disabled = true;
      try {
        await triggerScan();
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage('Scan initiated successfully.', 'success');
        }
      } catch (e) {
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage('Failed to start scan.', 'error');
        }
      } finally {
        setTimeout(async () => {
          scanButton.textContent = 'Scan Now';
          scanButton.disabled = false;
          if (typeof global.fetchLibrary === 'function') {
            await global.fetchLibrary();
          }
        }, 3000);
      }
    });
  }

  if (fullScanButton) {
    fullScanButton.addEventListener('click', async () => {
      fullScanButton.textContent = 'Scanning...';
      fullScanButton.disabled = true;
      try {
        await triggerScan(null, true);
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage('Full scan initiated successfully.', 'success');
        }
      } catch (e) {
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage('Failed to start full scan.', 'error');
        }
      } finally {
        setTimeout(async () => {
          fullScanButton.textContent = 'Full Scan';
          fullScanButton.disabled = false;
          if (typeof global.fetchLibrary === 'function') {
            await global.fetchLibrary();
          }
        }, 3000);
      }
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsFormEvents);
  } else {
    initSettingsFormEvents();
  }
}
