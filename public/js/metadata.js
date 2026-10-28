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
    renderMetadataDisplay(global.currentMetadata, true, { preserveTitle: true }); // true = clear and render fresh, preserving manual titles
  } catch (error) {
    global.metadataForm.innerHTML = `<p class="text-red-400 text-center">${global.escapeHtml(error.message)}</p>`;
  }
}

// Helper to safely escape CSS selectors across browser and test environments
function escapeSelector(val) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(val);
  }
  return String(val).replace(/["\\]/g, '\\$&');
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

function cleanFormatAndEdition(text) {
  if (!text) return '';
  let s = String(text);

  // 1. Bracketed format/edition tags: (TPB), [HC], (Paperback), (digital), {HB}, etc.
  s = s.replace(/[\(\[\{]\s*(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital(?:\s+edition)?|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)(?:\s+edition)?\s*[\)\]\}]/gi, ' ');

  // 2. Delimited format tokens: " - TPB", " TPB", " HC", " - Hardcover", ": A Graphic Novel", etc.
  s = s.replace(/(?:^|[\s,:;/|\-\u2010-\u2015]+)(?:(?:the|a|an)\s+)?(?:trade\s+paperback|digital|paperback(?:\s*\/\s*softback)?|hardcover|hardback(?:\s*\/\s*hardcover)?|softcover|graphic\s+novel|tpb|tp|hb|hc|sc|gn)(?:\s+edition)?(?=$|[\s,:;/|\-\u2010-\u2015]+$|[\s,:;/|\-\u2010-\u2015]*[\(\[\{]|[\s,:;/|\-\u2010-\u2015]+(?:v(?:ol)?\.?\s*\d+|#\d+|\bpart\b|\bbook\b|\bvolume\b)|[\s,:;/|\-\u2010-\u2015]+(?=[\-_/|:,;]))/gi, ' ');

  // 3. Trailing digital indicator: " - digital" or ", digital" at end of string or before brackets
  s = s.replace(/[\s,:;/|\-\u2010-\u2015]+digital(?=$|[\s,:;/|\-\u2010-\u2015]+$|[\s,:;/|\-\u2010-\u2015]*[\(\[\{])/gi, ' ');

  // 4. Remove empty brackets () [] {}
  s = s.replace(/[\(\[\{]\s*[\)\]\}]/g, ' ');

  // 5. Clean whitespace & trailing/leading/repeated delimiters
  s = s.replace(/\s*[:;\-–—|/,]+\s*[:;\-–—|/,]+/g, ' - ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[\s,:;/|\-\u2010-\u2015]+$/g, '').trim();
  s = s.replace(/^[\s,:;/|\-\u2010-\u2015]+/g, '').trim();
  return s;
}

const VOL_SPLIT_PATTERN = /^(?<series>.+?)[\s,:;\-–—]+\b(?<vol_token>(?<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?<vol_num>\d+)(?:(?<sub_sep>\s*[:\-–—,;]\s*|\s+)(?<subtitle>.+))?)$/i;
const STANDALONE_VOL_PATTERN = /^(?<vol_token>(?<vol_prefix>Vol(?:ume|\.)?|Book|Bk\.?|v)\s*0*(?<vol_num>\d+)(?:(?<sub_sep>\s*[:\-–—,;]\s*|\s+)(?<subtitle>.+))?)$/i;
const SERIES_ISSUE_PATTERN = /^(?<series>.+?)(?:[\s,:;\-–—]+|\s*)(?:(?:#|(?:issue|no\.?)\s*#?)\s*0*(?<issue_num>\d+)|[\s,:;\-–—]+0+(?<leading_zero_num>[1-9]\d*))$/i;

function splitVolumeSeriesAndTitle(series, title) {
  let s = (series || '').trim();
  let t = (title || '').trim();

  let m = s.match(VOL_SPLIT_PATTERN);
  if (!m && t) {
    m = t.match(VOL_SPLIT_PATTERN);
  }

  if (m && m.groups) {
    const extSeries = m.groups.series.replace(/[\s,:;\-–—]+$/, '').trim();
    const prefix = m.groups.vol_prefix;
    const num = String(parseInt(m.groups.vol_num, 10));
    const sub = (m.groups.subtitle || '').trim();
    let formattedTitle = m.groups.vol_token.trim();
    if (prefix.toLowerCase() === 'v') {
      formattedTitle = sub ? `Vol. ${num}: ${sub}` : `Volume ${num}`;
    }
    return {
      series: extSeries,
      title: formattedTitle,
      number: num,
      volume: num
    };
  }

  const standMatch = t.match(STANDALONE_VOL_PATTERN);
  if (standMatch && standMatch.groups) {
    const prefix = standMatch.groups.vol_prefix;
    const num = String(parseInt(standMatch.groups.vol_num, 10));
    const sub = (standMatch.groups.subtitle || '').trim();
    let formattedTitle = standMatch.groups.vol_token.trim();
    if (prefix.toLowerCase() === 'v') {
      formattedTitle = sub ? `Vol. ${num}: ${sub}` : `Volume ${num}`;
    }
    return {
      series: s,
      title: formattedTitle,
      number: num,
      volume: num
    };
  }

  // Check if series ends with an issue number (e.g. "Batman #1", "Batman #01", "Batman 01", "Batman Issue 1")
  const issueMatch = s.match(SERIES_ISSUE_PATTERN);
  if (issueMatch && issueMatch.groups) {
    const extSeries = issueMatch.groups.series.replace(/[\s,:;\-–—]+$/, '').trim();
    const num = String(parseInt(issueMatch.groups.issue_num || issueMatch.groups.leading_zero_num, 10));
    return {
      series: extSeries,
      title: t,
      number: num,
      volume: null
    };
  }

  return { series: s, title: t, number: null, volume: null };
}

/**
 * Sanitizes metadata fields (Series, Title, Number, Volume) according to standard rules:
 * 1. Strips format/edition tags (TPB, HC, Softcover, Hardcover, Graphic Novel, etc.) from Series and Title.
 * 2. Strips volume/issue numbers from Series (e.g. "#1", "01", "Vol. 1") and extracts number/volume.
 * 3. Clears Title if it is redundant with Series, just Series + issue number, or a generic issue label.
 */
function cleanGenreAndTags(val) {
  if (!val) return '';
  const items = String(val).split(',').map(s => s.trim()).filter(Boolean);
  const filtered = items.filter(s => {
    const lower = s.toLowerCase();
    return lower !== 'comic' && lower !== 'comics';
  });
  return filtered.join(', ');
}

/**
 * Sanitizes metadata fields according to library and cataloging rules:
 * 1. Strips format and edition tags (e.g. TPB, HC, Softcover) from Series and Title
 * 2. Splits volume and subtitle from Series if present
 * 3. Clears Title if identical to Series or redundant issue number
 * 4. Strips redundant "Comic" / "Comics" tags from Genre and Tags
 *
 * @param {Object} metadata
 * @returns {Object} Sanitized metadata (modified in-place and returned)
 */
function sanitizeMetadata(metadata, options = {}) {
  if (!metadata || typeof metadata !== 'object') return metadata;

  // 1. Strip format/edition words like TPB, HC, Hardcover, Softcover, Graphic Novel, etc. from Series and Title
  if (metadata.Series) {
    metadata.Series = cleanFormatAndEdition(metadata.Series);
  }
  if (metadata.Title) {
    metadata.Title = cleanFormatAndEdition(metadata.Title);
  }

  // 2. Strip volume/issue numbers from Series (e.g. if Series has "#1" or "01" or "Vol. 1", extract number to Number/Volume and clean Series)
  const volSplit = splitVolumeSeriesAndTitle(metadata.Series, metadata.Title);
  if (volSplit.series && (volSplit.number || volSplit.series !== metadata.Series)) {
    metadata.Series = volSplit.series;
    if (volSplit.title !== undefined) {
      metadata.Title = volSplit.title;
    }
    if (!metadata.Number || metadata.Number === '1' || metadata.Number === '01') {
      if (volSplit.number) metadata.Number = volSplit.number;
    }
    if (!metadata.Volume && volSplit.volume) {
      metadata.Volume = volSplit.volume;
    }
  }
  if (!metadata.Number && metadata.Volume) {
    metadata.Number = metadata.Volume;
  }

  // If Number is still empty, check if Title has an issue number before clearing Title
  if (!metadata.Number && metadata.Title) {
    const issueMatch = metadata.Title.match(/^(?:.*[\s,:;\-–—]+)?(?:#|(?:issue|no\.?)\s*#?)\s*0*(\d+)/i) ||
                       metadata.Title.match(/^(?:.*[\s,:;\-–—]+)?0*(\d+)$/);
    if (issueMatch) {
      metadata.Number = String(parseInt(issueMatch[1], 10));
    }
  }

  // 3. Check isTitleSameAsSeries(Title, Series): if Title is the same as Series (or if Title is just Series + Issue Number, or if Title is empty/generic issue number like "#1" or "Issue 1"), clear Title (Title = '')
  // Exception: Never strip Title if preserveTitle is enabled (e.g. manual user edit or form display)
  if (!options.preserveTitle && metadata.Title && (isTitleSameAsSeries(metadata.Title, metadata.Series) || (!metadata.Series && isTitleSameAsSeries(metadata.Title, '')))) {
    metadata.Title = '';
  }

  // 4. Strip redundant "Comic" and "Comics" from Genre and Tags
  if (metadata.Genre) {
    metadata.Genre = cleanGenreAndTags(metadata.Genre);
  }
  if (metadata.Tags) {
    metadata.Tags = cleanGenreAndTags(metadata.Tags);
  }
  if (metadata.genre) {
    metadata.genre = cleanGenreAndTags(metadata.genre);
  }
  if (metadata.tags) {
    metadata.tags = cleanGenreAndTags(metadata.tags);
  }
  if (Array.isArray(metadata.genres)) {
    metadata.genres = metadata.genres.filter(s => {
      const lower = String(s || '').trim().toLowerCase();
      return lower && lower !== 'comic' && lower !== 'comics';
    });
  }

  // 5. Canonicalize alias/lowercase keys and delete duplicate fields
  const KEY_ALIAS_TO_CANONICAL = {
    title: 'Title',
    issue_title: 'Title',
    series: 'Series',
    number: 'Number',
    issue: 'Number',
    issue_number: 'Number',
    volume: 'Volume',
    summary: 'Summary',
    description: 'Summary',
    writer: 'Writer',
    penciller: 'Penciller',
    inker: 'Inker',
    colorist: 'Colorist',
    letterer: 'Letterer',
    cover_artist: 'CoverArtist',
    coverartist: 'CoverArtist',
    editor: 'Editor',
    publisher: 'Publisher',
    imprint: 'Imprint',
    genre: 'Genre',
    tags: 'Tags',
    web: 'Web',
    source_url: 'Web',
    page_count: 'PageCount',
    pagecount: 'PageCount',
    characters: 'Characters',
    teams: 'Teams',
    locations: 'Locations',
    story_arc: 'StoryArc',
    storyarc: 'StoryArc',
    story_arc_number: 'StoryArcNumber',
    storyarcnumber: 'StoryArcNumber',
    age_rating: 'AgeRating',
    agerating: 'AgeRating',
    year: 'Year',
    month: 'Month',
    day: 'Day',
    cover_date: 'CoverDate',
    coverdate: 'CoverDate',
    'cover date': 'CoverDate',
    publish_date: 'CoverDate',
    store_date: 'StoreDate',
    storedate: 'StoreDate',
    'store date': 'StoreDate',
    notes: 'Notes',
    isbn: 'ISBN',
    format: 'Format'
  };

  for (const [aliasKey, canonicalKey] of Object.entries(KEY_ALIAS_TO_CANONICAL)) {
    if (Object.prototype.hasOwnProperty.call(metadata, aliasKey)) {
      if (metadata[canonicalKey] === undefined || metadata[canonicalKey] === '' || metadata[canonicalKey] === null) {
        if (metadata[aliasKey] !== undefined && metadata[aliasKey] !== '' && metadata[aliasKey] !== null) {
          metadata[canonicalKey] = metadata[aliasKey];
        }
      }
      delete metadata[aliasKey];
    }
  }

  return metadata;
}

function isTitleSameAsSeries(title, series) {
  if (!title) return false;
  const tRaw = cleanFormatAndEdition(String(title)).trim();
  if (!tRaw) return true;

  if (/^(?:(?:#|(?:issue|no\.?|vol(?:ume)?\.?|pt\.?|part|book|bk\.?)\s*#?)\s*\d*|\d+)\s*$/i.test(tRaw)) {
    return true;
  }

  if (!series) return false;
  const sRaw = cleanFormatAndEdition(String(series)).trim();
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

function createUrlTaggerBox() {
  const container = document.createElement('div');
  container.id = 'tag-from-url-container';
  container.className = 'bg-gray-800/80 border border-blue-500/30 rounded-lg p-3 mb-4';

  container.innerHTML = `
    <div class="flex items-center justify-between mb-1.5">
      <label class="text-xs font-semibold text-blue-400 flex items-center gap-1.5" for="tag-url-input">
        <span>🌐</span> Tag from Web URL (r.jina + Gemini)
      </label>
      <span class="text-[11px] text-gray-400">League of Comic Geeks, Fandom Wiki, or store link</span>
    </div>
    <div class="flex gap-2">
      <input type="url" id="tag-url-input" placeholder="https://..." class="bg-gray-700 text-xs text-white p-2 rounded-md flex-1 border border-gray-600 focus:outline-hidden focus:ring-1 focus:ring-blue-500" />
      <button type="button" id="tag-url-btn" class="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors cursor-pointer">
        <span>⚡</span> Extract & Apply
      </button>
    </div>
    <div id="tag-url-status" class="text-[11px] mt-1 text-gray-300 hidden"></div>
  `;

  const btn = container.querySelector('#tag-url-btn');
  const input = container.querySelector('#tag-url-input');
  const status = container.querySelector('#tag-url-status');

  btn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url || !url.startsWith('http')) {
      status.className = 'text-[11px] mt-1 text-red-400 block';
      status.textContent = 'Please enter a valid web URL starting with http:// or https://';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Extracting...`;
    status.className = 'text-[11px] mt-1 text-blue-300 block';
    status.textContent = 'Fetching clean markdown via r.jina.ai & synthesizing ComicInfo with Gemini...';

    try {
      const apiBase = global.API_BASE_URL || '';
      const comicName = global.currentComic ? global.currentComic.name : '';
      const res = await fetch(`${apiBase}/api/v1/metadata/extract-from-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          filename: comicName,
          existingMeta: global.currentMetadata || {}
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to extract metadata');
      }

      if (data.metadata) {
        // Merge extracted metadata into currentMetadata
        global.currentMetadata = { ...(global.currentMetadata || {}), ...data.metadata };
        if (state) state.metadataHasUnsavedChanges = true;
        renderMetadataDisplay(global.currentMetadata, true);
        if (data.dailyUsed !== undefined) {
          const dailyUsedDiv = document.getElementById('ct-gemini-daily-used');
          if (dailyUsedDiv) {
            dailyUsedDiv.textContent = `${data.dailyUsed} requests used`;
          }
        }

        const newStatus = global.metadataForm.querySelector('#tag-url-status');
        if (newStatus) {
          newStatus.className = 'text-[11px] mt-1 text-green-400 block';
          const quotaNotice = data.dailyUsed !== undefined ? ` (Gemini requests used today: ${data.dailyUsed})` : '';
          newStatus.textContent = `✅ Metadata extracted successfully!${quotaNotice} Click "Save Changes" below to commit to comic file.`;
        }
      }
    } catch (err) {
      status.className = 'text-[11px] mt-1 text-red-400 block';
      status.textContent = `❌ ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span>⚡</span> Extract & Apply`;
    }
  });

  return container;
}

function renderMetadataDisplay(metadata, clearForm = true, options = {}) {
  const isCurrentComicMeta = (global.currentMetadata && metadata === global.currentMetadata) || Boolean(options && options.preserveTitle);
  const opts = { ...options, preserveTitle: Boolean(isCurrentComicMeta) };
  if (metadata && typeof metadata === 'object') {
    sanitizeMetadata(metadata, opts);
  }
  if (global.currentMetadata && typeof global.currentMetadata === 'object' && global.currentMetadata !== metadata) {
    sanitizeMetadata(global.currentMetadata, { ...options, preserveTitle: true });
  }

  if (clearForm) {
    global.metadataForm.innerHTML = '';
    const statusDiv = document.createElement('div');
    statusDiv.id = 'save-status';
    statusDiv.className = 'text-sm text-gray-300';
    global.metadataForm.appendChild(statusDiv);
  }

  // Check if user is admin
  const isAdmin = global.syncManager && global.syncManager.userRole === 'admin';

  if (clearForm && isAdmin) {
    global.metadataForm.appendChild(createUrlTaggerBox());
  }

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

  // Exclude internal non-field properties from rendering in the edit form
  const nonFieldKeys = new Set([
    'cover_image_url', 'coverUrl', 'matching_url', 'type', 'id', 'source', 'fullMetadata', 'genres'
  ]);
  for (const k of nonFieldKeys) {
    delete merged[k];
  }

  // Which keys should be chip inputs
  const chipFields = new Set(['Characters', 'Teams', 'Locations', 'StoryArc', 'Genre']);

  // Render each key
  for (const [key, val] of Object.entries(merged)) {
    // For non-admins: skip empty fields
    if (!isAdmin && (!val || val === '')) continue;
    // If an element already exists (e.g., re-render), update it
    const existing = global.metadataForm.querySelector(`[name="${escapeSelector(key)}"]`);
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
      if (global.metadataForm.querySelector(`[name="${escapeSelector(key)}"]`)) return;
      if (chipFields.has(key)) {
        global.metadataForm.insertBefore(createChipInputRow(key, ''), submitButton);
      } else {
        const type = key === 'Summary' ? 'textarea' : 'text';
        global.metadataForm.insertBefore(createFormRow(key, ''), submitButton);
      }
      // Focus the new input
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
  isTitleSameAsSeries,
  cleanFormatAndEdition,
  splitVolumeSeriesAndTitle,
  sanitizeMetadata,
  cleanGenreAndTags
};

state.loadMetadata = loadMetadata;
state.createFormRow = createFormRow;
state.createChipInputRow = createChipInputRow;
state.renderMetadataDisplay = renderMetadataDisplay;
state.isTitleSameAsSeries = isTitleSameAsSeries;
state.cleanFormatAndEdition = cleanFormatAndEdition;
state.splitVolumeSeriesAndTitle = splitVolumeSeriesAndTitle;
state.sanitizeMetadata = sanitizeMetadata;
state.cleanGenreAndTags = cleanGenreAndTags;

if (typeof window !== 'undefined') {
  window.loadMetadata = loadMetadata;
  window.createFormRow = createFormRow;
  window.createChipInputRow = createChipInputRow;
  window.renderMetadataDisplay = renderMetadataDisplay;
  window.isTitleSameAsSeries = isTitleSameAsSeries;
  window.cleanFormatAndEdition = cleanFormatAndEdition;
  window.splitVolumeSeriesAndTitle = splitVolumeSeriesAndTitle;
  window.sanitizeMetadata = sanitizeMetadata;
  window.cleanGenreAndTags = cleanGenreAndTags;
}

