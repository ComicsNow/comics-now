// Bulk read/unread dialog. Mirrors the bulk-download confirm flow but runs the
// optimistic, server-backed read-status update against every comic in scope.
// Exposed as window.openBulkReadStatusDialog(comics, scopeLabel).

(function (global) {
  'use strict';

  function getComicReadStatus(comic) {
    const progress = comic.progress || {};
    const total = progress.totalPages || 0;
    const lastRead = progress.lastReadPage || 0;
    if (total > 0 && lastRead >= total - 1) return 'read';
    if (lastRead > 0) return 'in-progress';
    return 'unread';
  }

  function buildModal() {
    let backdrop = document.getElementById('bulk-status-modal');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'bulk-status-modal';
    backdrop.className = 'fixed inset-0 bg-black/70 z-50 hidden flex items-center justify-center p-4';
    backdrop.innerHTML = `
      <div class="bg-gray-800 rounded-xl border border-gray-700 max-w-md w-full p-5 space-y-4 shadow-2xl">
        <h3 class="text-lg font-bold text-white">Mark as Read / Unread</h3>
        <p id="bulk-status-scope" class="text-sm text-gray-300"></p>
        <div id="bulk-status-counts" class="text-xs text-gray-400 grid grid-cols-3 gap-2"></div>
        <div id="bulk-status-progress" class="text-sm text-blue-300 hidden"></div>
        <div class="flex flex-wrap gap-2 justify-end pt-2">
          <button id="bulk-status-cancel" type="button"
                  class="pill-button bg-gray-700 hover:bg-gray-600 text-white">Cancel</button>
          <button id="bulk-status-mark-unread" type="button"
                  class="pill-button bg-gray-600 hover:bg-gray-500 text-white">Mark all Unread</button>
          <button id="bulk-status-mark-read" type="button"
                  class="pill-button bg-purple-600 hover:bg-purple-700 text-white">Mark all Read</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    document.getElementById('bulk-status-cancel').addEventListener('click', close);
    return backdrop;
  }

  function close() {
    const backdrop = document.getElementById('bulk-status-modal');
    if (backdrop) backdrop.classList.add('hidden');
  }

  // Drop pre-computed `_counts` caches on every series/publisher touched by a
  // bulk apply so the next render recomputes from the now-mutated comic
  // progress objects. Without this, lazy-loaded cards keep showing stale
  function invalidateCachedCounts(comics) {
    if (!global.library) return;
    const comicIds = new Set(comics.map(c => String(c.id)));
    for (const rootFolder of Object.keys(global.library)) {
      const publishers = global.library[rootFolder]?.publishers || {};
      for (const pubName of Object.keys(publishers)) {
        const pub = publishers[pubName];
        const seriesEntries = pub?.series || {};
        let pubTouched = false;
        for (const sName of Object.keys(seriesEntries)) {
          const sComics = seriesEntries[sName] || [];
          const sComicsArray = Array.isArray(sComics) ? sComics : [];
          if (sComicsArray.some(c => comicIds.has(String(c.id)))) {
            if (seriesEntries[sName] && seriesEntries[sName]._counts) delete seriesEntries[sName]._counts;
            pubTouched = true;
          }
        }
        if (pubTouched && pub._counts) {
          delete pub._counts;
        }
      }
    }
  }
  async function applyStatus(comics, status, progressEl) {
    const base = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '') || '';
    const total = comics.length;
    let done = 0;
    for (const comic of comics) {
      try {
        await fetch(`${base}/api/v1/comics/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comicId: comic.id, status })
        });
        if (typeof global.updateLibraryReadStatus === 'function') {
          global.updateLibraryReadStatus({ comicId: comic.id, status });
        }
      } catch (_) {
        // Continue on individual errors — the user can re-run.
      }
      done++;
      if (progressEl) progressEl.textContent = `Updating… ${done}/${total}`;
    }
    invalidateCachedCounts(comics);
    return done;
  }

  function open(comics, scopeLabel) {
    if (!Array.isArray(comics) || comics.length === 0) {
      alert('No comics in this selection.');
      return;
    }
    const backdrop = buildModal();

    const scopeEl = document.getElementById('bulk-status-scope');
    const countsEl = document.getElementById('bulk-status-counts');
    const progressEl = document.getElementById('bulk-status-progress');
    const readBtn = document.getElementById('bulk-status-mark-read');
    const unreadBtn = document.getElementById('bulk-status-mark-unread');

    let read = 0, unread = 0, inProgress = 0;
    for (const c of comics) {
      const s = getComicReadStatus(c);
      if (s === 'read') read++;
      else if (s === 'in-progress') inProgress++;
      else unread++;
    }

    scopeEl.textContent = `${comics.length} comic${comics.length === 1 ? '' : 's'} in ${scopeLabel || 'selection'}.`;
    countsEl.innerHTML = `
      <div class="bg-gray-700/50 rounded p-2 text-center"><div class="text-green-400 font-semibold">${read}</div><div>Read</div></div>
      <div class="bg-gray-700/50 rounded p-2 text-center"><div class="text-yellow-400 font-semibold">${inProgress}</div><div>In progress</div></div>
      <div class="bg-gray-700/50 rounded p-2 text-center"><div class="text-gray-300 font-semibold">${unread}</div><div>Unread</div></div>
    `;
    progressEl.classList.add('hidden');
    progressEl.textContent = '';

    function setBusy(busy) {
      readBtn.disabled = busy;
      unreadBtn.disabled = busy;
      readBtn.classList.toggle('opacity-50', busy);
      unreadBtn.classList.toggle('opacity-50', busy);
      progressEl.classList.toggle('hidden', !busy);
    }

    // Replace listeners by cloning — open() can be called multiple times.
    const newRead = readBtn.cloneNode(true);
    readBtn.parentNode.replaceChild(newRead, readBtn);
    const newUnread = unreadBtn.cloneNode(true);
    unreadBtn.parentNode.replaceChild(newUnread, unreadBtn);

    newRead.addEventListener('click', async () => {
      setBusy(true);
      await applyStatus(comics, 'read', progressEl);
      if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
      close();
    });
    newUnread.addEventListener('click', async () => {
      setBusy(true);
      await applyStatus(comics, 'unread', progressEl);
      if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
      close();
    });

    backdrop.classList.remove('hidden');
  }

  global.openBulkReadStatusDialog = open;
  global.closeBulkReadStatusDialog = close;
})(typeof window !== 'undefined' ? window : globalThis);
