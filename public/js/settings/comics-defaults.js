// --- COMICS DEFAULTS ---
async function loadComicsDefaults() {
  const libraryContainer = document.getElementById('library-preferences-container');
  const allowedFormatsSelect = document.getElementById('allowed-formats-select');
  const metadataStorageSelect = document.getElementById('metadata-storage-select');
  const migrationOptions = document.getElementById('metadata-migration-options');
  const migrateBtn = document.getElementById('migrate-metadata-btn');
  const applyCheckbox = document.getElementById('apply-to-existing-metadata');
  const migrationStatus = document.getElementById('metadata-migration-status');
  
  // Master Toggles
  const masterMangaToggle = document.getElementById('master-manga-toggle');
  const masterContinuousToggle = document.getElementById('master-continuous-toggle');

  // --- MASTER TOGGLE LOGIC ---
  async function loadMasterDefaults() {
    try {
      const mangaRes = await fetch(`${API_BASE_URL}/api/v1/manga-mode-preference`);
      const contRes = await fetch(`${API_BASE_URL}/api/v1/continuous-mode-preference`);
      
      const mangaData = await mangaRes.json();
      const contData = await contRes.json();

      if (masterMangaToggle) masterMangaToggle.checked = !!mangaData.mangaMode;
      if (masterContinuousToggle) masterContinuousToggle.checked = !!contData.continuousMode;
    } catch (e) {
      console.error('[DEFAULTS] Failed to load master defaults:', e);
    }
  }

  if (masterMangaToggle) {
    masterMangaToggle.addEventListener('change', async () => {
      const enabled = masterMangaToggle.checked;
      if (!confirm(`Switch ALL libraries and comics to ${enabled ? 'Manga' : 'Standard'} mode? This clears individual overrides.`)) {
        masterMangaToggle.checked = !enabled;
        return;
      }
      
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/comics/set-all-manga-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mangaMode: enabled })
        });
        if (res.ok) {
          showSettingsMessage(`All libraries set to ${enabled ? 'Manga' : 'Standard'}`, 'success');
          loadLibraryPreferences();
        } else {
          throw new Error('Update failed');
        }
      } catch (e) {
        showSettingsMessage('Failed to apply changes', 'error');
        masterMangaToggle.checked = !enabled;
      }
    });
  }

  if (masterContinuousToggle) {
    masterContinuousToggle.addEventListener('change', async () => {
      const enabled = masterContinuousToggle.checked;
      if (!confirm(`Switch ALL libraries and comics to ${enabled ? 'Continuous' : 'Paginated'} mode? This clears individual overrides.`)) {
        masterContinuousToggle.checked = !enabled;
        return;
      }
      
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/comics/set-all-continuous-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ continuousMode: enabled })
        });
        if (res.ok) {
          showSettingsMessage(`All libraries set to ${enabled ? 'Continuous' : 'Paginated'}`, 'success');
          loadLibraryPreferences();
        } else {
          throw new Error('Update failed');
        }
      } catch (e) {
        showSettingsMessage('Failed to apply changes', 'error');
        masterContinuousToggle.checked = !enabled;
      }
    });
  }

  // --- PER-LIBRARY LOGIC ---
  async function loadLibraryPreferences() {
    if (!libraryContainer) return;
    
    // Show spinner
    libraryContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-gray-500">
        <svg class="animate-spin h-8 w-8 text-purple-500 mb-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="text-sm font-medium animate-pulse">Loading library preferences...</span>
      </div>
    `;

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/user/library-preferences`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Failed to load');
      renderLibraryPreferences(data.preferences);
    } catch (error) {
      console.error('Failed to load library preferences:', error);
      libraryContainer.innerHTML = `<div class="text-red-400 text-sm py-8 italic text-center bg-red-900/10 rounded-xl border border-red-500/20">Error loading libraries: ${error.message}</div>`;
    }
  }

  function renderLibraryPreferences(preferences) {
    if (!preferences || preferences.length === 0) {
      libraryContainer.innerHTML = '<div class="text-gray-500 text-sm py-10 italic text-center bg-gray-800/20 rounded-xl border border-gray-700/50">No libraries found in your configuration.</div>';
      return;
    }

    libraryContainer.innerHTML = '';
    preferences.forEach((pref, index) => {
      const path = pref.path;
      const parts = path.split(/[\\/]/).filter(Boolean);
      const displayPath = parts[parts.length - 1] || path;
      
      const mangaId = `lib-manga-${index}`;
      const scrollId = `lib-scroll-${index}`;

      const row = document.createElement('div');
      row.className = 'bg-gray-900/40 rounded-xl p-4 border border-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-purple-500/30 transition-all group';
      row.innerHTML = `
        <div class="flex items-center gap-3 overflow-hidden">
          <div class="bg-gray-800 p-2 rounded-lg border border-gray-700 group-hover:bg-gray-700 transition-colors">
            <svg class="w-5 h-5 text-gray-500 group-hover:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>
          </div>
          <div class="overflow-hidden">
            <p class="text-sm font-bold text-gray-200 truncate">${displayPath}</p>
            <p class="text-[10px] text-gray-600 font-mono truncate" title="${path}">${path}</p>
          </div>
        </div>

        <div class="flex items-center gap-4 bg-black/20 p-2 rounded-lg border border-gray-800/50">
          <!-- Manga -->
          <div class="flex items-center gap-2">
            <span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Manga</span>
            <label for="${mangaId}" class="cursor-pointer flex-shrink-0">
              <input type="checkbox" id="${mangaId}" class="sr-only peer lib-toggle-manga" ${pref.mangaMode ? 'checked' : ''}>
              <div class="toggle-bg bg-gray-700 border-2 border-gray-600 h-5 rounded-full" style="width: 2.5rem;"></div>
            </label>
          </div>

          <div class="w-px h-4 bg-gray-800"></div>

          <!-- Scroll -->
          <div class="flex items-center gap-2">
            <span class="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Scroll</span>
            <label for="${scrollId}" class="cursor-pointer flex-shrink-0">
              <input type="checkbox" id="${scrollId}" class="sr-only peer lib-toggle-scroll" ${pref.continuousMode ? 'checked' : ''}>
              <div class="toggle-bg bg-gray-700 border-2 border-gray-600 h-5 rounded-full" style="width: 2.5rem;"></div>
            </label>
          </div>
        </div>
      `;
      libraryContainer.appendChild(row);

      const mToggle = row.querySelector('.lib-toggle-manga');
      const sToggle = row.querySelector('.lib-toggle-scroll');

      mToggle.addEventListener('change', () => {
        updateLibraryPreference(path, mToggle.checked, sToggle.checked);
      });
      sToggle.addEventListener('change', () => {
        updateLibraryPreference(path, mToggle.checked, sToggle.checked);
      });
    });
  }

  async function updateLibraryPreference(path, mangaMode, continuousMode) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/user/library-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, mangaMode, continuousMode })
      });
      if (response.ok) {
        showSettingsMessage('Saved', 'success');
        if (window.fetchLibraryFromServer) window.fetchLibraryFromServer();
      }
    } catch (error) {
      showSettingsMessage('Save failed', 'error');
      loadLibraryPreferences();
    }
  }

  // --- OTHER SETTINGS ---
  let initialMetadataStorage = null;
  if (metadataStorageSelect && migrationOptions) {
    setTimeout(() => { initialMetadataStorage = metadataStorageSelect.value; }, 500);
    metadataStorageSelect.addEventListener('change', () => {
      migrationOptions.classList.toggle('hidden', metadataStorageSelect.value === initialMetadataStorage);
    });
  }

  if (migrateBtn) {
    migrateBtn.addEventListener('click', async () => {
      if (!applyCheckbox?.checked) {
        if (migrationStatus) migrationStatus.textContent = 'Confirm by checking the box.';
        return;
      }
      migrateBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/admin/metadata/migrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: metadataStorageSelect.value, applyToExisting: true })
        });
        if (res.ok) showSettingsMessage('Migration complete', 'success');
      } catch (e) {
        showSettingsMessage('Migration failed', 'error');
      } finally { migrateBtn.disabled = false; }
    });
  }

  if (allowedFormatsSelect) {
    allowedFormatsSelect.addEventListener('change', async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowedFormats: allowedFormatsSelect.value })
        });
        if (res.ok) showSettingsMessage('Saved', 'success');
      } catch (e) { showSettingsMessage('Failed', 'error'); }
    });
  }

  // Initial load
  loadMasterDefaults();
  loadLibraryPreferences();
}
