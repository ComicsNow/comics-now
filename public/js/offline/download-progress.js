import { state, clearElement } from '../globals.js';
import { html, raw, render } from '../ui/template.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };
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
    return String(v);
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
const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({ __isRawHtml: true, html: String(v ?? '') });

export async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url, { method: 'GET', credentials: 'include' });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body?.getReader();
  if (!reader) {
    const blob = await res.blob();
    onProgress?.(1);
    return blob;
  }
  let received = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) {
      onProgress?.(received / total);
    }
  }
  return new Blob(chunks);
}

export async function refreshDownloadsInfo() {
  const db = state.OfflineDB || window.OfflineDB || {};
  if (!db.getAllDownloadedComics) {
    console.warn('[DOWNLOADS INFO] OfflineDB not ready');
    return;
  }

  const downloadsInfoDiv = state.downloadsInfoDiv || window.downloadsInfoDiv;
  if (!downloadsInfoDiv) return;

  downloadsInfoDiv.textContent = 'Calculating...';
  let downloadedComics = [];
  try {
    downloadedComics = await db.getAllDownloadedComics();
  } catch (err) {
    console.error('[DOWNLOADS INFO] Failed to calculate downloads:', err);
    renderContent(downloadsInfoDiv, safeHtml`<div class="text-red-400 text-sm">Error calculating downloads. Please refresh.</div>`);
    return;
  }
  let totalSize = 0;
  
  // Clear and prepare container
  clear(downloadsInfoDiv);
  const list = document.createElement('ul');

  const applyDisplayInfoToComic = state.applyDisplayInfoToComic || window.applyDisplayInfoToComic;

  downloadedComics.forEach(comic => {
    totalSize += comic.fileBlob?.size || 0;
    const comicInfo = comic.comicInfo || {};
    const info = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic(comicInfo) : comicInfo;
    const displayName = info.displayTitle || comicInfo.name || 'Unknown Comic';

    const li = document.createElement('li');
    li.className = 'text-sm flex justify-between items-center';

    const nameSpan = document.createElement('span');
    nameSpan.title = displayName;
    nameSpan.textContent = displayName;
    li.appendChild(nameSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-download-btn text-red-500 hover:text-red-700';
    deleteBtn.dataset.id = comic.id;
    deleteBtn.dataset.name = displayName;
    deleteBtn.textContent = 'Delete';
    li.appendChild(deleteBtn);

    list.appendChild(li);
  });

  const summary = document.createElement('div');
  renderContent(summary, safeHtml`
    <p><strong>${downloadedComics.length}</strong> comics downloaded.</p>
    <p><strong>Total size:</strong> ${(totalSize / 1024 / 1024).toFixed(2)} MB</p>
  `);
  
  const listWrapper = document.createElement('div');
  listWrapper.className = 'mt-4 max-h-48 overflow-y-auto';
  listWrapper.appendChild(list);
  
  downloadsInfoDiv.appendChild(summary);
  downloadsInfoDiv.appendChild(listWrapper);

  document.querySelectorAll('.delete-download-btn').forEach(btn => {
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      const id = target.dataset.id;
      const comicName = target.dataset.name || target.closest('li')?.querySelector('span')?.textContent || 'comic';

      if (!confirm(`Delete "${comicName}" from offline storage?`)) {
        return;
      }

      try {
        console.log(`[DOWNLOADS INFO] Starting deletion of comic: ${comicName} (${id})`);
        target.disabled = true;
        target.textContent = 'Deleting...';

        const db = state.OfflineDB || window.OfflineDB || {};
        const deleteFn = db.deleteOfflineComic || state.deleteOfflineComic || window.deleteOfflineComic;
        const cleanupFn = db.forceStorageCleanup || state.forceStorageCleanup || window.forceStorageCleanup;

        if (deleteFn) {
          await deleteFn(id);
          console.log(`[DOWNLOADS INFO] Successfully called deleteOfflineComic for: ${id}`);
        } else {
          throw new Error('deleteOfflineComic function not found in state or global scope');
        }

        if (cleanupFn) {
          try {
            await cleanupFn();
          } catch (e) {
            console.warn('[DOWNLOADS INFO] forceStorageCleanup failed (non-critical):', e);
          }
        }

        const fetchLibrary = state.fetchLibrary || window.fetchLibrary;
        if (typeof fetchLibrary === 'function') {
          try {
            await fetchLibrary();
          } catch (e) {
            console.warn('[DOWNLOADS INFO] fetchLibrary failed (non-critical):', e);
          }
        }
        
        console.log(`[DOWNLOADS INFO] Refreshing UI after deletion of: ${id}`);
        await refreshDownloadsInfo();
      } catch (error) {
        console.error('[DOWNLOADS INFO] Error deleting comic:', error);
        alert('Failed to delete comic. Please try again.');
        target.disabled = false;
        target.textContent = 'Delete';
      }
    });
  });
}

// Assign to state and window for transition compatibility
state.fetchWithProgress = fetchWithProgress;
state.refreshDownloadsInfo = refreshDownloadsInfo;

if (typeof window !== 'undefined') {
  window.fetchWithProgress = fetchWithProgress;
  window.refreshDownloadsInfo = refreshDownloadsInfo;
}
