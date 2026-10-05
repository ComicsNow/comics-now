import { state } from '../globals.js';

let renameEventSource = null;
let moveEventSource = null;

// Setup rename output streaming
export function startRenameStream() {
  if (renameEventSource) return;
  if (typeof EventSource === 'undefined') return; // no SSE (e.g. test env)

  const renameOutputDiv = document.getElementById('rename-output');
  if (renameOutputDiv) {
    renameOutputDiv.classList.remove('hidden');
  }
  const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
  renameEventSource = new EventSource(`${apiBaseUrl}/api/v1/rename/stream`);

  renameEventSource.onmessage = (event) => {
    const entry = JSON.parse(event.data);
    const line = document.createElement('div');
    line.textContent = entry.message;
    if (renameOutputDiv) {
      renameOutputDiv.appendChild(line);
      renameOutputDiv.scrollTop = renameOutputDiv.scrollHeight;
    }
  };

  renameEventSource.onerror = () => {
    
  };
}

export function stopRenameStream() {
  if (renameEventSource) {
    renameEventSource.close();
    renameEventSource = null;
  }
}

// Setup move output streaming
export function startMoveStream() {
  if (moveEventSource) return;
  if (typeof EventSource === 'undefined') return; // no SSE (e.g. test env)

  const moveOutputDiv = document.getElementById('move-output');
  if (moveOutputDiv) {
    moveOutputDiv.classList.remove('hidden');
  }
  const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
  moveEventSource = new EventSource(`${apiBaseUrl}/api/v1/move/stream`);

  moveEventSource.onmessage = (event) => {
    const entry = JSON.parse(event.data);
    const line = document.createElement('div');
    line.textContent = entry.message;
    if (moveOutputDiv) {
      moveOutputDiv.appendChild(line);
      moveOutputDiv.scrollTop = moveOutputDiv.scrollHeight;
    }
  };

  moveEventSource.onerror = () => {
    
  };
}

export function stopMoveStream() {
  if (moveEventSource) {
    moveEventSource.close();
    moveEventSource = null;
  }
}

