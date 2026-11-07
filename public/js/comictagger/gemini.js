import {
  state,
  clearElement,
  global as canonicalGlobal
} from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };

export const geminiState = {
  _loaded: false,
  termsAccepted: false,
  hasApiKey: false,
  enabled: false,
  model: 'gemini-3.5-flash-lite'
};
if (typeof window !== 'undefined') {
  window._geminiState = geminiState;
}

let geminiModelFetchTimer = null;

export async function loadGeminiModels(apiKey = '', targetModel = '') {
  const modelSelect = document.getElementById('ct-gemini-model-select');
  const statusSpan = document.getElementById('ct-gemini-models-status');
  if (!modelSelect) return;

  const currentVal = targetModel || modelSelect.value || (window._geminiState?.model) || 'gemini-3.5-flash-lite';
  if (statusSpan && apiKey) {
    statusSpan.textContent = 'Querying available Flash-Lite models...';
  }

  try {
    const url = apiKey
      ? `${global.API_BASE_URL}/api/v1/gemini/models?apiKey=${encodeURIComponent(apiKey)}`
      : `${global.API_BASE_URL}/api/v1/gemini/models`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];

    if (models.length > 0) {
      clear(modelSelect);
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.displayName || m.id;
        if (m.id === currentVal) opt.selected = true;
        modelSelect.appendChild(opt);
      });

      if (!models.some(m => m.id === currentVal)) {
        const opt = document.createElement('option');
        opt.value = currentVal;
        opt.textContent = currentVal;
        opt.selected = true;
        modelSelect.appendChild(opt);
      }

      if (statusSpan) {
        if (data.source === 'gemini-api') {
          statusSpan.textContent = `✓ ${models.length} Flash-Lite models available`;
        } else {
          statusSpan.textContent = 'Default: 3.5 Flash-Lite';
        }
      }
    }
  } catch (err) {
    if (statusSpan) {
      statusSpan.textContent = 'Default: 3.5 Flash-Lite';
    }
  }
}

export function openGeminiComplianceModal(prefillKey) {
  const modal = document.getElementById('gemini-compliance-modal');
  if (!modal) return;
  const keyInput = document.getElementById('gemini-modal-key-input');
  const agreeCb = document.getElementById('gemini-modal-agree-cb');
  const saveBtn = document.getElementById('gemini-modal-save-btn');

  if (agreeCb) agreeCb.checked = false;
  if (keyInput) {
    if (prefillKey) {
      keyInput.value = prefillKey;
    } else if (typeof window !== 'undefined' && window._geminiState?.hasApiKey) {
      keyInput.placeholder = '•••••••••••••••••••••••••••••••• (API Key set)';
    }
  }
  if (saveBtn) {
    const hasKey = (keyInput && keyInput.value.trim().length > 0) || !!(typeof window !== 'undefined' && window._geminiState?.hasApiKey);
    saveBtn.disabled = !agreeCb?.checked || !hasKey;
  }
  modal.classList.remove('hidden');
}

