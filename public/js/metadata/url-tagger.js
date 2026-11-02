import { state, global as canonicalGlobal, clearElement } from '../globals.js';
import { html, render } from '../ui/template.js';

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
  const formatVal = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(formatVal).join('');
    if (typeof v === 'object' && v.__isRawHtml) return v.html;
    if (typeof v === 'object' && typeof v.toHTML === 'function') return v.toHTML();
    return typeof global.escapeHtml === 'function' ? global.escapeHtml(v) : String(v);
  };
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      out += formatVal(values[i]);
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

function createUrlTaggerBox() {
  const container = document.createElement('div');
  container.id = 'tag-from-url-container';
  container.className = 'bg-gray-800/80 border border-blue-500/30 rounded-lg p-3 mb-4';

  renderContent(container, safeHtml`
    <div class="flex items-center justify-between mb-1.5">
      <label class="text-xs font-semibold text-blue-400 flex items-center gap-1.5" for="tag-url-input">
        <span>🌐</span> Tag from Web URL (r.jina + Gemini)
      </label>
      <span class="text-[11px] text-gray-400">League of Comic Geeks, Fandom Wiki, or store link</span>
    </div>
    <div class="flex gap-2">
      <input type="url" id="tag-url-input" placeholder="https://..." class="bg-gray-700 text-xs text-white p-2 rounded-md flex-1 border border-gray-600 focus:outline-hidden focus:ring-1 focus:ring-blue-500" />
      <button type="button" id="tag-url-btn" class="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors cursor-pointer">
        <span>⚡</span> Extract & Apply
      </button>
    </div>
    <div id="tag-url-status" class="text-[11px] mt-1 text-gray-300 hidden"></div>
  `);

  const btn = container.querySelector('#tag-url-btn');
  const input = container.querySelector('#tag-url-input');
  const status = container.querySelector('#tag-url-status');

  btn.addEventListener('click', async () => {
    if (typeof window !== 'undefined' && window._geminiState && window._geminiState._loaded && window._geminiState.enabled === false) {
      status.className = 'text-[11px] mt-1 text-red-400 block';
      status.textContent = '❌ Gemini is disabled in settings. Enable Gemini in Tag Comics Now! -> Gemini AI to use web URL extraction.';
      return;
    }
    const url = input.value.trim();
    if (!url || !url.startsWith('http')) {
      status.className = 'text-[11px] mt-1 text-red-400 block';
      status.textContent = 'Please enter a valid web URL starting with http:// or https://';
      return;
    }

    btn.disabled = true;
    renderContent(btn, safeHtml`<span>⏳</span> Extracting...`);
    status.className = 'text-[11px] mt-1 text-blue-300 block';
    status.textContent = 'Fetching clean markdown via r.jina.ai & synthesizing ComicInfo with Gemini...';

    try {
      const apiBase = global.API_BASE_URL || '';
      const comicName = global.currentComic ? global.currentComic.name : '';
      const res = await fetch(`${apiBase}/api/v1/metadata/extract-from-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          filename: comicName,
          existingMeta: global.currentMetadata || {}
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to extract metadata');
      }

      if (data.metadata) {
        global.currentMetadata = { ...(global.currentMetadata || {}), ...data.metadata };
        if (state) state.metadataHasUnsavedChanges = true;
        const renderFn = global.renderMetadataDisplay || (typeof window !== 'undefined' ? window.renderMetadataDisplay : null);
        if (typeof renderFn === 'function') {
          renderFn(global.currentMetadata, true);
        }
        if (data.dailyUsed !== undefined) {
          const dailyUsedDiv = document.getElementById('ct-gemini-daily-used');
          if (dailyUsedDiv) {
            dailyUsedDiv.textContent = `${data.dailyUsed} requests used`;
          }
        }

        const newStatus = global.metadataForm.querySelector('#tag-url-status');
        if (newStatus) {
          newStatus.className = 'text-[11px] mt-1 text-green-400 block';
          const quotaNotice = data.dailyUsed !== undefined ? ` (Gemini requests used today: ${data.dailyUsed})` : '';
          newStatus.textContent = `✅ Metadata extracted successfully!${quotaNotice} Click "Save Changes" below to commit to comic file.`;
        }
      }
    } catch (err) {
      status.className = 'text-[11px] mt-1 text-red-400 block';
      status.textContent = `❌ ${err.message}`;
    } finally {
      btn.disabled = false;
      renderContent(btn, safeHtml`<span>⚡</span> Extract & Apply`);
    }
  });

  return container;
}

async function loadMetadata() {
  if (state) state.metadataHasUnsavedChanges = false;
  const isAdmin = global.syncManager && global.syncManager.userRole === 'admin';
  if (!isAdmin) return;

  const comic = global.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) {
    renderContent(global.metadataForm, safeHtml`<p class="text-gray-400 text-center italic">Metadata management is disabled for folder mode library comics.</p>`);
    return;
  }

  try {
    if (!global.currentComic) {
      throw new Error('No comic loaded');
    }
    if (!global.currentMetadata) {
      const response = await fetch(
        `${global.API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(global.encodePath(global.currentComic.path))}`
      );
      if (!response.ok) throw new Error('Metadata not found.');
      global.currentMetadata = await response.json();
    }
    const renderFn = global.renderMetadataDisplay || (typeof window !== 'undefined' ? window.renderMetadataDisplay : null);
    if (typeof renderFn === 'function') {
      renderFn(global.currentMetadata, true, { preserveTitle: true });
    }
  } catch (error) {
    renderContent(global.metadataForm, safeHtml`<p class="text-red-400 text-center">${error.message}</p>`);
  }
}

export {
  createUrlTaggerBox,
  loadMetadata
};