// --- COMICS MANAGEMENT ---
document.addEventListener('DOMContentLoaded', () => {
  const renameCbzBtn = document.getElementById('rename-cbz-btn');
  const renameStatusDiv = document.getElementById('rename-status');
  const renameOutputDiv = document.getElementById('rename-output');
  const renameClearBtn = document.getElementById('rename-clear-output');
  const moveComicsBtn = document.getElementById('move-comics-btn');
  const moveStatusDiv = document.getElementById('move-status');
  const moveOutputDiv = document.getElementById('move-output');
  const moveClearBtn = document.getElementById('move-clear-output');

  const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';

  // Clear rename output
  if (renameClearBtn) {
    renameClearBtn.addEventListener('click', async () => {
      renameOutputDiv.innerHTML = '';
      renameOutputDiv.classList.add('hidden');
      try {
        await fetch(`${apiBaseUrl}/api/v1/rename/clear`, { method: 'POST' });
      } catch (error) {
        
      }
    });
  }

  // Clear move output
  if (moveClearBtn) {
    moveClearBtn.addEventListener('click', async () => {
      moveOutputDiv.innerHTML = '';
      moveOutputDiv.classList.add('hidden');
      try {
        await fetch(`${apiBaseUrl}/api/v1/move/clear`, { method: 'POST' });
      } catch (error) {
        
      }
    });
  }

  // --- COMICS MANAGEMENT (OPERATIONS / ERRORS / NAME / FOLDER TABS) ---
  const mgmtTabOperations = document.getElementById('mgmt-tab-operations');
  const mgmtTabErrors = document.getElementById('mgmt-tab-errors');
  const mgmtTabName = document.getElementById('mgmt-tab-name');
  const mgmtTabFolder = document.getElementById('mgmt-tab-folder');
  const mgmtContentOperations = document.getElementById('mgmt-content-operations');
  const mgmtContentErrors = document.getElementById('mgmt-content-errors');
  const mgmtContentName = document.getElementById('mgmt-content-name');
  const mgmtContentFolder = document.getElementById('mgmt-content-folder');
  const errorsList = document.getElementById('errors-list');
  const errorsRefreshBtn = document.getElementById('errors-refresh-btn');

  async function loadOperationErrors() {
    if (!errorsList) return;
    errorsList.innerHTML = '<p class="text-sm text-gray-500 animate-pulse">Loading errors...</p>';
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/operation-errors`);
      const data = await res.json();
      if (!data.ok || data.errors.length === 0) {
        errorsList.innerHTML = '<p class="text-sm text-gray-500">No errors recorded this session.</p>';
        return;
      }
      errorsList.innerHTML = data.errors.map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const badge = e.source === 'rename'
          ? '<span class="text-blue-400 text-xs font-bold uppercase">rename</span>'
          : '<span class="text-green-400 text-xs font-bold uppercase">move</span>';
        return `<div class="bg-gray-900 rounded-lg p-3 border border-red-900/40">
          <div class="flex items-center gap-2 mb-1">${badge}<span class="text-gray-500 text-xs">${time}</span></div>
          <p class="text-red-400 text-xs font-mono break-all">${e.message}</p>
        </div>`;
      }).join('');
    } catch {
      errorsList.innerHTML = '<p class="text-sm text-red-400">Failed to load errors.</p>';
    }
  }

  if (errorsRefreshBtn) {
    errorsRefreshBtn.addEventListener('click', loadOperationErrors);
  }

  // Populate the Name/Folder whole-library batch dropdowns.
  async function populateLibrarySelects() {
    const selects = [
      document.getElementById('rename-library-select'),
      document.getElementById('move-library-select')
    ].filter(Boolean);
    if (selects.length === 0) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/comics-directories`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.directories)) return;
      // Exclude the inbox/scan folder (comicsLocation) — it's not a library.
      const libraries = data.directories.filter(dir => !dir.isInbox);
      selects.forEach(sel => {
        const current = sel.value;
        sel.innerHTML = '';
        if (libraries.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'No libraries configured';
          opt.disabled = true;
          sel.appendChild(opt);
          return;
        }
        libraries.forEach(dir => {
          const opt = document.createElement('option');
          opt.value = dir.fullPath;
          // Show the full path so it's unambiguous which folder is targeted
          // (the basename alone, e.g. "Downloads", is easy to confuse).
          opt.textContent = dir.name ? `${dir.name} — ${dir.fullPath}` : dir.fullPath;
          opt.title = dir.fullPath;
          sel.appendChild(opt);
        });
        if (current) sel.value = current;
      });
    } catch (_) {}
  }
  populateLibrarySelects();

  // Confirmation Modal Elements
  const confirmModal = document.getElementById('mgmt-confirm-modal');
  const confirmTitle = document.getElementById('mgmt-confirm-title');
  const confirmWarning = document.getElementById('mgmt-confirm-warning');
  const confirmInput = document.getElementById('mgmt-confirm-input');
  const confirmProceedBtn = document.getElementById('mgmt-confirm-proceed-btn');
  const confirmCancelBtn = document.getElementById('mgmt-confirm-cancel-btn');

  let activeConfirmCallback = null;

  function promptSafetyConfirmation(title, warning, callback) {
    if (!confirmModal) {
      if (confirm(`${title}\n\n${warning}\n\nType "i want to do this" to continue:`)) {
        callback('i want to do this');
      }
      return;
    }
    if (confirmTitle) confirmTitle.textContent = title;
    if (confirmWarning) confirmWarning.textContent = warning;
    if (confirmInput) {
      confirmInput.value = '';
    }
    if (confirmProceedBtn) {
      confirmProceedBtn.disabled = true;
    }
    activeConfirmCallback = callback;
    confirmModal.classList.remove('hidden');
    if (confirmInput) confirmInput.focus();
  }

  if (confirmInput && confirmProceedBtn) {
    confirmInput.addEventListener('input', () => {
      confirmProceedBtn.disabled = (confirmInput.value.trim() !== 'i want to do this');
    });
    confirmInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !confirmProceedBtn.disabled) {
        confirmProceedBtn.click();
      }
    });
  }

  if (confirmCancelBtn && confirmModal) {
    confirmCancelBtn.addEventListener('click', () => {
      confirmModal.classList.add('hidden');
      activeConfirmCallback = null;
    });
  }

  if (confirmProceedBtn && confirmModal) {
    confirmProceedBtn.addEventListener('click', () => {
      if (confirmInput.value.trim() === 'i want to do this') {
        const cb = activeConfirmCallback;
        confirmModal.classList.add('hidden');
        activeConfirmCallback = null;
        if (typeof cb === 'function') {
          cb('i want to do this');
        }
      }
    });
  }

  // Sub-tab Navigation (Operations / Errors / Name / Folder)
  const mgmtTabs = [
    { tab: mgmtTabOperations, panel: mgmtContentOperations, onShow: null },
    { tab: mgmtTabErrors, panel: mgmtContentErrors, onShow: loadOperationErrors },
    { tab: mgmtTabName, panel: mgmtContentName, onShow: populateLibrarySelects },
    { tab: mgmtTabFolder, panel: mgmtContentFolder, onShow: populateLibrarySelects }
  ].filter(entry => entry.tab && entry.panel);

  mgmtTabs.forEach(({ tab, panel, onShow }) => {
    tab.addEventListener('click', () => {
      mgmtTabs.forEach(other => {
        const isActive = other.tab === tab;
        other.tab.classList.toggle('active', isActive);
        other.panel.classList.toggle('hidden', !isActive);
      });
      if (typeof onShow === 'function') onShow();
    });
  });

  // Sample metadata for live previews
  const SAMPLE_METADATA = {
    Series: 'Animal Castle',
    Title: 'Winter of the Animals',
    Publisher: 'Ablaze',
    Year: '2022',
    Number: '2',
    PageCount: 32,
    Writer: 'Xavier Dorison',
    Volume: '1'
  };

  const TOKEN_LABELS = {
    number: 'Issue Number (#)',
    series: 'Series Title',
    title: 'Story/Issue Title',
    publisher: 'Publisher [ ]',
    year: 'Publication Year ( )',
    pages: 'Page Count #',
    writer: 'Writer { }',
    volume: 'Volume'
  };

  // --- NAME RULES STATE & MANAGEMENT ---
  let namingRules = {
    tokens: [
      { id: 'number', enabled: true, mandatory: false },
      { id: 'series', enabled: true, mandatory: true },
      { id: 'title', enabled: true, mandatory: false },
      { id: 'publisher', enabled: true, mandatory: true },
      { id: 'year', enabled: true, mandatory: true },
      { id: 'pages', enabled: true, mandatory: false },
      { id: 'writer', enabled: false, mandatory: false },
      { id: 'volume', enabled: false, mandatory: false }
    ]
  };

  const namingTokensList = document.getElementById('naming-tokens-list');
  const namingLivePreview = document.getElementById('naming-live-preview');
  const saveNamingRulesBtn = document.getElementById('save-naming-rules-btn');

  async function loadNamingRules() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/naming-rules`);
      const data = await res.json();
      if (data.ok && data.rules && Array.isArray(data.rules.tokens)) {
        namingRules = data.rules;
      }
    } catch (_) {}
    renderNamingTokens();
    updateNamingPreview();
  }

  function renderNamingTokens() {
    if (!namingTokensList) return;
    namingTokensList.innerHTML = '';

    namingRules.tokens.forEach((token, index) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2 rounded bg-gray-800 border border-gray-700 text-xs';

      const labelText = TOKEN_LABELS[token.id] || token.id;

      row.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-5 text-gray-500 font-mono text-[11px]">${index + 1}.</span>
          <span class="font-medium text-white">${labelText}</span>
        </div>
        <div class="flex items-center gap-3">
          <label class="inline-flex items-center gap-1 cursor-pointer select-none text-gray-300">
            <input type="checkbox" class="token-enable-cb rounded bg-gray-700 text-blue-500 w-3.5 h-3.5" ${token.enabled ? 'checked' : ''}>
            <span>Include</span>
          </label>
          <label class="inline-flex items-center gap-1 cursor-pointer select-none text-gray-300">
            <input type="checkbox" class="token-mand-cb rounded bg-gray-700 text-amber-500 w-3.5 h-3.5" ${token.mandatory ? 'checked' : ''}>
            <span>Mandatory</span>
          </label>
          <div class="flex gap-1">
            <button class="token-up-btn px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-200 ${index === 0 ? 'opacity-30 cursor-not-allowed' : ''}">▲</button>
            <button class="token-down-btn px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-200 ${index === namingRules.tokens.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}">▼</button>
          </div>
        </div>
      `;

      // Event listeners
      const enableCb = row.querySelector('.token-enable-cb');
      const mandCb = row.querySelector('.token-mand-cb');
      const upBtn = row.querySelector('.token-up-btn');
      const downBtn = row.querySelector('.token-down-btn');

      enableCb.addEventListener('change', () => {
        token.enabled = enableCb.checked;
        updateNamingPreview();
      });

      mandCb.addEventListener('change', () => {
        token.mandatory = mandCb.checked;
        if (token.mandatory && !token.enabled) {
          token.enabled = true;
          enableCb.checked = true;
        }
        updateNamingPreview();
      });

      if (index > 0) {
        upBtn.addEventListener('click', () => {
          const temp = namingRules.tokens[index - 1];
          namingRules.tokens[index - 1] = token;
          namingRules.tokens[index] = temp;
          renderNamingTokens();
          updateNamingPreview();
        });
      }

      if (index < namingRules.tokens.length - 1) {
        downBtn.addEventListener('click', () => {
          const temp = namingRules.tokens[index + 1];
          namingRules.tokens[index + 1] = token;
          namingRules.tokens[index] = temp;
          renderNamingTokens();
          updateNamingPreview();
        });
      }

      namingTokensList.appendChild(row);
    });
  }

  async function updateNamingPreview() {
    if (!namingLivePreview) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/naming-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: SAMPLE_METADATA, rules: namingRules })
      });
      const data = await res.json();
      if (data.ok && data.filename) {
        namingLivePreview.textContent = data.filename;
        namingLivePreview.className = 'font-mono text-sm text-green-400 break-all select-all';
      } else {
        namingLivePreview.textContent = data.error || 'Preview unavailable';
        namingLivePreview.className = 'font-mono text-sm text-amber-400 break-all select-all';
      }
    } catch (_) {
      namingLivePreview.textContent = 'Preview error';
    }
  }

  if (saveNamingRulesBtn) {
    saveNamingRulesBtn.addEventListener('click', async () => {
      saveNamingRulesBtn.disabled = true;
      saveNamingRulesBtn.textContent = 'Saving...';
      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/naming-rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: namingRules })
        });
        const data = await res.json();
        if (data.ok) {
          saveNamingRulesBtn.textContent = '✓ Saved!';
          saveNamingRulesBtn.classList.replace('bg-blue-600', 'bg-green-600');
        } else {
          alert('Failed to save naming rules: ' + (data.error || 'Unknown error'));
          saveNamingRulesBtn.textContent = 'Save Naming Rules';
        }
      } catch (err) {
        alert('Network error saving naming rules: ' + err.message);
        saveNamingRulesBtn.textContent = 'Save Naming Rules';
      } finally {
        setTimeout(() => {
          saveNamingRulesBtn.disabled = false;
          saveNamingRulesBtn.textContent = 'Save Naming Rules';
          saveNamingRulesBtn.classList.replace('bg-green-600', 'bg-blue-600');
        }, 2000);
      }
    });
  }

  // --- FOLDER RULES STATE & MANAGEMENT ---
  let folderRules = {
    hierarchy: ['publisher', 'series']
  };

  const folderLevelsList = document.getElementById('folder-levels-list');
  const folderLivePreview = document.getElementById('folder-live-preview');
  const addFolderLevelBtn = document.getElementById('add-folder-level-btn');
  const addFolderTokenSelect = document.getElementById('add-folder-token-select');
  const saveFolderRulesBtn = document.getElementById('save-folder-rules-btn');

  async function loadFolderRules() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/folder-rules`);
      const data = await res.json();
      if (data.ok && data.rules && Array.isArray(data.rules.hierarchy)) {
        folderRules = data.rules;
      }
    } catch (_) {}
    renderFolderLevels();
    updateFolderPreview();
  }

  function renderFolderLevels() {
    if (!folderLevelsList) return;
    folderLevelsList.innerHTML = '';

    if (folderRules.hierarchy.length === 0) {
      folderLevelsList.innerHTML = '<p class="text-xs text-amber-400 p-2">No hierarchy levels added. Comics will be placed directly in the destination folder.</p>';
      return;
    }

    folderRules.hierarchy.forEach((token, index) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2 rounded bg-gray-800 border border-gray-700 text-xs';

      const labelText = TOKEN_LABELS[token] || token;

      row.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-16 font-mono text-[11px] text-gray-400">Level ${index + 1}:</span>
          <span class="font-bold text-white uppercase text-[11px] bg-gray-700 px-2 py-0.5 rounded">${labelText}</span>
        </div>
        <div class="flex items-center gap-2">
          <button class="level-up-btn px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-200 ${index === 0 ? 'opacity-30 cursor-not-allowed' : ''}">▲</button>
          <button class="level-down-btn px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-200 ${index === folderRules.hierarchy.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}">▼</button>
          <button class="level-remove-btn px-2 py-0.5 bg-red-900/60 hover:bg-red-800 text-red-300 rounded">✕</button>
        </div>
      `;

      const upBtn = row.querySelector('.level-up-btn');
      const downBtn = row.querySelector('.level-down-btn');
      const removeBtn = row.querySelector('.level-remove-btn');

      if (index > 0) {
        upBtn.addEventListener('click', () => {
          const temp = folderRules.hierarchy[index - 1];
          folderRules.hierarchy[index - 1] = token;
          folderRules.hierarchy[index] = temp;
          renderFolderLevels();
          updateFolderPreview();
        });
      }

      if (index < folderRules.hierarchy.length - 1) {
        downBtn.addEventListener('click', () => {
          const temp = folderRules.hierarchy[index + 1];
          folderRules.hierarchy[index + 1] = token;
          folderRules.hierarchy[index] = temp;
          renderFolderLevels();
          updateFolderPreview();
        });
      }

      removeBtn.addEventListener('click', () => {
        folderRules.hierarchy.splice(index, 1);
        renderFolderLevels();
        updateFolderPreview();
      });

      folderLevelsList.appendChild(row);
    });
  }

  if (addFolderLevelBtn && addFolderTokenSelect) {
    addFolderLevelBtn.addEventListener('click', () => {
      const val = addFolderTokenSelect.value;
      if (val) {
        folderRules.hierarchy.push(val);
        renderFolderLevels();
        updateFolderPreview();
      }
    });
  }

  async function updateFolderPreview() {
    if (!folderLivePreview) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/folder-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: SAMPLE_METADATA, rules: folderRules })
      });
      const data = await res.json();
      if (data.ok && data.folderPath) {
        folderLivePreview.textContent = `${data.folderPath}/`;
      } else {
        folderLivePreview.textContent = data.error || 'Preview unavailable';
      }
    } catch (_) {
      folderLivePreview.textContent = 'Preview error';
    }
  }

  if (saveFolderRulesBtn) {
    saveFolderRulesBtn.addEventListener('click', async () => {
      saveFolderRulesBtn.disabled = true;
      saveFolderRulesBtn.textContent = 'Saving...';
      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/folder-rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: folderRules })
        });
        const data = await res.json();
        if (data.ok) {
          saveFolderRulesBtn.textContent = '✓ Saved!';
          saveFolderRulesBtn.classList.replace('bg-blue-600', 'bg-green-600');
        } else {
          alert('Failed to save folder rules: ' + (data.error || 'Unknown error'));
          saveFolderRulesBtn.textContent = 'Save Folder Rules';
        }
      } catch (err) {
        alert('Network error saving folder rules: ' + err.message);
        saveFolderRulesBtn.textContent = 'Save Folder Rules';
      } finally {
        setTimeout(() => {
          saveFolderRulesBtn.disabled = false;
          saveFolderRulesBtn.textContent = 'Save Folder Rules';
          saveFolderRulesBtn.classList.replace('bg-green-600', 'bg-blue-600');
        }, 2000);
      }
    });
  }

  // Initialize rules on page load
  loadNamingRules();
  loadFolderRules();

  // --- BATCH RENAME CBZ HANDLER ---
  // Shared rename runner. `body` decides scope:
  //   {}                         -> inbox (comicsLocation), no confirmation
  //   { libraryPath, confirmation } -> whole selected library
  async function runRename(body, btn) {
    if (!renameStatusDiv) return;
    renameOutputDiv.classList.remove('hidden');
    renameOutputDiv.innerHTML = '';
    startRenameStream();

    const origLabel = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Renaming...'; btn.disabled = true; }
    renameStatusDiv.textContent = 'Starting rename operation...';

    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/rename-cbz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Rename operation failed');

      let message = `✓ Processed: ${data.processed || 0} file${data.processed !== 1 ? 's' : ''}`;
      if (data.renamed > 0) message += ` | Renamed: ${data.renamed}`;
      if (data.errors > 0) message += ` | ⚠ Errors: ${data.errors}`;

      if (data.results && data.results.length > 0) {
        const failures = data.results.filter(r => !r.success);
        if (failures.length > 0) {
          message += '\n\nFailed files:';
          failures.slice(0, 5).forEach(f => { message += `\n• ${f.file}: ${f.error || 'Unknown error'}`; });
          if (failures.length > 5) message += `\n... and ${failures.length - 5} more error${failures.length - 5 !== 1 ? 's' : ''}`;
        }
      }

      renameStatusDiv.textContent = message;
      renameStatusDiv.style.whiteSpace = 'pre-wrap';
      renameStatusDiv.className = data.errors > 0 ? 'text-xs mt-2 text-yellow-400' : 'text-xs mt-2 text-green-400';
    } catch (error) {
      renameStatusDiv.textContent = `✗ Failed: ${error.message || 'Unknown error occurred'}`;
      renameStatusDiv.className = 'text-xs mt-2 text-red-400';
      renameStatusDiv.style.whiteSpace = 'pre-wrap';
    } finally {
      if (btn) setTimeout(() => { btn.textContent = origLabel; btn.disabled = false; }, 1000);
    }
  }

  // Operations tab: rename comics in the inbox (comicsLocation). No confirmation.
  if (renameCbzBtn && renameStatusDiv) {
    renameCbzBtn.addEventListener('click', () => runRename({}, renameCbzBtn));
  }

  // Name tab: rename an ENTIRE selected library (typed confirmation required).
  const renameLibraryBtn = document.getElementById('rename-library-btn');
  const renameLibrarySelect = document.getElementById('rename-library-select');
  if (renameLibraryBtn) {
    renameLibraryBtn.addEventListener('click', () => {
      const libraryPath = renameLibrarySelect ? renameLibrarySelect.value : '';
      if (!libraryPath) {
        if (renameStatusDiv) { renameStatusDiv.textContent = 'Select a library first.'; renameStatusDiv.className = 'text-xs mt-2 text-yellow-400'; }
        return;
      }
      promptSafetyConfirmation(
        'Rename Entire Library',
        'This will rename EVERY comic in the selected library using your saved naming rules. This action cannot be easily undone.',
        (confirmation) => {
          if (mgmtTabOperations) mgmtTabOperations.click(); // show streaming output
          runRename({ libraryPath, confirmation }, renameLibraryBtn);
        }
      );
    });
  }

  // --- BATCH MOVE COMICS HANDLER ---
  if (moveComicsBtn && moveStatusDiv) {
    // Operations tab: move freshly-tagged inbox comics into a library. No confirmation.
    moveComicsBtn.addEventListener('click', async () => {
      try {
        const dirRes = await fetch(`${apiBaseUrl}/api/v1/comics-directories`);
        const dirData = await dirRes.json();
        if (!dirRes.ok) throw new Error(dirData.message || 'Failed to get comics directories');
        // Destinations are real libraries only — never the inbox (comicsLocation).
        const destinations = (dirData.directories || []).filter(dir => !dir.isInbox);
        if (destinations.length === 0) {
          throw new Error('No destination libraries configured');
        }
        if (destinations.length === 1) {
          await performMove({ targetDirectory: destinations[0].fullPath }, moveComicsBtn);
        } else {
          showDirectorySelectionModal(destinations);
        }
      } catch (error) {
        moveStatusDiv.textContent = `Error: ${error.message}`;
        moveStatusDiv.className = 'text-xs mt-2 text-red-400';
      }
    });

    // Runs the move for either scope:
    //   { targetDirectory }        -> inbox → that library (Operations tab)
    //   { libraryPath, confirmation } -> reorganize whole library in place (Folder tab)
    async function performMove(body, btn) {
      moveOutputDiv.classList.remove('hidden');
      moveOutputDiv.innerHTML = '';
      startMoveStream();

      const origLabel = btn ? btn.textContent : '';
      if (btn) { btn.textContent = 'Moving...'; btn.disabled = true; }
      moveStatusDiv.textContent = 'Starting move operation...';

      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/move-comics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {})
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Move operation failed');

        let message = `Move complete! Processed: ${data.processed}, Moved: ${data.moved}`;
        if (data.errors > 0) message += `, Errors: ${data.errors}`;
        if (data.destDirectory) message += ` to ${data.destDirectory}`;

        moveStatusDiv.textContent = message;
        moveStatusDiv.className = 'text-xs mt-2 text-green-400';
      } catch (error) {
        moveStatusDiv.textContent = `Error: ${error.message}`;
        moveStatusDiv.className = 'text-xs mt-2 text-red-400';
      } finally {
        if (btn) setTimeout(() => { btn.textContent = origLabel; btn.disabled = false; }, 1000);
      }
    }

    // Folder tab: reorganize an ENTIRE selected library in place (confirmation required).
    const moveLibraryBtn = document.getElementById('move-library-btn');
    const moveLibrarySelect = document.getElementById('move-library-select');
    if (moveLibraryBtn) {
      moveLibraryBtn.addEventListener('click', () => {
        const libraryPath = moveLibrarySelect ? moveLibrarySelect.value : '';
        if (!libraryPath) {
          moveStatusDiv.textContent = 'Select a library first.';
          moveStatusDiv.className = 'text-xs mt-2 text-yellow-400';
          return;
        }
        promptSafetyConfirmation(
          'Reorganize Entire Library',
          'This will move & reorganize EVERY comic in the selected library into your saved folder hierarchy. This action cannot be easily undone.',
          (confirmation) => {
            if (mgmtTabOperations) mgmtTabOperations.click();
            performMove({ libraryPath, confirmation }, moveLibraryBtn);
          }
        );
      });
    }

    function showDirectorySelectionModal(directories) {
      const modal = document.getElementById('directory-selection-modal');
      const optionsContainer = document.getElementById('directory-options');
      const confirmBtn = document.getElementById('directory-confirm-btn');
      const cancelBtn = document.getElementById('directory-cancel-btn');
      const closeBtn = document.getElementById('directory-modal-close');

      // Clear previous options
      optionsContainer.innerHTML = '';
      let selectedDirectory = null;

      // Create radio buttons for each directory
      directories.forEach((dir, index) => {
        const option = document.createElement('div');
        option.className = 'flex items-center space-x-3 p-3 rounded-lg border border-gray-600 hover:border-gray-500 hover:bg-gray-750 transition-colors cursor-pointer';
        option.innerHTML = `
          <input type="radio" id="dir-${index}" name="directory" value="${dir.fullPath}" class="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 focus:ring-green-500 focus:ring-2">
          <div class="flex-grow">
            <label for="dir-${index}" class="text-white cursor-pointer font-medium block">${dir.name}</label>
            <span class="text-gray-400 text-sm">${dir.fullPath}</span>
          </div>
        `;
        optionsContainer.appendChild(option);

        // Make the whole option clickable
        option.addEventListener('click', () => {
          const radio = option.querySelector('input[type="radio"]');
          radio.checked = true;
          selectedDirectory = dir.fullPath;
          confirmBtn.disabled = false;

          // Remove selection styling from other options
          optionsContainer.querySelectorAll('div').forEach(opt => {
            opt.classList.remove('border-green-500', 'bg-gray-700');
            opt.classList.add('border-gray-600');
          });

          // Add selection styling to this option
          option.classList.remove('border-gray-600');
          option.classList.add('border-green-500', 'bg-gray-700');
        });
      });

      // Show modal
      modal.classList.remove('hidden');

      // Handle confirm
      const handleConfirm = async () => {
        if (selectedDirectory) {
          modal.classList.add('hidden');
          await performMove({ targetDirectory: selectedDirectory }, moveComicsBtn);
        }
        cleanup();
      };

      // Handle cancel/close
      const handleCancel = () => {
        modal.classList.add('hidden');
        cleanup();
      };

      const cleanup = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        confirmBtn.disabled = true;
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
    }
  }
});

state.startRenameStream = startRenameStream;
state.stopRenameStream = stopRenameStream;
state.startMoveStream = startMoveStream;
state.stopMoveStream = stopMoveStream;

if (typeof window !== 'undefined') {
  window.startRenameStream = startRenameStream;
  window.stopRenameStream = stopRenameStream;
  window.startMoveStream = startMoveStream;
  window.stopMoveStream = stopMoveStream;
}