export function initGeminiComplianceModal() {
  const modal = document.getElementById('gemini-compliance-modal');
  if (!modal || modal.dataset.geminiInitialized) return;
  modal.dataset.geminiInitialized = 'true';

  const keyInput = document.getElementById('gemini-modal-key-input');
  const agreeCb = document.getElementById('gemini-modal-agree-cb');
  const saveBtn = document.getElementById('gemini-modal-save-btn');
  const disagreeBtn = document.getElementById('gemini-modal-disagree-btn');

  function checkFormValidity() {
    const hasAgreed = !!agreeCb?.checked;
    const keyVal = keyInput ? keyInput.value.trim() : '';
    const hasKey = keyVal.length > 0 || !!(typeof window !== 'undefined' && window._geminiState?.hasApiKey);
    if (saveBtn) {
      saveBtn.disabled = !hasAgreed || !hasKey;
    }
  }

  agreeCb?.addEventListener('change', checkFormValidity);
  keyInput?.addEventListener('input', checkFormValidity);

  disagreeBtn?.addEventListener('click', function() {
    modal.classList.add('hidden');
    const ctKeyInput = document.getElementById('ct-gemini-key-input');
    const ctEnabledToggle = document.getElementById('ct-gemini-enabled-toggle');
    if (ctKeyInput) ctKeyInput.value = '';
    if (ctEnabledToggle) ctEnabledToggle.checked = false;

    fetch(`${global.API_BASE_URL}/api/v1/gemini/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geminiCoverMatchEnabled: false, geminiTermsAccepted: false })
    }).catch(function() {});
  });

  saveBtn?.addEventListener('click', async function() {
    if (!agreeCb?.checked) return;
    const keyVal = keyInput ? keyInput.value.trim() : '';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const modelSelect = document.getElementById('ct-gemini-model-select');
      const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.5-flash-lite';
      const capInput = document.getElementById('ct-gemini-daily-cap');
      const dailyCap = capInput ? parseInt(capInput.value, 10) : 450;

      const payload = {
        geminiCoverMatchEnabled: true,
        geminiTermsAccepted: true,
        geminiModel: selectedModel,
        geminiCoverDailyCap: dailyCap
      };
      if (keyVal) payload.geminiApiKey = keyVal;

      const res = await fetch(`${global.API_BASE_URL}/api/v1/gemini/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        geminiState._loaded = true;
        geminiState.termsAccepted = true;
        geminiState.hasApiKey = true;
        geminiState.enabled = true;
        geminiState.model = selectedModel;

        const ctKeyInput = document.getElementById('ct-gemini-key-input');
        const ctEnabledToggle = document.getElementById('ct-gemini-enabled-toggle');

        if (ctKeyInput) {
          ctKeyInput.value = '';
          ctKeyInput.placeholder = '•••••••••••••••••••••••••••••••• (API Key set)';
        }
        if (ctEnabledToggle) {
          ctEnabledToggle.checked = true;
        }

        modal.classList.add('hidden');
      } else {
        const errData = await res.json().catch(function() { return {}; });
        alert('Failed to save configuration: ' + (errData.error || 'Server error'));
      }
    } catch (err) {
      alert('Network error saving configuration');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Configuration';
    }
  });

  // Key toggle show/hide
  const toggleBtn = document.getElementById('ct-gemini-key-toggle');
  const ctKeyInput = document.getElementById('ct-gemini-key-input');
  if (toggleBtn && ctKeyInput) {
    toggleBtn.addEventListener('click', function() {
      if (ctKeyInput.type === 'password') {
        ctKeyInput.type = 'text';
        toggleBtn.textContent = 'Hide';
      } else {
        ctKeyInput.type = 'password';
        toggleBtn.textContent = 'Show';
      }
    });
  }

  // Dynamic model querying on entering API key
  if (ctKeyInput) {
    ctKeyInput.addEventListener('input', function() {
      const val = ctKeyInput.value.trim();
      if (geminiModelFetchTimer) clearTimeout(geminiModelFetchTimer);
      if (val.length >= 8) {
        geminiModelFetchTimer = setTimeout(() => {
          loadGeminiModels(val);
        }, 600);
      }
    });
  }

  // Immediate persistence when toggling Enable Gemini checkbox
  const ctEnabledToggle = document.getElementById('ct-gemini-enabled-toggle');
  if (ctEnabledToggle && !ctEnabledToggle.dataset.bound) {
    ctEnabledToggle.dataset.bound = 'true';
    ctEnabledToggle.addEventListener('change', async function() {
      const isEnabled = !!ctEnabledToggle.checked;
      const keyVal = ctKeyInput ? ctKeyInput.value.trim() : '';
      if (isEnabled && !geminiState.termsAccepted && (keyVal || geminiState.hasApiKey)) {
        openGeminiComplianceModal(keyVal);
        return;
      }
      geminiState._loaded = true;
      geminiState.enabled = isEnabled;
      try {
        const payload = { geminiCoverMatchEnabled: isEnabled };
        if (geminiState.termsAccepted) {
          payload.geminiTermsAccepted = true;
        }
        await fetch(`${global.API_BASE_URL || ''}/api/v1/gemini/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (_) {}
    });
  }

  // Dedicated Save Gemini Settings Button
  const geminiSaveBtn = document.getElementById('ct-gemini-save-btn');
  if (geminiSaveBtn && !geminiSaveBtn.dataset.bound) {
    geminiSaveBtn.dataset.bound = 'true';
    geminiSaveBtn.addEventListener('click', async function() {
      const isEnabled = document.getElementById('ct-gemini-enabled-toggle')?.checked ?? true;
      const keyVal = ctKeyInput ? ctKeyInput.value.trim() : '';
      const modelSelect = document.getElementById('ct-gemini-model-select');
      const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.5-flash-lite';
      const capInput = document.getElementById('ct-gemini-daily-cap');
      const dailyCap = capInput ? parseInt(capInput.value, 10) : 450;
      const state = geminiState;

      if (!state.termsAccepted && isEnabled && (keyVal || state.hasApiKey)) {
        openGeminiComplianceModal(keyVal);
        return;
      }

      geminiSaveBtn.disabled = true;
      geminiSaveBtn.textContent = 'Saving...';

      try {
        const payload = {
          geminiCoverMatchEnabled: isEnabled,
          geminiTermsAccepted: isEnabled ? true : !!state.termsAccepted,
          geminiModel: selectedModel,
          geminiCoverDailyCap: dailyCap
        };
        if (keyVal) payload.geminiApiKey = keyVal;

        const res = await fetch(`${global.API_BASE_URL}/api/v1/gemini/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          state._loaded = true;
          if (isEnabled) state.termsAccepted = true;
          if (keyVal) state.hasApiKey = true;
          state.enabled = isEnabled;
          state.model = selectedModel;

          geminiSaveBtn.textContent = '✓ Saved';
          if (keyVal && ctKeyInput) {
            ctKeyInput.value = '';
            ctKeyInput.placeholder = '•••••••••••••••••••••••••••••••• (API Key set)';
          }
          setTimeout(() => {
            geminiSaveBtn.textContent = 'Save Gemini Settings';
            geminiSaveBtn.disabled = false;
          }, 1500);
        } else {
          geminiSaveBtn.textContent = '✗ Error';
          geminiSaveBtn.disabled = false;
        }
      } catch (_) {
        geminiSaveBtn.textContent = '✗ Error';
        geminiSaveBtn.disabled = false;
      }
    });
  }
}

global.geminiState = geminiState;
global.loadGeminiModels = loadGeminiModels;
global.openGeminiComplianceModal = openGeminiComplianceModal;
global.initGeminiComplianceModal = initGeminiComplianceModal;
