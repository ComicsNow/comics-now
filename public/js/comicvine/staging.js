/**
 * Comics Now! - Metadata Source Staging Tray & Gemini Flash Synthesis
 *
 * Staged candidate tracking and cross-source AI synthesis dispatch.
 */

import { state, escapeHtml } from '../globals.js';
import { getSourceInfo } from './source-info.js';

export const cvState = {
  page: 1,
  limit: 20,
  total: 0,
  lastQuery: '',
  lastResources: 'issue',
  lastSort: '',
  lastIssueNumber: '',
  lastYear: '',
  stagedSources: [],
  allResults: [],
  activeSourceFilter: 'all'
};

export function getSourceKey(item) {
  if (!item) return '';
  if (item.id) return String(item.id);
  const src = item.source || 'source';
  const name = item.name || item.volumeName || item.title || '';
  const num = item.issueNumber || item.number || '';
  return `${src}-${name}-${num}`;
}

export function isSourceStaged(item) {
  const key = getSourceKey(item);
  return (cvState.stagedSources || []).some(s => getSourceKey(s) === key);
}

export function toggleStageSource(item) {
  if (!cvState.stagedSources) cvState.stagedSources = [];
  const key = getSourceKey(item);
  const idx = cvState.stagedSources.findIndex(s => getSourceKey(s) === key);
  if (idx >= 0) {
    cvState.stagedSources.splice(idx, 1);
  } else {
    cvState.stagedSources.push(item);
  }
  renderStagingTray();
  updateStageButtons();
}

export function unstageSource(keyOrId) {
  if (!cvState.stagedSources) cvState.stagedSources = [];
  const idx = cvState.stagedSources.findIndex(s => getSourceKey(s) === String(keyOrId) || String(s.id) === String(keyOrId));
  if (idx >= 0) {
    cvState.stagedSources.splice(idx, 1);
  }
  renderStagingTray();
  updateStageButtons();
}

export function clearStagedSources() {
  cvState.stagedSources = [];
  renderStagingTray();
  updateStageButtons();
}

export function updateStageButtons() {
  const buttons = document.querySelectorAll('.stage-source-btn');
  buttons.forEach(btn => {
    const item = btn._sourceItem;
    if (!item) return;
    const staged = isSourceStaged(item);
    if (staged) {
      btn.className = 'stage-source-btn shrink-0 ml-2 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1 bg-purple-600/30 text-purple-300 border border-purple-500/50 shadow-xs';
      btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span>✓ Staged</span>';
    } else {
      btn.className = 'stage-source-btn shrink-0 ml-2 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-600';
      btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg><span>+ Stage</span>';
    }
  });
}

export function renderStagingTray() {
  const tray = document.getElementById('source-staging-tray');
  if (!tray) return;

  const countEl = document.getElementById('staged-sources-count');
  const listEl = document.getElementById('staged-sources-list');
  const hintEl = document.getElementById('staging-tray-hint');
  const synthBtn = document.getElementById('synthesize-staged-sources-btn');
  const clearBtn = document.getElementById('clear-staged-sources-btn');

  if (clearBtn && !clearBtn._bound) {
    clearBtn._bound = true;
    clearBtn.addEventListener('click', clearStagedSources);
  }

  if (synthBtn && !synthBtn._bound) {
    synthBtn._bound = true;
    synthBtn.onclick = synthesizeStagedSources;
  }

  const count = (cvState.stagedSources || []).length;
  if (countEl) countEl.textContent = String(count);

  if (count === 0) {
    tray.classList.add('hidden');
    if (listEl) {
      if (typeof listEl.replaceChildren === 'function') listEl.replaceChildren();
      else listEl.innerHTML = '';
    }
    return;
  }

  tray.classList.remove('hidden');

  if (synthBtn) {
    synthBtn.disabled = count < 2;
  }

  if (hintEl) {
    if (count >= 2) {
      hintEl.textContent = `Ready to synthesize! Click above to reconcile metadata across ${count} sources with Gemini Flash.`;
      hintEl.className = 'text-[11px] text-purple-300 font-medium mb-2';
    } else {
      hintEl.textContent = 'Stage at least 1 more source to synthesize with Gemini Flash, or click any search result to apply directly.';
      hintEl.className = 'text-[11px] text-gray-400 mb-2';
    }
  }

  if (listEl) {
    if (typeof listEl.replaceChildren === 'function') listEl.replaceChildren();
    else listEl.innerHTML = '';

    for (const sourceItem of cvState.stagedSources) {
      const chip = document.createElement('div');
      chip.className = 'inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 bg-gray-700/80 hover:bg-gray-700 border border-gray-600 rounded-lg text-xs text-white shadow-xs';

      const srcInfo = getSourceInfo(sourceItem.source || 'other');
      const badge = `<span class="text-[9px] px-1.5 py-0.5 rounded-full ${srcInfo.badgeBg} text-white font-bold">${escapeHtml(srcInfo.name)}</span>`;

      const title = sourceItem.name || sourceItem.volumeName || sourceItem.title || 'Unknown';
      const num = sourceItem.issueNumber || sourceItem.number ? ` #${sourceItem.issueNumber || sourceItem.number}` : '';

      chip.innerHTML = `
        ${badge}
        <span class="max-w-[120px] sm:max-w-[180px] truncate font-medium">${escapeHtml(title)}${escapeHtml(num)}</span>
      `;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-staged-btn ml-1 p-0.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded cursor-pointer transition-colors';
      removeBtn.title = 'Remove staged source';
      removeBtn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unstageSource(getSourceKey(sourceItem));
      });

      chip.appendChild(removeBtn);
      listEl.appendChild(chip);
    }
  }
}

