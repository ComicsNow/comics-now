import { state } from '../../globals.js';

let hideToastTimer = null;

function ensureToastElement() {
  if (typeof document === 'undefined' || !document.body) return null;
  let toast = document.getElementById('device-library-sync-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'device-library-sync-toast';
    toast.className = 'fixed bottom-4 right-4 z-50 bg-gray-800 border border-purple-500 rounded-lg shadow-2xl p-4 text-white max-w-xs w-full transition-all duration-300';

    const titleEl = document.createElement('div');
    titleEl.className = 'device-sync-toast-title text-sm font-bold truncate';

    const subEl = document.createElement('div');
    subEl.className = 'device-sync-toast-sub text-xs text-gray-400 mt-1 truncate';

    const barTrack = document.createElement('div');
    barTrack.className = 'w-full bg-gray-700 h-1.5 rounded-full overflow-hidden mt-2';

    const barFill = document.createElement('div');
    barFill.className = 'device-sync-toast-bar bg-purple-600 h-full transition-all duration-300';
    barFill.style.width = '0%';

    barTrack.appendChild(barFill);
    toast.appendChild(titleEl);
    toast.appendChild(subEl);
    toast.appendChild(barTrack);
    document.body.appendChild(toast);
  }
  return toast;
}

/**
 * Update both in-place Device Library card status and floating toast banner
 */
export function updateDeviceScanProgress(libraryId, libraryName, info = {}) {
  const { status = 'scanning', current = 0, total = 0, fileName = '' } = info;
  const safeName = String(libraryName || 'Local Library');

  if (!state.deviceScanStatus) {
    state.deviceScanStatus = {};
  }
  state.deviceScanStatus[libraryId] = { libraryName: safeName, status, current, total, fileName };

  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  // 1. Targeted in-place update on any rendered Device Library card
  if (typeof document !== 'undefined') {
    const cards = document.querySelectorAll('.device-library-card');
    cards.forEach((card) => {
      if (card.dataset.libraryId === String(libraryId)) {
        const statusEl = card.querySelector('.device-lib-status');
        const countEl = card.querySelector('.device-lib-count');
        if (countEl && total > 0) {
          countEl.textContent = `${total} Comics`;
        }
        if (statusEl) {
          if (status === 'scanning') {
            statusEl.className = 'device-lib-status mt-2 text-xs text-purple-400 font-medium';
            statusEl.textContent = total > 0
              ? `Syncing (${current} / ${total})...`
              : 'Scanning folder...';
          } else if (status === 'ready') {
            statusEl.className = 'device-lib-status mt-2 text-xs text-green-400';
            statusEl.textContent = 'Saved on Device';
          }
        }
      }
    });
  }

  // 2. Update floating toast feedback banner
  const toast = ensureToastElement();
  if (!toast) return;

  if (hideToastTimer) {
    clearTimeout(hideToastTimer);
    hideToastTimer = null;
  }
  toast.classList.remove('hidden');

  const titleEl = toast.querySelector('.device-sync-toast-title');
  const subEl = toast.querySelector('.device-sync-toast-sub');
  const barEl = toast.querySelector('.device-sync-toast-bar');

  if (status === 'scanning') {
    if (titleEl) {
      titleEl.className = 'device-sync-toast-title text-sm font-bold text-white truncate';
      titleEl.textContent = total > 0
        ? `Syncing "${safeName}" (${current} / ${total})`
        : `Scanning "${safeName}"...`;
    }
    if (subEl) {
      subEl.textContent = fileName ? `Saving ${fileName}...` : 'Preparing local comics for instant access...';
    }
    if (barEl) {
      barEl.style.width = `${pct}%`;
    }
  } else if (status === 'ready') {
    if (titleEl) {
      titleEl.className = 'device-sync-toast-title text-sm font-bold text-green-400 truncate';
      titleEl.textContent = `✓ "${safeName}" Ready (${total} Comics)`;
    }
    if (subEl) {
      subEl.textContent = 'Saved on device — available anytime without prompts.';
    }
    if (barEl) {
      barEl.style.width = '100%';
    }
    hideToastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3500);
  }
}
