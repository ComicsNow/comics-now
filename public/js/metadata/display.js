import { state, global as canonicalGlobal, clearElement } from '../globals.js';
import { sanitizeMetadata } from './sanitizer.js';
import { escapeSelector, createFormRow, createChipInputRow } from './form-fields.js';
import { createUrlTaggerBox } from './url-tagger.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});
const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };

const KNOWN_FIELDS = [
  'Title', 'Series', 'Number', 'Summary',
  'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer', 'Editor',
  'Publisher', 'Imprint', 'AgeRating',
  'Characters', 'Teams', 'Locations',
  'StoryArc', 'StoryArcNumber',
  'Genre', 'Web', 'ISBN',
  'Cover Date', 'Store Date', 'PageCount', 'Format'
];

function renderMetadataDisplay(metadata, clearForm = true, options = {}) {
  const isCurrentComicMeta = (global.currentMetadata && metadata === global.currentMetadata) || Boolean(options && options.preserveTitle);
  const opts = { ...options, preserveTitle: Boolean(isCurrentComicMeta) };
  const sanitizeFn = typeof sanitizeMetadata === 'function' ? sanitizeMetadata : (global.sanitizeMetadata || (typeof window !== 'undefined' ? window.sanitizeMetadata : null));
  if (metadata && typeof metadata === 'object' && typeof sanitizeFn === 'function') {
    sanitizeFn(metadata, opts);
  }
  if (global.currentMetadata && typeof global.currentMetadata === 'object' && global.currentMetadata !== metadata && typeof sanitizeFn === 'function') {
    sanitizeFn(global.currentMetadata, { ...options, preserveTitle: true });
  }

  if (clearForm && global.metadataForm) {
    clear(global.metadataForm);
    const statusDiv = document.createElement('div');
    statusDiv.id = 'save-status';
    statusDiv.className = 'text-sm text-gray-300';
    global.metadataForm.appendChild(statusDiv);
  }

  const isAdmin = global.syncManager && global.syncManager.userRole === 'admin';

  if (clearForm && isAdmin && global.metadataForm) {
    const urlTaggerFn = typeof createUrlTaggerBox === 'function' ? createUrlTaggerBox : (global.createUrlTaggerBox || (typeof window !== 'undefined' ? window.createUrlTaggerBox : null));
    if (typeof urlTaggerFn === 'function') {
      global.metadataForm.appendChild(urlTaggerFn());
    }
  }

  const merged = { ...(metadata || {}) };
  const nonFieldKeys = new Set([
    'cover_image_url', 'coverUrl', 'matching_url', 'type', 'id', 'source', 'fullMetadata', 'genres'
  ]);
  for (const k of nonFieldKeys) {
    delete merged[k];
  }

  const chipFields = new Set(['Characters', 'Teams', 'Locations', 'StoryArc', 'Genre']);

  if (!global.metadataForm) return;

  for (const [key, val] of Object.entries(merged)) {
    if (!isAdmin && (!val || val === '')) continue;
    const existing = global.metadataForm.querySelector(`[name="${escapeSelector(key)}"]`);
    if (existing) {
      if (chipFields.has(key) && isAdmin) {
        const row = existing.closest('div');
        if (row && row.parentElement) {
          row.parentElement.replaceChild(createChipInputRow(key, String(val || '')), row);
        }
      } else {
        existing.value = val ?? existing.value ?? '';
        if (!isAdmin) existing.disabled = true;
      }
      continue;
    }

    if (isAdmin) {
      if (chipFields.has(key)) {
        global.metadataForm.appendChild(createChipInputRow(key, String(val || '')));
      } else {
        const type = key === 'Summary' ? 'textarea' : 'text';
        global.metadataForm.appendChild(createFormRow(key, val ?? '', type));
      }
    } else {
      const div = document.createElement('div');
      div.className = 'mb-3';
      const label = document.createElement('div');
      label.className = 'text-sm font-semibold text-gray-400 mb-1';
      label.textContent = key;
      const value = document.createElement('div');
      value.className = 'bg-gray-800 text-gray-300 p-2 rounded-lg';
      value.textContent = val || '—';
      div.appendChild(label);
      div.appendChild(value);
      global.metadataForm.appendChild(div);
    }
  }

  if (isAdmin && !global.metadataForm.querySelector('#missing-fields-section')) {
    const submitButton = global.metadataForm.querySelector('button[type="submit"]');

    function addFieldToForm(key) {
      if (global.metadataForm.querySelector(`[name="${escapeSelector(key)}"]`)) return;
      if (chipFields.has(key)) {
        global.metadataForm.insertBefore(createChipInputRow(key, ''), submitButton);
      } else {
        const type = key === 'Summary' ? 'textarea' : 'text';
        global.metadataForm.insertBefore(createFormRow(key, ''), submitButton);
      }
      const el = global.metadataForm.querySelector(`[name="${escapeSelector(key)}"]`);
      if (el) setTimeout(() => el.focus(), 50);
    }

    function buildMissingSection() {
      let section = global.metadataForm.querySelector('#missing-fields-section');
      if (section) section.remove();

      const missingKeys = KNOWN_FIELDS.filter(k =>
        !global.metadataForm.querySelector(`[name="${escapeSelector(k)}"]`) &&
        !String(merged[k] || '').trim()
      );

      if (!missingKeys.length) return;

      section = document.createElement('div');
      section.id = 'missing-fields-section';
      section.className = 'mt-4 border-t border-gray-700 pt-3';

      const header = document.createElement('div');
      header.className = 'text-xs text-gray-500 uppercase tracking-wide mb-2 select-none';
      header.textContent = `Empty fields (${missingKeys.length})`;
      section.appendChild(header);

      const pillRow = document.createElement('div');
      pillRow.className = 'flex flex-wrap gap-2';

      for (const key of missingKeys) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'text-xs px-3 py-1 rounded-full border border-dashed border-gray-600 text-gray-500 hover:border-purple-400 hover:text-purple-300 transition-colors';
        pill.textContent = `+ ${key}`;
        pill.title = `Add ${key} field`;
        pill.addEventListener('click', () => {
          addFieldToForm(key);
          pill.remove();
          const remaining = pillRow.querySelectorAll('button').length;
          if (!remaining) section.remove();
          else header.textContent = `Empty fields (${remaining})`;
        });
        pillRow.appendChild(pill);
      }

      section.appendChild(pillRow);

      const customBtn = document.createElement('button');
      customBtn.id = 'add-custom-field';
      customBtn.type = 'button';
      customBtn.className = 'mt-2 text-xs text-gray-600 hover:text-gray-400 underline';
      customBtn.textContent = 'Add custom field…';
      customBtn.addEventListener('click', () => {
        const key = prompt('Enter field name (e.g., Translator, CoverArtist):');
        if (!key?.trim()) return;
        if (global.metadataForm.querySelector(`[name="${escapeSelector(key.trim())}"]`)) {
          return alert('That field already exists.');
        }
        addFieldToForm(key.trim());
      });
      section.appendChild(customBtn);

      global.metadataForm.appendChild(section);
    }

    buildMissingSection();
  }

  if (isAdmin) {
    let submitButton = global.metadataForm.querySelector('button[type="submit"]');
    if (!submitButton) {
      submitButton = document.createElement('button');
      submitButton.type = 'submit';
      submitButton.className = 'w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-full transition-colors mt-4';
      submitButton.textContent = 'Save Changes';
      global.metadataForm.appendChild(submitButton);
    }
  }
}

export {
  KNOWN_FIELDS,
  renderMetadataDisplay
};
