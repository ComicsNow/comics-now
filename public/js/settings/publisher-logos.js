import { createCard } from './publisher-logos-card.js';

function getApiBase() {
  const base = (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.baseUrl)
    ? window.APP_CONFIG.baseUrl.replace(/\/$/, '')
    : '';
  return `${base}/api/admin/publishers/logos`;
}

function resolveLogoUrl(rawUrl) {
  if (!rawUrl) return null;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  const base = (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.baseUrl)
    ? window.APP_CONFIG.baseUrl.replace(/\/$/, '')
    : '';
  if (base && rawUrl.startsWith(base)) return rawUrl;
  return `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
}

const state = {
  grid: null,
  floatingBar: null,
  toastEl: null,
  publishers: [],
  loading: false,
  error: null,
  searchQuery: '',
  activeFilter: 'all',
  stagedChanges: new Map(),
  saving: false
};

function normalize(p) {
  if (!p || !p.publisher) return null;
  const rawUrl = p.url || p.logo_url || p.logo || null;
  const logoUrl = resolveLogoUrl(rawUrl);
  return {
    publisher: p.publisher,
    safeName: p.safeName || '',
    hasLogo: Boolean(p.hasLogo || logoUrl),
    logo_url: logoUrl,
    format: p.format || (logoUrl ? logoUrl.split('.').pop() : null),
    width: p.dimensions?.width ?? p.width ?? null,
    height: p.dimensions?.height ?? p.height ?? null,
    needsLightBackground: Boolean(p.needsLightBackground),
    needsDarkBackground: Boolean(p.needsDarkBackground)
  };
}

function dispatchLogoUpdated(publisher, logoUrl) {
  window.dispatchEvent(new CustomEvent('PUBLISHER_LOGO_UPDATED', {
    detail: { publisher, logoUrl }
  }));
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data.error || data.message || message;
    } catch (_) {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return typeof response.json === 'function' ? await response.json() : JSON.parse(await response.text() || '{}');
}

function showToast(message, isError = false) {
  const barLabel = state.floatingBar?.querySelector('#pl-staged-count');
  if (barLabel) {
    barLabel.textContent = message;
    barLabel.className = isError
      ? 'text-xs font-semibold text-red-300 bg-red-950/80 px-2.5 py-1 rounded border border-red-800'
      : 'text-xs font-semibold text-emerald-300 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-800';
    clearTimeout(state.barResetTimer);
    state.barResetTimer = setTimeout(() => { updateFloatingBar(); }, 5000);
  }

  let toast = document.getElementById('publisher-logos-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'publisher-logos-toast';
    document.body.appendChild(toast);
  }
  toast.className = `fixed top-6 right-6 z-50 max-w-sm px-4 py-2.5 rounded-lg shadow-2xl text-xs font-semibold transition-all duration-300 ${
    isError ? 'bg-red-900 text-red-100 border border-red-700' : 'bg-emerald-900 text-emerald-100 border border-emerald-700'
  }`;
  toast.textContent = message;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast?.remove(); }, 4500);
}

async function commitChanges() {
  if (state.saving || state.stagedChanges.size === 0) return;
  state.saving = true;
  updateFloatingBar();
  try {
    const changes = Array.from(state.stagedChanges.entries()).map(([publisher, c]) => ({ publisher, type: c.type, data: c.data, filename: c.filename }));
    const res = await apiRequest(`${getApiBase()}/save`, { method: 'POST', body: JSON.stringify({ changes }) });
    const count = typeof res?.count === 'number' ? res.count : changes.length;
    const failures = Array.isArray(res?.results) ? res.results.filter(r => r.action === 'failed') : [];
    state.stagedChanges.clear();
    if (failures.length > 0) {
      showToast(`Saved ${count} change(s), but ${failures.length} failed.`, true);
    } else {
      showToast(`✓ Successfully saved ${count} publisher logo change(s)!`);
    }
    if (Array.isArray(res?.results)) {
      res.results.forEach(r => dispatchLogoUpdated(r.publisher, r.logo || null));
    }
    await loadPublishers();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    updateFloatingBar();
  }
}

function updateFloatingBar() {
  const bar = state.floatingBar;
  if (!bar) return;
  const count = state.stagedChanges.size;
  const countLabel = bar.querySelector('#pl-staged-count');
  const discardBtn = bar.querySelector('#pl-discard-btn');
  const saveBtn = bar.querySelector('#pl-save-btn');

  if (countLabel) {
    countLabel.textContent = state.saving ? 'Saving changes to server…' : (count === 0 ? '✓ All publisher logos up to date' : `● ${count} unsaved change${count === 1 ? '' : 's'}`);
    countLabel.className = state.saving ? 'text-xs text-amber-300 font-medium' : (count === 0 ? 'text-xs text-gray-400' : 'text-xs text-amber-400 font-semibold');
  }
  if (discardBtn) {
    discardBtn.disabled = count === 0 || state.saving;
    discardBtn.className = count > 0 && !state.saving ? 'text-xs px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium cursor-pointer' : 'text-xs px-3 py-1.5 rounded bg-gray-800 text-gray-500 font-medium cursor-not-allowed';
  }
  if (saveBtn) {
    saveBtn.disabled = count === 0 || state.saving;
    saveBtn.textContent = state.saving ? '💾 Saving…' : `💾 Save Changes${count > 0 ? ` (${count})` : ''}`;
    saveBtn.className = count > 0 && !state.saving ? 'text-xs px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-lg cursor-pointer ring-2 ring-emerald-500/50' : 'text-xs px-4 py-1.5 rounded bg-gray-700 text-gray-400 font-medium cursor-not-allowed';
  }
}

function render() {
  const grid = state.grid;
  if (!grid) return;
  grid.replaceChildren();

  if (state.loading) {
    const loading = document.createElement('div');
    loading.className = 'col-span-full text-center text-gray-400 text-sm py-12';
    loading.textContent = 'Loading publishers…';
    grid.appendChild(loading);
    return;
  }
  if (state.error) {
    const error = document.createElement('div');
    error.className = 'col-span-full text-center text-red-400 text-sm py-12';
    error.textContent = state.error;
    grid.appendChild(error);
    return;
  }

  let list = state.publishers;
  if (state.activeFilter === 'with-logo') {
    list = list.filter(p => p.hasLogo);
  } else if (state.activeFilter === 'missing') {
    list = list.filter(p => !p.hasLogo);
  }
  if (state.searchQuery) {
    list = list.filter(p => (p.publisher || '').toLowerCase().includes(state.searchQuery));
  }

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'col-span-full text-center text-gray-400 text-sm py-12';
    empty.textContent = state.searchQuery ? `No publishers matching "${state.searchQuery}".` : 'No publishers found.';
    grid.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  list.forEach(p => {
    const cardEl = createCard(p, {
      staged: state.stagedChanges.get(p.publisher),
      onUpload: async (pub, file) => {
        try {
          const dataUrl = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.onerror = () => rej(new Error('Failed to read file'));
            reader.readAsDataURL(file);
          });
          const base64 = dataUrl.split(',')[1] || dataUrl;
          state.stagedChanges.set(pub, { type: 'upload', data: base64, filename: file.name, mimeType: file.type, previewUrl: dataUrl });
          render();
          updateFloatingBar();
        } catch (err) {
          showToast(err.message, true);
        }
      },
      onFetch: async (pub) => {
        try {
          const res = await apiRequest(`${getApiBase()}/fetch-preview`, { method: 'POST', body: JSON.stringify({ publisher: pub }) });
          if (!res?.success || !res.base64) throw new Error(res?.error || `No logo found on ComicVine for "${pub}"`);
          const previewUrl = res.previewUrl || `data:${res.mimeType || 'image/png'};base64,${res.base64}`;
          state.stagedChanges.set(pub, { type: 'fetch', data: res.base64, filename: `${pub}${res.extension || '.png'}`, mimeType: res.mimeType, previewUrl });
          showToast(`✓ Found logo for "${pub}" — click Save Changes to apply`);
          render();
          updateFloatingBar();
        } catch (err) {
          showToast(err.message, true);
        }
      },
      onDelete: (pub) => {
        state.stagedChanges.set(pub, { type: 'delete' });
        render();
        updateFloatingBar();
      },
      onRevert: (pub) => {
        state.stagedChanges.delete(pub);
        render();
        updateFloatingBar();
      }
    });
    fragment.appendChild(cardEl);
  });
  grid.appendChild(fragment);
}

async function loadPublishers() {
  state.loading = true;
  state.error = null;
  render();
  try {
    const data = await apiRequest(getApiBase());
    state.publishers = Array.isArray(data?.publishers) ? data.publishers.map(normalize).filter(Boolean) : [];
  } catch (error) {
    state.error = error.message || 'Failed to load publishers';
    state.publishers = [];
  } finally {
    state.loading = false;
    render();
    updateFloatingBar();
  }
}

function init(container) {
  container.replaceChildren();
  const header = document.createElement('div');
  header.className = 'mb-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5';
  const controls = document.createElement('div');
  controls.className = 'flex flex-wrap items-center gap-2 w-full';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search publishers…';
  searchInput.className = 'flex-1 min-w-[130px] px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-gray-200 placeholder-gray-500 focus:outline-hidden focus:border-purple-500';
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = (e.target.value || '').toLowerCase().trim();
    render();
  });
  controls.appendChild(searchInput);

  const filterGroup = document.createElement('div');
  filterGroup.className = 'flex items-center gap-1 bg-gray-900 p-1 rounded-md border border-gray-700 shrink-0';
  const filters = [{ id: 'all', label: 'All' }, { id: 'with-logo', label: 'With Logo' }, { id: 'missing', label: 'Missing' }];
  filters.forEach(f => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = f.label;
    btn.className = `text-xs px-2.5 py-1 rounded transition-colors ${state.activeFilter === f.id ? 'bg-purple-600 text-white font-medium' : 'text-gray-400 hover:text-gray-200'}`;
    btn.addEventListener('click', () => {
      state.activeFilter = f.id;
      filterGroup.querySelectorAll('button').forEach((b, i) => {
        b.className = `text-xs px-2.5 py-1 rounded transition-colors ${filters[i].id === f.id ? 'bg-purple-600 text-white font-medium' : 'text-gray-400 hover:text-gray-200'}`;
      });
      render();
    });
    filterGroup.appendChild(btn);
  });
  controls.appendChild(filterGroup);

  const toastEl = document.createElement('div');
  toastEl.className = 'hidden';
  state.toastEl = toastEl;

  header.append(controls, toastEl);
  container.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-3.5 pb-20';
  container.appendChild(grid);
  state.grid = grid;

  const floatingBar = document.createElement('div');
  floatingBar.id = 'publisher-logos-floating-bar';
  floatingBar.className = 'sticky bottom-0 z-20 mt-4 p-3 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700/80 rounded-b-lg flex items-center justify-between shadow-2xl';

  const countLabel = document.createElement('span');
  countLabel.id = 'pl-staged-count';
  countLabel.textContent = '✓ All publisher logos up to date';
  countLabel.className = 'text-xs text-gray-400';

  const btnGroup = document.createElement('div');
  btnGroup.className = 'flex items-center gap-2';

  const discardBtn = document.createElement('button');
  discardBtn.id = 'pl-discard-btn';
  discardBtn.type = 'button';
  discardBtn.textContent = 'Discard All';
  discardBtn.disabled = true;
  discardBtn.className = 'text-xs px-3 py-1.5 rounded bg-gray-800 text-gray-500 font-medium cursor-not-allowed';
  discardBtn.addEventListener('click', () => {
    state.stagedChanges.clear();
    render();
    updateFloatingBar();
    showToast('Discarded all pending changes');
  });

  const saveBtn = document.createElement('button');
  saveBtn.id = 'pl-save-btn';
  saveBtn.type = 'button';
  saveBtn.textContent = '💾 Save Changes';
  saveBtn.disabled = true;
  saveBtn.className = 'text-xs px-4 py-1.5 rounded bg-gray-700 text-gray-400 font-medium cursor-not-allowed';
  saveBtn.addEventListener('click', commitChanges);

  btnGroup.append(discardBtn, saveBtn);
  floatingBar.append(countLabel, btnGroup);
  container.appendChild(floatingBar);
  state.floatingBar = floatingBar;

  state.publishers = [];
  loadPublishers();

  return () => {
    if (state.grid === grid) state.grid = null;
    if (state.floatingBar === floatingBar) state.floatingBar = null;
    grid.remove();
    floatingBar.remove();
  };
}

export function mountPublisherLogos(target) {
  const container = (typeof target === 'string' ? document.getElementById(target) : target) ||
    document.getElementById('publisher-logos-container') ||
    document.getElementById('publisher-logos-root');
  if (!container) return () => {};
  return init(container);
}

export default mountPublisherLogos;
