import { state } from '../globals.js';

// --- COMICS DEFAULTS (deferred save) ---
// All controls on this subtab stage their changes locally and are only
// persisted when the user clicks "Save Changes". A dirty flag
// (state.comicsDefaultsDirty) drives the unsaved-changes guard in events.js.

let wired = false;

// Snapshot of the last-saved server state, used to compute what changed.
const baseline = {
  masterManga: false,
  masterContinuous: false,
  allowedFormats: 'cbz',
  libraryPrefs: {}, // path -> { mangaMode, continuousMode }
};

const $ = (id) => document.getElementById(id);
const apiBase = () => state.API_BASE_URL || window.API_BASE_URL || '';
const toast = (msg, type) =>
  (state.showSettingsMessage || window.showSettingsMessage || (() => {}))(msg, type);

// --- DIRTY STATE ---
function currentState() {
  const libraryPrefs = {};
  const container = $('library-preferences-container');
  container?.querySelectorAll('[data-lib-path]').forEach((row) => {
    libraryPrefs[row.getAttribute('data-lib-path')] = {
      mangaMode: !!row.querySelector('.lib-toggle-manga')?.checked,
      continuousMode: !!row.querySelector('.lib-toggle-scroll')?.checked,
    };
  });
  return {
    masterManga: !!$('master-manga-toggle')?.checked,
    masterContinuous: !!$('master-continuous-toggle')?.checked,
    allowedFormats: $('allowed-formats-select')?.value || 'cbz',
    libraryPrefs,
  };
}

function isDirty() {
  const cur = currentState();
  if (cur.allowedFormats !== baseline.allowedFormats) return true;
  if (cur.masterManga !== baseline.masterManga) return true;
  if (cur.masterContinuous !== baseline.masterContinuous) return true;
  const paths = new Set([
    ...Object.keys(cur.libraryPrefs),
    ...Object.keys(baseline.libraryPrefs),
  ]);
  for (const p of paths) {
    const a = cur.libraryPrefs[p] || {};
    const b = baseline.libraryPrefs[p] || {};
    if (!!a.mangaMode !== !!b.mangaMode || !!a.continuousMode !== !!b.continuousMode) {
      return true;
    }
  }
  return false;
}

function refreshDirtyUI() {
  const dirty = isDirty();
  state.comicsDefaultsDirty = dirty;
  if (typeof window !== 'undefined') window.comicsDefaultsDirty = dirty;
  const btn = $('comics-defaults-save-btn');
  const ind = $('comics-defaults-dirty-indicator');
  const status = $('comics-defaults-save-status');
  if (btn) btn.disabled = !dirty;
  if (ind) ind.classList.toggle('hidden', !dirty);
  if (status && dirty) status.textContent = '';
}

// --- CHANGE HANDLERS (stage only, no network) ---
function onMasterMangaChange() {
  const checked = !!$('master-manga-toggle')?.checked;
  document
    .querySelectorAll('#library-preferences-container .lib-toggle-manga')
    .forEach((t) => { t.checked = checked; });
  refreshDirtyUI();
}

function onMasterContinuousChange() {
  const checked = !!$('master-continuous-toggle')?.checked;
  document
    .querySelectorAll('#library-preferences-container .lib-toggle-scroll')
    .forEach((t) => { t.checked = checked; });
  refreshDirtyUI();
}

