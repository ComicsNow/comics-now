/**
 * Comics Now! - Naming & Folder Organization Rules
 *
 * Token order manipulation, live pattern previews, and rules persistence.
 */

export const SAMPLE_METADATA = {
  Series: 'Animal Castle',
  Title: 'Winter of the Animals',
  Publisher: 'Ablaze',
  Year: '2022',
  Number: '2',
  PageCount: 32,
  Writer: 'Xavier Dorison',
  Volume: '1'
};

export const TOKEN_LABELS = {
  number: 'Issue Number (#)',
  series: 'Series Title',
  title: 'Story/Issue Title',
  publisher: 'Publisher [ ]',
  year: 'Publication Year ( )',
  pages: 'Page Count #',
  writer: 'Writer { }',
  volume: 'Volume'
};

export const namingRulesState = {
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

export const folderRulesState = {
  hierarchy: ['publisher', 'series']
};

export async function loadNamingRules(apiBaseUrl = '') {
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/naming-rules`);
    const data = await res.json();
    if (data.ok && data.rules && Array.isArray(data.rules.tokens)) {
      namingRulesState.tokens = data.rules.tokens;
    }
  } catch (_) {}
  renderNamingTokens(apiBaseUrl);
  updateNamingPreview(apiBaseUrl);
}

export function renderNamingTokens(apiBaseUrl = '') {
  const namingTokensList = document.getElementById('naming-tokens-list');
  if (!namingTokensList) return;
  if (typeof namingTokensList.replaceChildren === 'function') namingTokensList.replaceChildren();
  else namingTokensList.innerHTML = '';

  namingRulesState.tokens.forEach((token, index) => {
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
          <button class="token-down-btn px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-200 ${index === namingRulesState.tokens.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}">▼</button>
        </div>
      </div>
    `;

    const enableCb = row.querySelector('.token-enable-cb');
    const mandCb = row.querySelector('.token-mand-cb');
    const upBtn = row.querySelector('.token-up-btn');
    const downBtn = row.querySelector('.token-down-btn');

    enableCb.addEventListener('change', () => {
      token.enabled = enableCb.checked;
      updateNamingPreview(apiBaseUrl);
    });

    mandCb.addEventListener('change', () => {
      token.mandatory = mandCb.checked;
      if (token.mandatory && !token.enabled) {
        token.enabled = true;
        enableCb.checked = true;
      }
      updateNamingPreview(apiBaseUrl);
    });

    if (index > 0) {
      upBtn.addEventListener('click', () => {
        const temp = namingRulesState.tokens[index - 1];
        namingRulesState.tokens[index - 1] = token;
        namingRulesState.tokens[index] = temp;
        renderNamingTokens(apiBaseUrl);
        updateNamingPreview(apiBaseUrl);
      });
    }

    if (index < namingRulesState.tokens.length - 1) {
      downBtn.addEventListener('click', () => {
        const temp = namingRulesState.tokens[index + 1];
        namingRulesState.tokens[index + 1] = token;
        namingRulesState.tokens[index] = temp;
        renderNamingTokens(apiBaseUrl);
        updateNamingPreview(apiBaseUrl);
      });
    }

    namingTokensList.appendChild(row);
  });
}

export async function updateNamingPreview(apiBaseUrl = '') {
  const namingLivePreview = document.getElementById('naming-live-preview');
  if (!namingLivePreview) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/naming-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: SAMPLE_METADATA, rules: namingRulesState })
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

export async function saveNamingRules(apiBaseUrl = '', saveNamingRulesBtn = null) {
  if (saveNamingRulesBtn) {
    saveNamingRulesBtn.disabled = true;
    saveNamingRulesBtn.textContent = 'Saving...';
  }
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/naming-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: namingRulesState })
    });
    const data = await res.json();
    if (data.ok) {
      if (saveNamingRulesBtn) {
        saveNamingRulesBtn.textContent = '✓ Saved!';
        saveNamingRulesBtn.classList.replace('bg-blue-600', 'bg-green-600');
      }
    } else {
      alert('Failed to save naming rules: ' + (data.error || 'Unknown error'));
      if (saveNamingRulesBtn) saveNamingRulesBtn.textContent = 'Save Naming Rules';
    }
  } catch (err) {
    alert('Network error saving naming rules: ' + err.message);
    if (saveNamingRulesBtn) saveNamingRulesBtn.textContent = 'Save Naming Rules';
  } finally {
    if (saveNamingRulesBtn) {
      setTimeout(() => {
        saveNamingRulesBtn.disabled = false;
        saveNamingRulesBtn.textContent = 'Save Naming Rules';
        saveNamingRulesBtn.classList.replace('bg-green-600', 'bg-blue-600');
      }, 2000);
    }
  }
}

