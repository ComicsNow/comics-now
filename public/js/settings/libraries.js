import {
  state,
  global as canonicalGlobal,
  escapeHtml
} from '../globals.js';
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

export async function refreshLibraryFolders() {
  const list = document.getElementById('library-folders-list');
  const adminSection = document.getElementById('admin-only-libraries');
  if (!list) return;

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/admin/libraries`);

    if (res.status === 403) {
      if (adminSection) adminSection.classList.add('hidden');
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to fetch libraries');

    if (adminSection) adminSection.classList.remove('hidden');

    if (Array.isArray(data.libraries)) {
      global.configuredRootFolders = data.libraries.map((lib, index) => `lib_${index}`);
      global.LIBRARY_NAMES = global.LIBRARY_NAMES || {};
      data.libraries.forEach((lib, index) => {
        const id = `lib_${index}`;
        const name = lib.path.split(/[\\\/]/).filter(Boolean).pop() || `Library ${index + 1}`;
        global.LIBRARY_NAMES[id] = name;
      });
    }

    if (!Array.isArray(data.libraries) || data.libraries.length === 0) {
      renderContent(list, safeHtml`<p class="text-sm text-gray-500 italic">No library folders added.</p>`);
    } else {
      const libCards = data.libraries.map(lib => safeHtml`
        <div class="flex items-center justify-between bg-gray-800/50 p-3 rounded-lg border border-gray-700/50 hover:border-purple-500/30 transition-all group">
          <div class="flex items-center min-w-0 flex-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-3 text-purple-400 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate text-gray-200" title="${lib.path}">${lib.path}</div>
              <div class="text-[10px] uppercase tracking-wider text-gray-500 font-bold">${lib.hierarchyMode === 'folder' ? 'Folder Mode' : 'Metadata Mode'}</div>
            </div>
          </div>
          <button class="remove-library-btn text-gray-500 hover:text-red-400 font-bold px-2 transition-colors shrink-0" data-path="${lib.path}" title="Remove Library">&times;</button>
        </div>
      `);
      renderContent(list, libCards);
    }

    list.querySelectorAll('.remove-library-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.dataset.path;
        if (confirm(`Remove library folder: ${path}?`)) {
          await removeLibraryFolder(path);
        }
      });
    });
  } catch (err) {
    console.error(err);
    renderContent(list, safeHtml`<p class="text-sm text-red-500">Error: ${err.message}</p>`);
  }
}

export async function removeLibraryFolder(path) {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/admin/libraries`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to remove library');

    await refreshLibraryFolders();
    if (typeof global.fetchLibraryFromServer === 'function') {
      await global.fetchLibraryFromServer();
    } else if (typeof global.fetchLibrary === 'function') {
      await global.fetchLibrary();
    }
    if (typeof global.showSettingsMessage === 'function') {
      global.showSettingsMessage('Library removed successfully', 'success');
    }
  } catch (err) {
    if (typeof global.showSettingsMessage === 'function') {
      global.showSettingsMessage(`Error: ${err.message}`, 'error');
    }
  }
}

export function initLibraryFolderControls() {
  const addBtn = document.getElementById('add-library-btn');
  const pathInput = document.getElementById('new-library-path');
  const modeSelect = document.getElementById('new-library-mode');

  if (addBtn && pathInput) {
    addBtn.addEventListener('click', async () => {
      const path = pathInput.value.trim();
      const mode = modeSelect ? modeSelect.value : 'metadata';
      if (!path) return;

      try {
        addBtn.disabled = true;
        const res = await fetch(`${global.API_BASE_URL}/api/v1/admin/libraries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, hierarchyMode: mode })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to add library');

        pathInput.value = '';
        await refreshLibraryFolders();
        if (typeof global.fetchLibraryFromServer === 'function') {
          await global.fetchLibraryFromServer();
        } else if (typeof global.fetchLibrary === 'function') {
          await global.fetchLibrary();
        }
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage('Library added successfully', 'success');
        }
      } catch (err) {
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage(`Error: ${err.message}`, 'error');
        }
      } finally {
        addBtn.disabled = false;
      }
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLibraryFolderControls);
  } else {
    initLibraryFolderControls();
  }
}
