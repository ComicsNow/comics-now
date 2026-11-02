function escapeSelector(val) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(val);
  }
  return String(val).replace(/["\\]/g, '\\$&');
}

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
    const textSpan = document.createElement('span');
    textSpan.textContent = t;
    chip.appendChild(textSpan);
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
      const last = box.querySelector('span.rounded-full:last-of-type');
      if (last) last.querySelector('button')?.click();
    }
  });
  input.addEventListener('blur', () => commitInput());

  return wrap;
}

export {
  escapeSelector,
  createFormRow,
  createChipInputRow
};
