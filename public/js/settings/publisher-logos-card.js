import { openPublisherLogoZoom } from './publisher-logo-zoom.js';

export function createLogoDisplay(p, staged) {
  const isPendingDelete = staged?.type === 'delete';
  const previewUrl = staged?.previewUrl || (!isPendingDelete ? p.logo_url : null);
  const hasLogo = Boolean(previewUrl);
  const panelBgClass = p.needsDarkBackground ? 'bg-gray-900' : 'bg-gray-700/50';

  const display = document.createElement('div');
  display.className = `relative h-24 w-full rounded-lg flex items-center justify-center overflow-hidden cursor-pointer select-none ${panelBgClass}`;
  display.title = hasLogo ? `Click to zoom ${p.publisher} logo` : `${p.publisher} (no logo)`;

  if (hasLogo) {
    const wrapper = document.createElement('div');
    const bgClasses = p.needsLightBackground ? 'bg-white/95 rounded-lg p-2' : (p.needsDarkBackground ? 'bg-gray-900 rounded-lg p-2' : 'p-2');
    wrapper.className = `flex items-center justify-center h-full w-full ${bgClasses}`;
    const img = document.createElement('img');
    img.src = previewUrl;
    img.alt = `${p.publisher} logo`;
    img.className = 'h-full w-full object-contain';
    img.loading = 'lazy';
    wrapper.appendChild(img);
    display.appendChild(wrapper);
  } else {
    display.innerHTML = '<svg class="w-8 h-8 text-gray-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v1H4V6zm14 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8h16zm-2 2H4v4h12v-4z"></path></svg>';
  }

  if (staged) {
    const badge = document.createElement('span');
    badge.className = isPendingDelete
      ? 'absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-900/90 text-red-200 border border-red-700/70 shadow-sm'
      : 'absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-900/90 text-amber-200 border border-amber-700/70 shadow-sm';
    badge.textContent = isPendingDelete ? '● Pending Delete' : '● Pending Save';
    display.appendChild(badge);
  }

  display.addEventListener('click', () => {
    if (previewUrl) openPublisherLogoZoom({ url: previewUrl, title: p.publisher, format: p.format, width: p.width, height: p.height });
  });
  return display;
}

const ICONS = {
  upload: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>',
  fetch: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>',
  delete: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>',
  revert: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>',
  spinner: '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>'
};

export function createCard(p, handlers = {}) {
  const staged = handlers.staged;
  const card = document.createElement('div');
  card.className = 'pl-card bg-gray-800 border border-gray-700/60 rounded-lg p-3 flex flex-col items-center gap-2 hover:border-gray-600 transition-colors shadow-sm';
  card.setAttribute('data-publisher', p.publisher);

  const name = document.createElement('span');
  name.className = 'text-xs text-gray-200 font-semibold truncate w-full text-center px-1';
  name.textContent = p.publisher;
  name.title = p.publisher;

  const actions = document.createElement('div');
  actions.className = 'flex items-center justify-center gap-1.5 mt-auto pt-1 w-full';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.setAttribute('accept', '.svg,.png,.webp,.jpg,.jpeg,.gif');
  fileInput.className = 'hidden';
  fileInput.setAttribute('aria-label', `Upload logo for ${p.publisher}`);

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.title = 'Upload custom logo';
  uploadBtn.className = 'flex-1 flex items-center justify-center py-1.5 px-2 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors';
  uploadBtn.innerHTML = ICONS.upload;
  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file && typeof handlers.onUpload === 'function') {
      handlers.onUpload(p.publisher, file).finally(() => { fileInput.value = ''; });
    }
  });

  const fetchBtn = document.createElement('button');
  fetchBtn.type = 'button';
  fetchBtn.title = 'Fetch logo from ComicVine';
  fetchBtn.className = 'flex-1 flex items-center justify-center py-1.5 px-2 rounded bg-purple-700/80 hover:bg-purple-600 text-white transition-colors';
  fetchBtn.innerHTML = ICONS.fetch;
  fetchBtn.addEventListener('click', () => {
    if (typeof handlers.onFetch === 'function') {
      fetchBtn.disabled = true;
      fetchBtn.innerHTML = ICONS.spinner;
      handlers.onFetch(p.publisher).finally(() => {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = ICONS.fetch;
      });
    }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  if (staged) {
    deleteBtn.title = 'Revert pending change';
    deleteBtn.className = 'flex-1 flex items-center justify-center py-1.5 px-2 rounded bg-amber-700/80 hover:bg-amber-600 text-white transition-colors';
    deleteBtn.innerHTML = ICONS.revert;
    deleteBtn.addEventListener('click', () => handlers.onRevert?.(p.publisher));
  } else {
    deleteBtn.title = 'Delete logo';
    deleteBtn.className = 'flex-1 flex items-center justify-center py-1.5 px-2 rounded bg-red-950/60 hover:bg-red-800 text-red-300 border border-red-800/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed';
    deleteBtn.innerHTML = ICONS.delete;
    deleteBtn.disabled = !p.hasLogo;
    deleteBtn.addEventListener('click', () => handlers.onDelete?.(p.publisher));
  }

  actions.append(fileInput, uploadBtn, fetchBtn, deleteBtn);
  card.append(createLogoDisplay(p, staged), name, actions);
  return card;
}