// --- SAVE ---
async function saveAll() {
  const cur = currentState();
  const masterChanged =
    cur.masterManga !== baseline.masterManga ||
    cur.masterContinuous !== baseline.masterContinuous;

  if (masterChanged && !confirm(
    'Saving will apply the master defaults to all libraries and clear individual ' +
    'reading-mode overrides (per-comic, series and publisher). Continue?'
  )) {
    return;
  }

  const btn = $('comics-defaults-save-btn');
  const status = $('comics-defaults-save-status');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Saving…';

  try {
    // 1. Library format settings (allowedFormats).
    if (cur.allowedFormats !== baseline.allowedFormats) {
      let interval = 5;
      let apiKey = '';
      let metadataStorage = 'archive';
      try {
        const existing = await (await fetch(`${apiBase()}/api/v1/settings`)).json();
        interval = existing.scanInterval ?? 5;
        apiKey = existing.comicVineApiKey ?? '';
        metadataStorage = existing.metadataStorage ?? 'archive';
      } catch (e) {
        console.error('[DEFAULTS] Failed to read existing settings before save:', e);
      }
      const res = await fetch(`${apiBase()}/api/v1/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interval,
          apiKey,
          allowedFormats: cur.allowedFormats,
          metadataStorage,
        }),
      });
      if (!res.ok) throw new Error('format settings');
    }

    // 2. Per-library reading preferences.
    const allPaths = Object.keys(cur.libraryPrefs);
    const changedPaths = masterChanged
      ? allPaths
      : allPaths.filter((p) => {
          const a = cur.libraryPrefs[p];
          const b = baseline.libraryPrefs[p] || {};
          return !!a.mangaMode !== !!b.mangaMode || !!a.continuousMode !== !!b.continuousMode;
        });

    for (const path of changedPaths) {
      const pref = cur.libraryPrefs[path];
      const res = await fetch(`${apiBase()}/api/v1/user/library-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          mangaMode: pref.mangaMode,
          continuousMode: pref.continuousMode,
        }),
      });
      if (!res.ok) throw new Error('library preferences');
    }

    toast('Comics defaults saved', 'success');
    if (status) status.textContent = '';

    const fetchLib = state.fetchLibraryFromServer || window.fetchLibraryFromServer;
    if (typeof fetchLib === 'function') fetchLib();

    await reloadAll();
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error');
    if (status) status.textContent = 'Save failed';
    refreshDirtyUI();
  }
}

// --- DATA LOADERS ---
async function loadSettingsValues() {
  try {
    const res = await fetch(`${apiBase()}/api/v1/settings`);
    const data = await res.json();
    const af = $('allowed-formats-select');
    if (af && data.allowedFormats) af.value = data.allowedFormats;
  } catch (e) {
    console.error('[DEFAULTS] Failed to load settings:', e);
  }
  baseline.allowedFormats = $('allowed-formats-select')?.value || 'cbz';
}

async function loadMasterDefaults() {
  try {
    const [mangaRes, contRes] = await Promise.all([
      fetch(`${apiBase()}/api/v1/manga-mode-preference`),
      fetch(`${apiBase()}/api/v1/continuous-mode-preference`),
    ]);
    const mangaData = await mangaRes.json();
    const contData = await contRes.json();
    baseline.masterManga = !!mangaData.mangaMode;
    baseline.masterContinuous = !!contData.continuousMode;
    const mt = $('master-manga-toggle');
    const ct = $('master-continuous-toggle');
    if (mt) mt.checked = baseline.masterManga;
    if (ct) ct.checked = baseline.masterContinuous;
  } catch (e) {
    console.error('[DEFAULTS] Failed to load master defaults:', e);
  }
}

