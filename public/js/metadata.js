import { state } from './globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

// --- METADATA ---

async function loadMetadata() {
  // Security check: only admins can view metadata
  const isAdmin = global.syncManager && global.syncManager.userRole === 'admin';
  if (!isAdmin) return;

  // Local/device comics don't have editable metadata on the server
  const comic = global.currentComic;
  const isLocal = comic && (comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));
  if (isLocal || (comic && comic.libraryMode === 'folder')) {
    global.metadataForm.innerHTML = `<p class="text-gray-400 text-center italic">Metadata management is disabled for folder mode library comics.</p>`;
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
    renderMetadataDisplay(global.currentMetadata, true); // true = clear and render fresh
  } catch (error) {
    global.metadataForm.innerHTML = `<p class="text-red-400 text-center">${global.escapeHtml(error.message)}</p>`;
  }
}

// ====== Editable metadata UI with tag-style chips ======

/** Create a basic text/textarea row */
function createFormRow(name, value = '', type = 'text') {
  const div = document.createElement('div');
  div.className = 'relative group';

  const label = document.createElement('label');
  label.className = 'text-sm font-semibold mb-1 block';
  label.textContent = name;
  label.htmlFor = `meta-${name}`;
  div.appendChild(label);

  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 4;
  } else {
    input = document.createElement('input');
    input.type = type;
  }
  input.name = name;
  input.id = `meta-${name}`;
  input.className = 'bg-gray-700 text-white p-2 rounded-lg w-full focus:outline-hidden focus:ring-2 focus:ring-purple-500';
  input.value = value ?? '';

  div.appendChild(input);

  // Allow removing non-core fields from the UI
  const coreFields = new Set([
    'Title', 'Series', 'Number', 'Summary',
    'Writer', 'Penciller', 'Publisher',
    'Characters', 'Teams', 'Locations'
  ]);
  if (!coreFields.has(name)) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'absolute -top-2 -right-2 bg-gray-600 hover:bg-red-600 text-white text-xs px-2 py-1 rounded-full';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove field';
    removeBtn.addEventListener('click', () => div.remove());
    div.appendChild(removeBtn);
  }

  return div;
}

/** Create a tag-chip input row backed by a hidden CSV input */
function createChipInputRow(name, initialCSV = '') {
  const wrap = document.createElement('div');
  wrap.className = 'relative';

  const label = document.createElement('label');
  label.className = 'text-sm font-semibold mb-1 block';
  label.textContent = name;
  label.htmlFor = `meta-${name}`;
  wrap.appendChild(label);

  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.name = name;
  hidden.id = `meta-${name}`;
  wrap.appendChild(hidden);

  const box = document.createElement('div');
  box.className = 'bg-gray-700 text-white p-2 rounded-lg w-full flex flex-wrap gap-2 items-center';
  wrap.appendChild(box);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = `Add ${name.toLowerCase()}…`;
  input.className = 'bg-transparent outline-hidden flex-1 min-w-[120px]';
  box.appendChild(input);

  const chips = [];

  function setHidden() {
    hidden.value = chips.join(', ');
  }
  function addChip(text) {
    const t = (text || '').trim();
    if (!t) return;
    if (chips.includes(t)) return;
    chips.push(t);
    const chip = document.createElement('span');
    chip.className = 'px-2 py-1 rounded-full bg-gray-600 text-sm flex items-center gap-1';
    chip.innerHTML = `<span>${global.escapeHtml(t)}</span>`;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ml-1 rounded-full w-4 h-4 text-xs bg-gray-500 hover:bg-red-600';
    x.textContent = '×';
    x.title = `Remove ${t}`;
    x.addEventListener('click', () => {
      const idx = chips.indexOf(t);
      if (idx >= 0) chips.splice(idx, 1);
      chip.remove();
      setHidden();
    });
    chip.appendChild(x);
    box.insertBefore(chip, input);
    setHidden();
  }

  // seed initial chips from CSV
  (initialCSV || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(addChip);

  function commitInput() {
    addChip(input.value);
    input.value = '';
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && !input.value && chips.length) {
      // backspace removes last chip
      const last = box.querySelector('span.rounded-full:last-of-type');
      if (last) last.querySelector('button')?.click();
    }
  });
  input.addEventListener('blur', () => commitInput());

  return wrap;
}