export async function loadFolderRules(apiBaseUrl = '') {
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/folder-rules`);
    const data = await res.json();
    if (data.ok && data.rules && Array.isArray(data.rules.hierarchy)) {
      folderRulesState.hierarchy = data.rules.hierarchy;
    }
  } catch (_) {}
  renderFolderLevels(apiBaseUrl);
  updateFolderPreview(apiBaseUrl);
}

export function renderFolderLevels(apiBaseUrl = '') {
  const folderLevelsList = document.getElementById('folder-levels-list');
  if (!folderLevelsList) return;
  if (typeof folderLevelsList.replaceChildren === 'function') folderLevelsList.replaceChildren();
  else folderLevelsList.innerHTML = '';

  if (folderRulesState.hierarchy.length === 0) {
    folderLevelsList.innerHTML = '<p class="text-xs text-amber-400 p-2">No hierarchy levels added. Comics will be placed directly in the destination folder.</p>';
    return;
  }

  folderRulesState.hierarchy.forEach((token, index) => {
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
        <button class="level-down-btn px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-200 ${index === folderRulesState.hierarchy.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}">▼</button>
        <button class="level-remove-btn px-2 py-0.5 bg-red-900/60 hover:bg-red-800 text-red-300 rounded">✕</button>
      </div>
    `;

    const upBtn = row.querySelector('.level-up-btn');
    const downBtn = row.querySelector('.level-down-btn');
    const removeBtn = row.querySelector('.level-remove-btn');

    if (index > 0) {
      upBtn.addEventListener('click', () => {
        const temp = folderRulesState.hierarchy[index - 1];
        folderRulesState.hierarchy[index - 1] = token;
        folderRulesState.hierarchy[index] = temp;
        renderFolderLevels(apiBaseUrl);
        updateFolderPreview(apiBaseUrl);
      });
    }

    if (index < folderRulesState.hierarchy.length - 1) {
      downBtn.addEventListener('click', () => {
        const temp = folderRulesState.hierarchy[index + 1];
        folderRulesState.hierarchy[index + 1] = token;
        folderRulesState.hierarchy[index] = temp;
        renderFolderLevels(apiBaseUrl);
        updateFolderPreview(apiBaseUrl);
      });
    }

    removeBtn.addEventListener('click', () => {
      folderRulesState.hierarchy.splice(index, 1);
      renderFolderLevels(apiBaseUrl);
      updateFolderPreview(apiBaseUrl);
    });

    folderLevelsList.appendChild(row);
  });
}

export async function updateFolderPreview(apiBaseUrl = '') {
  const folderLivePreview = document.getElementById('folder-live-preview');
  if (!folderLivePreview) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/folder-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: SAMPLE_METADATA, rules: folderRulesState })
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

export async function saveFolderRules(apiBaseUrl = '', saveFolderRulesBtn = null) {
  if (saveFolderRulesBtn) {
    saveFolderRulesBtn.disabled = true;
    saveFolderRulesBtn.textContent = 'Saving...';
  }
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/tag-comics-now/folder-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: folderRulesState })
    });
    const data = await res.json();
    if (data.ok) {
      if (saveFolderRulesBtn) {
        saveFolderRulesBtn.textContent = '✓ Saved!';
        saveFolderRulesBtn.classList.replace('bg-blue-600', 'bg-green-600');
      }
    } else {
      alert('Failed to save folder rules: ' + (data.error || 'Unknown error'));
      if (saveFolderRulesBtn) saveFolderRulesBtn.textContent = 'Save Folder Rules';
    }
  } catch (err) {
    alert('Network error saving folder rules: ' + err.message);
    if (saveFolderRulesBtn) saveFolderRulesBtn.textContent = 'Save Folder Rules';
  } finally {
    if (saveFolderRulesBtn) {
      setTimeout(() => {
        saveFolderRulesBtn.disabled = false;
        saveFolderRulesBtn.textContent = 'Save Folder Rules';
        saveFolderRulesBtn.classList.replace('bg-green-600', 'bg-blue-600');
      }, 2000);
    }
  }
}