async function renderLibraryPreferences() {
  const container = $('library-preferences-container');
  if (!container) return;
  container.innerHTML = '<p class="text-xs text-gray-500">Loading library folders…</p>';

  try {
    const [libRes, prefRes] = await Promise.all([
      fetch(`${apiBase()}/api/v1/admin/libraries`),
      fetch(`${apiBase()}/api/v1/user/library-preferences`),
    ]);
    const libData = libRes.ok ? await libRes.json().catch(() => ({})) : {};
    const prefData = prefRes.ok ? await prefRes.json().catch(() => ({})) : {};

    const libraries = Array.isArray(libData.libraries) ? libData.libraries : [];
    const prefs = prefData.preferences || {};
    baseline.libraryPrefs = {};

    if (libraries.length === 0) {
      container.innerHTML =
        '<p class="text-xs text-gray-500">No library folders configured yet.</p>';
      return;
    }

    container.innerHTML = '';
    for (const lib of libraries) {
      const p = lib.path;
      const effectivePref = prefs[p] || {};
      const manga =
        effectivePref.mangaMode !== undefined
          ? !!effectivePref.mangaMode
          : baseline.masterManga;
      const continuous =
        effectivePref.continuousMode !== undefined
          ? !!effectivePref.continuousMode
          : baseline.masterContinuous;

      baseline.libraryPrefs[p] = { mangaMode: manga, continuousMode: continuous };

      const row = document.createElement('div');
      row.className =
        'flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-gray-900/60 rounded-lg border border-gray-800 text-xs';
      row.setAttribute('data-lib-path', p);

      const label = document.createElement('div');
      label.className = 'flex-1 min-w-0';
      const name = document.createElement('div');
      name.className = 'font-semibold text-white truncate';
      name.textContent = lib.name || p;
      const pathEl = document.createElement('div');
      pathEl.className = 'text-gray-400 font-mono truncate text-[11px]';
      pathEl.textContent = p;
      label.appendChild(name);
      label.appendChild(pathEl);

      const toggles = document.createElement('div');
      toggles.className = 'flex items-center gap-3 shrink-0';

      const mangaLabel = document.createElement('label');
      mangaLabel.className = 'inline-flex items-center gap-1.5 cursor-pointer text-gray-300';
      mangaLabel.title = 'Default to Manga (RTL) mode for this library';
      const mangaCb = document.createElement('input');
      mangaCb.type = 'checkbox';
      mangaCb.className =
        'lib-toggle-manga rounded bg-gray-800 border-gray-700 text-purple-600 focus:ring-0';
      mangaCb.checked = manga;
      mangaCb.addEventListener('change', refreshDirtyUI);
      mangaLabel.appendChild(mangaCb);
      mangaLabel.appendChild(document.createTextNode('Manga'));

      const scrollLabel = document.createElement('label');
      scrollLabel.className = 'inline-flex items-center gap-1.5 cursor-pointer text-gray-300';
      scrollLabel.title = 'Default to Vertical Scroll mode for this library';
      const scrollCb = document.createElement('input');
      scrollCb.type = 'checkbox';
      scrollCb.className =
        'lib-toggle-scroll rounded bg-gray-800 border-gray-700 text-purple-600 focus:ring-0';
      scrollCb.checked = continuous;
      scrollCb.addEventListener('change', refreshDirtyUI);
      scrollLabel.appendChild(scrollCb);
      scrollLabel.appendChild(document.createTextNode('Scroll'));

      toggles.appendChild(mangaLabel);
      toggles.appendChild(scrollLabel);

      row.appendChild(label);
      row.appendChild(toggles);
      container.appendChild(row);
    }
  } catch (e) {
    console.error('[DEFAULTS] Failed to render library preferences:', e);
    container.innerHTML =
      '<p class="text-xs text-red-400">Failed to load library preferences.</p>';
  }
}

export async function reloadAll() {
  await Promise.all([loadSettingsValues(), loadMasterDefaults()]);
  await renderLibraryPreferences();
  refreshDirtyUI();
}

export const loadComicsDefaults = reloadAll;

// Expose on global state and window
state.loadComicsDefaults = reloadAll;
state.initComicsDefaults = initComicsDefaults;
if (typeof window !== 'undefined') {
  window.loadComicsDefaults = reloadAll;
  window.initComicsDefaults = initComicsDefaults;
}

// --- INIT / WIRE ---
export function initComicsDefaults() {
  if (wired) return;
  wired = true;

  $('allowed-formats-select')?.addEventListener('change', refreshDirtyUI);
  $('master-manga-toggle')?.addEventListener('change', onMasterMangaChange);
  $('master-continuous-toggle')?.addEventListener('change', onMasterContinuousChange);
  $('comics-defaults-save-btn')?.addEventListener('click', saveAll);

  $('settings-tab-comics-defaults')?.addEventListener('click', () => {
    reloadAll();
  });
}

// Auto-wire on module load or DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initComicsDefaults());
} else {
  initComicsDefaults();
}