function isTitleSameAsSeries(title, series) {
  if (!title) return false;
  let tRaw = String(title).trim();
  tRaw = tRaw.replace(/[\(\[\{]\s*(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital(?:\s+edition)?|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)\s*[\)\]\}]/gi, ' ');
  tRaw = tRaw.replace(/(?:^|[\s,:;/|\-\u2010-\u2015]+)(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital\s+edition|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)(?=$|[\s,:;/|\-\u2010-\u2015]+)/gi, ' ');
  tRaw = tRaw.replace(/\s+/g, ' ').trim();
  if (!tRaw) return true;

  if (/^(?:#|(?:issue|no\.?|vol(?:ume)?\.?|pt\.?|part|book|bk\.?)\s*#?)\s*\d*\s*$/i.test(tRaw)) {
    return true;
  }

  if (!series) return false;
  let sRaw = String(series).trim();
  sRaw = sRaw.replace(/[\(\[\{]\s*(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital(?:\s+edition)?|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)\s*[\)\]\}]/gi, ' ');
  sRaw = sRaw.replace(/(?:^|[\s,:;/|\-\u2010-\u2015]+)(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital\s+edition|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)(?=$|[\s,:;/|\-\u2010-\u2015]+)/gi, ' ');
  sRaw = sRaw.replace(/\s+/g, ' ').trim();
  if (!sRaw) return false;

  if (tRaw.toLowerCase() === sRaw.toLowerCase()) return true;

  const escapedS = sRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const directPattern = new RegExp(
    `^${escapedS}[:\\s\\-_–—]*(?:#|(?:issue|no\\.?|vol(?:ume)?\\.?|pt\\.?|part|book|bk\\.?)\\s*#?)?\\s*\\d+(?:\\s*(?:of|\\/)\\s*\\d+)?\\s*(?:\\(\\d{4}\\))?\\s*[)\\]}]*$`,
    'i'
  );
  if (directPattern.test(tRaw)) return true;

  const normS = sRaw.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normT = tRaw.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (normT === normS) return true;

  if (normT.startsWith(normS)) {
    const rem = normT.slice(normS.length).trim();
    if (/^(?:#|(?:issue|no|vol|volume|pt|part|book|bk)\s*#?)?\s*\d+(?:\s*(?:of|\/)\s*\d+)?(?:\s*\d{4})?$/i.test(rem)) {
      return true;
    }
  }

  if (normS.startsWith(normT)) {
    const rem = normS.slice(normT.length).trim();
    if (/^(?:#|(?:issue|no|vol|volume|pt|part|book|bk)\s*#?)?\s*\d+(?:\s*(?:of|\/)\s*\d+)?(?:\s*\d{4})?$/i.test(rem)) {
      return true;
    }
  }

  return false;
}

function renderMetadataDisplay(metadata, clearForm = true) {
  if (clearForm) {
    global.metadataForm.innerHTML = '';
    const statusDiv = document.createElement('div');
    statusDiv.id = 'save-status';
    statusDiv.className = 'text-sm text-gray-300';
    global.metadataForm.appendChild(statusDiv);
  }

  // Check if user is admin
  const isAdmin = global.syncManager && global.syncManager.userRole === 'admin';

  // Known fields in display order — used to populate the "missing fields" pills for admins
  const KNOWN_FIELDS = [
    'Title', 'Series', 'Number', 'Summary',
    'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer', 'Editor',
    'Publisher', 'Imprint', 'AgeRating',
    'Characters', 'Teams', 'Locations',
    'StoryArc', 'StoryArcNumber',
    'Genre', 'Web', 'ISBN',
    'Cover Date', 'Store Date', 'PageCount', 'Format'
  ];

  // Show only fields that have values (for both admin and non-admin)
  const merged = { ...(metadata || {}) };

  // Rule: If Title is the same as Series (even with issue numbers, #3, 3, volume suffixes), leave it blank!
  if (merged.Title && (isTitleSameAsSeries(merged.Title, merged.Series) || (!merged.Series && isTitleSameAsSeries(merged.Title, '')))) {
    merged.Title = '';
  }

  // Which keys should be chip inputs
  const chipFields = new Set(['Characters', 'Teams', 'Locations', 'StoryArc', 'Genre']);

  // Render each key
  for (const [key, val] of Object.entries(merged)) {
    // For non-admins: skip empty fields
    if (!isAdmin && (!val || val === '')) continue;
    // If an element already exists (e.g., re-render), update it
    const existing = global.metadataForm.querySelector(`[name="${CSS.escape(key)}"]`);
    if (existing) {
      if (chipFields.has(key) && isAdmin) {
        // replace existing chip row if needed to reflect fresh values
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

    // Create fresh - editable if admin, read-only otherwise
    if (isAdmin) {
      if (chipFields.has(key)) {
        global.metadataForm.appendChild(createChipInputRow(key, String(val || '')));
      } else {
        const type = key === 'Summary' ? 'textarea' : 'text';
        global.metadataForm.appendChild(createFormRow(key, val ?? '', type));
      }
    } else {
      // Non-admin: show read-only fields
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

  // --- Missing fields section (admins only) ---
  // Shows clickable pills for each known field that has no value. Clicking a pill
  // adds that field as an editable row above the save button and removes the pill.
  if (isAdmin && !global.metadataForm.querySelector('#missing-fields-section')) {
    const submitButton = global.metadataForm.querySelector('button[type="submit"]');

    function addFieldToForm(key) {
      if (global.metadataForm.querySelector(`[name="${CSS.escape(key)}"]`)) return;
      if (chipFields.has(key)) {
        global.metadataForm.insertBefore(createChipInputRow(key, ''), submitButton);
      } else {
        const type = key === 'Summary' ? 'textarea' : 'text';
        global.metadataForm.insertBefore(createFormRow(key, ''), submitButton);
      }
      // Focus the new input
      const el = global.metadataForm.querySelector(`[name="${CSS.escape(key)}"]`);
      if (el) setTimeout(() => el.focus(), 50);
    }

    function buildMissingSection() {
      let section = global.metadataForm.querySelector('#missing-fields-section');
      if (section) section.remove();

      const missingKeys = KNOWN_FIELDS.filter(k =>
        !global.metadataForm.querySelector(`[name="${CSS.escape(k)}"]`) &&
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
        if (global.metadataForm.querySelector(`[name="${CSS.escape(key.trim())}"]`)) {
          return alert('That field already exists.');
        }
        addFieldToForm(key.trim());
      });
      section.appendChild(customBtn);

      global.metadataForm.appendChild(section);
    }

    buildMissingSection();
  }

  // --- Submit button (only for admins, only once) ---
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
  loadMetadata,
  createFormRow,
  createChipInputRow,
  renderMetadataDisplay,
  isTitleSameAsSeries
};

state.loadMetadata = loadMetadata;
state.createFormRow = createFormRow;
state.createChipInputRow = createChipInputRow;
state.renderMetadataDisplay = renderMetadataDisplay;
state.isTitleSameAsSeries = isTitleSameAsSeries;

if (typeof window !== 'undefined') {
  window.loadMetadata = loadMetadata;
  window.createFormRow = createFormRow;
  window.createChipInputRow = createChipInputRow;
  window.renderMetadataDisplay = renderMetadataDisplay;
  window.isTitleSameAsSeries = isTitleSameAsSeries;
}

