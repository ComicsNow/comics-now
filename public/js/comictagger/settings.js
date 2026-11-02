import {
  state,
  ctScheduleInput,
  global as canonicalGlobal
} from '../globals.js';
import {
  geminiState,
  loadGeminiModels,
  openGeminiComplianceModal,
  initGeminiComplianceModal
} from './gemini.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export async function fetchCtSettings() {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/schedule`);
    const data = await res.json();
    
    if (ctScheduleInput) ctScheduleInput.value = data.minutes || 0;

    const scanFolderInput = document.getElementById('ct-scan-folder-input');
    if (scanFolderInput) scanFolderInput.value = data.comicsLocation || '';

    const storageInput = document.getElementById('ct-storage-input');
    if (storageInput) storageInput.value = data.metadataStorage || 'archive';
    
    const upperInput = document.getElementById('ct-upper-threshold-input');
    if (upperInput) upperInput.value = Math.round((data.upperThreshold || 0.90) * 100);

    const lowerInput = document.getElementById('ct-lower-threshold-input');
    if (lowerInput) lowerInput.value = Math.round((data.lowerThreshold || 0.80) * 100);

    const cvKeyInput = document.getElementById('ct-cv-key-input');
    if (cvKeyInput) cvKeyInput.value = data.comicVineApiKey || '';

    const gbKeyInput = document.getElementById('ct-gb-key-input');
    if (gbKeyInput) gbKeyInput.value = data.googleBooksApiKey || '';

    const metronUserInput = document.getElementById('ct-metron-user-input');
    if (metronUserInput) metronUserInput.value = data.metronUser || '';

    const metronPassInput = document.getElementById('ct-metron-pass-input');
    if (metronPassInput && data.hasMetronPass) metronPassInput.placeholder = '•••••••• (saved)';

    const gcdUserInput = document.getElementById('ct-gcd-user-input');
    if (gcdUserInput) gcdUserInput.value = data.gcdUser || '';

    const gcdPassInput = document.getElementById('ct-gcd-pass-input');
    if (gcdPassInput && data.hasGcdPass) gcdPassInput.placeholder = '•••••••• (saved)';

    const portInput = document.getElementById('ct-tagger-port-input');
    if (portInput) {
      let port = 5000;
      try {
        port = parseInt(new URL(data.taggerServiceUrl).port, 10) || 5000;
      } catch (_) {}
      portInput.value = port;
    }

    const engineStatus = document.getElementById('ct-engine-status');
    if (engineStatus) {
      engineStatus.textContent = data.serviceOnline ? '● Engine Ready' : '● Engine Offline';
    }

    const enabled = data.enabledSources || [];
    ['comicvine', 'metron', 'gcd', 'lcg', 'goodreads', 'blackwells', 'waterstones', 'googlebooks', 'amazon', 'forbiddenplanet'].forEach(s => {
      const cb = document.getElementById(`src-cb-${s}`);
      if (cb) {
        cb.checked = enabled.length === 0 || enabled.includes(`src-${s}`) || enabled.includes(s);
      }
    });

    const forceSettingCb = document.getElementById('ct-force-setting-cb');
    if (forceSettingCb) forceSettingCb.checked = !!data.forceReprocess;

    try {
      const geminiRes = await fetch(`${global.API_BASE_URL}/api/v1/gemini/config?_t=${Date.now()}`);
      if (geminiRes.ok) {
        const geminiData = await geminiRes.json();
        geminiState.termsAccepted = !!geminiData.termsAccepted;
        geminiState.hasApiKey = !!geminiData.hasApiKey;
        geminiState.enabled = geminiData.enabled !== false;
        geminiState.model = geminiData.model || 'gemini-3.5-flash-lite';

        const geminiToggle = document.getElementById('ct-gemini-enabled-toggle');
        if (geminiToggle && geminiData.enabled !== undefined) {
          geminiToggle.checked = !!geminiData.enabled;
        }
        const geminiKeyInput = document.getElementById('ct-gemini-key-input');
        if (geminiKeyInput) {
          if (geminiData.hasApiKey && !geminiKeyInput.value) {
            geminiKeyInput.placeholder = '•••••••••••••••••••••••••••••••• (API Key set)';
          }
        }
        const dailyCapInput = document.getElementById('ct-gemini-daily-cap');
        if (dailyCapInput && geminiData.dailyCap) {
          dailyCapInput.value = geminiData.dailyCap;
        }
        const dailyUsedDiv = document.getElementById('ct-gemini-daily-used');
        if (dailyUsedDiv && geminiData.dailyUsed !== undefined) {
          dailyUsedDiv.textContent = `${geminiData.dailyUsed} requests used`;
        }

        if (typeof loadGeminiModels === 'function') {
          loadGeminiModels('', geminiData.model || 'gemini-3.5-flash-lite');
        }
      }
    } catch (_) {}
  } catch {}
}

