import { state, global as canonicalGlobal } from './globals.js';
import { startStream, stopStream, startLogPolling, stopLogPolling, rerenderLog, clearLogs, appendLogLine, logBuffer } from './guided-admin/logs.js';
import { fetchModalCredits, runModalSetup } from './guided-admin/modal.js';
import { fetchStatus, startPolling, stopPolling, setSettingsLoaded, applyStatusToUI, applySettingsToUI } from './guided-admin/status.js';
import { bindOnce } from './guided-admin/events.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

// Called by events.js when the user clicks the Guided Reader tab.
function openGuidedReaderTab() {
  setSettingsLoaded(false);
  bindOnce();
  fetchStatus(true);
  startStream();
  startPolling();
  startLogPolling();
}

// When the settings modal closes, the tab handlers don't fire — wire teardown
// to the modal close path. closeSettingsModal is defined in settings.js.
const origClose = global.closeSettingsModal;
if (typeof origClose === 'function') {
  global.closeSettingsModal = function () {
    setSettingsLoaded(false);
    stopStream();
    stopPolling();
    stopLogPolling();
    return origClose.apply(this, arguments);
  };
} else {
  // Not registered yet — define it on state so a later assignment is intercepted.
  let currentClose = global.closeSettingsModal;
  Object.defineProperty(state, 'closeSettingsModal', {
    get() {
      return currentClose;
    },
    set(newVal) {
      if (typeof newVal === 'function') {
        currentClose = function() {
          setSettingsLoaded(false);
          stopStream();
          stopPolling();
          stopLogPolling();
          return newVal.apply(this, arguments);
        };
      } else {
        currentClose = newVal;
      }
    },
    configurable: true,
    enumerable: true
  });
  
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'closeSettingsModal', {
      get() {
        return state.closeSettingsModal;
      },
      set(newVal) {
        state.closeSettingsModal = newVal;
      },
      configurable: true,
      enumerable: true
    });
  }
}

export {
  openGuidedReaderTab,
  startStream,
  stopStream,
  startLogPolling,
  stopLogPolling,
  rerenderLog,
  clearLogs,
  appendLogLine,
  logBuffer,
  fetchModalCredits,
  runModalSetup,
  fetchStatus,
  startPolling,
  stopPolling,
  setSettingsLoaded,
  applyStatusToUI,
  applySettingsToUI,
  bindOnce
};

state.openGuidedReaderTab = openGuidedReaderTab;

if (typeof window !== 'undefined') {
  window.openGuidedReaderTab = openGuidedReaderTab;
}
