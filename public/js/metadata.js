// --- METADATA ---

async function loadMetadata() {
  try {
    if (!window.currentComic) {
      throw new Error('No comic loaded');
    }
    if (!window.currentMetadata) {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(encodePath(window.currentComic.path))}`
      );
      if (!response.ok) throw new Error('Metadata not found.');
      window.currentMetadata = await response.json();
    }
    renderMetadataDisplay(window.currentMetadata, true); // true = clear and render fresh
  } catch (error) {
    window.metadataForm.innerHTML = `<p class="text-red-400 text-center">${error.message}</p>`;
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
  input.className = 'bg-gray-700 text-white p-2 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-purple-500';
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
  input.className = 'bg-transparent outline-none flex-1 min-w-[120px]';
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
    chip.innerHTML = `<span>${t}</span>`;
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

// Back-compat stub (we no longer render read-only rows)
function createDisplayField() {
  return document.createElement('div');
}

/** Render the entire metadata form — editable if admin, read-only otherwise */
function renderMetadataDisplay(metadata, clearForm = true) {
  if (clearForm) window.metadataForm.innerHTML = '';

  // Check if user is admin
  const isAdmin = window.syncManager && window.syncManager.userRole === 'admin';

  // For admins: show all default fields
  // For non-admins: only show fields that have values
  const defaults = {
    Title: '', Series: '', Number: '', Summary: '',
    Writer: '', Penciller: '', Inker: '', Colorist: '', Letterer: '', Editor: '',
    Publisher: '', Imprint: '', AgeRating: '',
    Characters: '', Teams: '', Locations: '',
    Genre: '', Web: '', ISBN: '',
    // Optional extras you might like:
    'Cover Date': '', 'Store Date': '', 'PageCount': '', 'Format': ''
  };

  const merged = isAdmin ? { ...defaults, ...(metadata || {}) } : (metadata || {});

  // Which keys should be chip inputs
  const chipFields = new Set(['Characters', 'Teams', 'Locations', 'Genre']);

  // Render each key
  for (const [key, val] of Object.entries(merged)) {
    // For non-admins: skip empty fields
    if (!isAdmin && (!val || val === '')) continue;
    // If an element already exists (e.g., re-render), update it
    const existing = window.metadataForm.querySelector(`[name="${CSS.escape(key)}"]`);
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
        window.metadataForm.appendChild(createChipInputRow(key, String(val || '')));
      } else {
        const type = key === 'Summary' ? 'textarea' : 'text';
        window.metadataForm.appendChild(createFormRow(key, val ?? '', type));
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
      window.metadataForm.appendChild(div);
    }
  }

  // --- Add "Add custom field" controls (only for admins, only once) ---
  if (isAdmin && !window.metadataForm.querySelector('#add-custom-field')) {
    const controls = document.createElement('div');
    controls.className = 'flex flex-wrap items-center gap-2 mt-2';

    // Quick picker for common fields you may add often
    const commonSelect = document.createElement('select');
    commonSelect.className = 'bg-gray-700 text-white p-2 rounded-lg';
    commonSelect.innerHTML = `
      <option value="">Add common field…</option>
      <option>Inker</option>
      <option>Colorist</option>
      <option>Letterer</option>
      <option>Editor</option>
      <option>Imprint</option>
      <option>AgeRating</option>
      <option>Genre</option>
      <option>Web</option>
      <option>ISBN</option>
      <option>PageCount</option>
      <option>Format</option>
    `;
    commonSelect.addEventListener('change', () => {
      const key = commonSelect.value;
      if (!key) return;
      if (window.metadataForm.querySelector(`[name="${CSS.escape(key)}"]`)) {
        alert('That field already exists.');
      } else {
        if (['Genre'].includes(key)) {
          window.metadataForm.insertBefore(createChipInputRow(key, ''), submitButton);
        } else {
          window.metadataForm.insertBefore(createFormRow(key, ''), submitButton);
        }
      }
      commonSelect.value = '';
    });

    const addBtn = document.createElement('button');
    addBtn.id = 'add-custom-field';
    addBtn.type = 'button';
    addBtn.className = 'bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg';
    addBtn.textContent = 'Add custom field';
    addBtn.addEventListener('click', () => {
      const key = prompt('Enter new field name (e.g., Translator, CoverArtist, Arc, Imprint):');
      if (!key) return;
      if (window.metadataForm.querySelector(`[name="${CSS.escape(key)}"]`)) {
        return alert('That field already exists.');
      }
      // Default to text input; user can still store comma-separated values if desired
      window.metadataForm.insertBefore(createFormRow(key, ''), submitButton);
    });

    controls.appendChild(commonSelect);
    controls.appendChild(addBtn);
    window.metadataForm.appendChild(controls);
  }

  // --- Submit button (only for admins, only once) ---
  if (isAdmin) {
    let submitButton = window.metadataForm.querySelector('button[type="submit"]');
    if (!submitButton) {
      submitButton = document.createElement('button');
      submitButton.type = 'submit';
      submitButton.className = 'w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-full transition-colors mt-4';
      submitButton.textContent = 'Save Changes';
      window.metadataForm.appendChild(submitButton);
    }
  }
}