export async function synthesizeStagedSources() {
  if (!cvState.stagedSources || cvState.stagedSources.length < 2) return;

  const synthBtn = document.getElementById('synthesize-staged-sources-btn');
  const statusDiv = document.getElementById('search-status') || document.getElementById('cv-status');
  const originalBtnHtml = synthBtn ? synthBtn.innerHTML : '';

  if (synthBtn) {
    synthBtn.disabled = true;
    synthBtn.innerHTML = `
      <svg class="animate-spin w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
      <span>Synthesizing...</span>
    `;
  }

  if (statusDiv) {
    statusDiv.textContent = `Synthesizing metadata across ${cvState.stagedSources.length} sources with Gemini Flash...`;
  }

  const apiBaseUrl = (state && state.API_BASE_URL) || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';

  try {
    const resolvedSources = await Promise.all(
      cvState.stagedSources.map(async (item) => {
        if (!item.fullMetadata && (item.type === 'issue' || item.volumeId) && item.source !== 'gcd' && item.source !== 'metron' && item.source !== 'lcg') {
          try {
            const res = await fetch(`${apiBaseUrl}/api/v1/comicvine/issue/${item.id}`);
            if (res.ok) {
              const fullMeta = await res.json();
              return { ...item, fullMetadata: fullMeta };
            }
          } catch (_) {}
        }
        return item;
      })
    );

    const comic = (state && state.currentComic) || (typeof window !== 'undefined' ? window.currentComic : {}) || {};
    const payload = {
      sources: resolvedSources,
      filename: comic.name || comic.filename || '',
      existingMeta: (state && state.currentMetadata) || (typeof window !== 'undefined' ? window.currentMetadata : {}) || {}
    };

    const res = await fetch(`${apiBaseUrl}/api/v1/metadata/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Metadata synthesis failed');
    }

    if (data.metadata) {
      const sanitizeFn = (state && state.sanitizeMetadata) || (typeof window !== 'undefined' ? window.sanitizeMetadata : null);
      if (typeof sanitizeFn === 'function') {
        sanitizeFn(data.metadata);
      }
      const renderDisplayFn = (state && state.renderMetadataDisplay) || (typeof window !== 'undefined' ? window.renderMetadataDisplay : null);
      if (typeof renderDisplayFn === 'function') {
        renderDisplayFn(data.metadata, true);
      }
      if (state) state.metadataHasUnsavedChanges = true;

      const metaForm = document.getElementById('metadata-form-container') || document.getElementById('metadata-form');
      if (metaForm && typeof metaForm.scrollIntoView === 'function') {
        metaForm.scrollIntoView({ behavior: 'smooth' });
      }

      if (statusDiv) {
        statusDiv.textContent = `✓ Successfully synthesized metadata across ${resolvedSources.length} sources with Gemini Flash!`;
      }
    }
  } catch (err) {
    console.error('Synthesis error:', err);
    if (statusDiv) {
      statusDiv.textContent = `Synthesis error: ${err.message || err}`;
    }
  } finally {
    if (synthBtn) {
      synthBtn.disabled = (cvState.stagedSources || []).length < 2;
      synthBtn.innerHTML = originalBtnHtml;
    }
  }
}