export async function saveCtSettings() {
  const schedule = parseInt(ctScheduleInput?.value, 10) || 0;
  const scanFolderInput = document.getElementById('ct-scan-folder-input');
  const comicsLocation = scanFolderInput ? scanFolderInput.value.trim() : '';
  const storageInput = document.getElementById('ct-storage-input');
  const metadataStorage = storageInput ? storageInput.value : 'archive';
  
  const upperInput = document.getElementById('ct-upper-threshold-input');
  const upperThreshold = upperInput ? parseFloat(upperInput.value) / 100.0 : 0.90;

  const lowerInput = document.getElementById('ct-lower-threshold-input');
  const lowerThreshold = lowerInput ? parseFloat(lowerInput.value) / 100.0 : 0.80;

  const cvKeyInput = document.getElementById('ct-cv-key-input');
  const comicVineApiKey = cvKeyInput ? cvKeyInput.value.trim() : '';

  const gbKeyInput = document.getElementById('ct-gb-key-input');
  const googleBooksApiKey = gbKeyInput ? gbKeyInput.value.trim() : '';

  const metronUserInput = document.getElementById('ct-metron-user-input');
  const metronUser = metronUserInput ? metronUserInput.value.trim() : '';

  const metronPassInput = document.getElementById('ct-metron-pass-input');
  const metronPassword = metronPassInput ? metronPassInput.value.trim() : '';

  const gcdUserInput = document.getElementById('ct-gcd-user-input');
  const gcdUser = gcdUserInput ? gcdUserInput.value.trim() : '';

  const gcdPassInput = document.getElementById('ct-gcd-pass-input');
  const gcdPassword = gcdPassInput ? gcdPassInput.value.trim() : '';

  const portInput = document.getElementById('ct-tagger-port-input');
  const taggerServicePort = portInput ? parseInt(portInput.value, 10) : NaN;

  const forceSettingCb = document.getElementById('ct-force-setting-cb');
  const forceReprocess = forceSettingCb ? forceSettingCb.checked : false;

  const enabledSources = [];
  ['comicvine', 'metron', 'gcd', 'lcg', 'goodreads', 'blackwells', 'waterstones', 'googlebooks', 'amazon', 'forbiddenplanet'].forEach(s => {
    const cb = document.getElementById(`src-cb-${s}`);
    if (cb && cb.checked) {
      enabledSources.push(`src-${s}`);
    }
  });

  const geminiToggle = document.getElementById('ct-gemini-enabled-toggle');
  const geminiKeyInput = document.getElementById('ct-gemini-key-input');
  const geminiVal = geminiKeyInput ? geminiKeyInput.value.trim() : '';
  const geminiEnabled = geminiToggle ? geminiToggle.checked : false;
  const state = (typeof window !== 'undefined' && window._geminiState) ? window._geminiState : geminiState;

  if (geminiEnabled && (geminiVal || state.hasApiKey) && !state.termsAccepted) {
    initGeminiComplianceModal();
    openGeminiComplianceModal(geminiVal);
    return;
  }

  const saveBtn = document.getElementById('ct-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/tag-comics-now/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minutes: schedule,
        comicsLocation,
        metadataStorage,
        upperThreshold,
        lowerThreshold,
        comicVineApiKey,
        googleBooksApiKey,
        metronUser,
        metronPassword,
        gcdUser,
        gcdPassword,
        enabledSources,
        forceReprocess,
        ...(Number.isInteger(taggerServicePort) && taggerServicePort >= 1 && taggerServicePort <= 65535
          ? { taggerServicePort }
          : {})
      })
    });
    if (res.ok) {
      if (state.termsAccepted) {
        const geminiPayload = {
          geminiCoverMatchEnabled: geminiEnabled,
          geminiTermsAccepted: true
        };
        if (geminiVal) {
          geminiPayload.geminiApiKey = geminiVal;
        }
        fetch(`${global.API_BASE_URL}/api/v1/gemini/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload)
        }).catch(function() {});
      }

      if (saveBtn) {
        saveBtn.textContent = '✓ Saved';
        setTimeout(() => {
          saveBtn.textContent = 'Save Settings';
          saveBtn.disabled = false;
        }, 1500);
      }
    } else {
      throw new Error('Save failed');
    }
  } catch (err) {
    if (saveBtn) {
      saveBtn.textContent = '✗ Error';
      saveBtn.disabled = false;
    }
  }
}

global.fetchCtSettings = fetchCtSettings;
global.saveCtSettings = saveCtSettings;
