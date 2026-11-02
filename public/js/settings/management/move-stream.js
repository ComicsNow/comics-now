/**
 * Comics Now! - Move Output Streaming & Batch Move Runner
 *
 * Server-Sent Events (SSE) stream listener and batch folder relocation runner.
 */

import { state } from '../../globals.js';

let moveEventSource = null;

/**
 * Resolve the API base URL for stream/fetch calls. Callers (e.g. tab switches)
 * may invoke startMoveStream with no argument, so fall back to the
 * centralized store like the pre-modular implementation did.
 * @param {string} apiBaseUrl
 * @returns {string}
 */
function resolveApiBaseUrl(apiBaseUrl) {
  if (apiBaseUrl) return apiBaseUrl;
  return (typeof state !== 'undefined' && state.API_BASE_URL) ||
         (typeof window !== 'undefined' && window.API_BASE_URL) || '';
}

/**
 * Setup move output streaming
 * @param {string} [apiBaseUrl]
 */
export function startMoveStream(apiBaseUrl = '') {
  if (moveEventSource) return;
  if (typeof EventSource === 'undefined') return;

  const base = resolveApiBaseUrl(apiBaseUrl);
  const moveOutputDiv = document.getElementById('move-output');
  if (moveOutputDiv) {
    moveOutputDiv.classList.remove('hidden');
  }
  moveEventSource = new EventSource(`${base}/api/v1/move/stream`);

  moveEventSource.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      const line = document.createElement('div');
      line.textContent = entry.message;
      if (moveOutputDiv) {
        moveOutputDiv.appendChild(line);
        moveOutputDiv.scrollTop = moveOutputDiv.scrollHeight;
      }
    } catch (_) {}
  };

  moveEventSource.onerror = () => {};
}

/**
 * Stop move output streaming
 */
export function stopMoveStream() {
  if (moveEventSource) {
    moveEventSource.close();
    moveEventSource = null;
  }
}

/**
 * Runs the move for either scope:
 *   { targetDirectory }           -> inbox -> that library (Operations tab)
 *   { libraryPath, confirmation } -> reorganize whole library in place (Folder tab)
 * @param {Object} body
 * @param {HTMLElement} btn
 * @param {string} apiBaseUrl
 */
export async function performMove(body = {}, btn = null, apiBaseUrl = '') {
  const moveStatusDiv = document.getElementById('move-status');
  const moveOutputDiv = document.getElementById('move-output');
  if (!moveStatusDiv) return;

  if (moveOutputDiv) {
    moveOutputDiv.classList.remove('hidden');
    if (typeof moveOutputDiv.replaceChildren === 'function') moveOutputDiv.replaceChildren();
    else moveOutputDiv.innerHTML = '';
  }
  startMoveStream(apiBaseUrl);

  const origLabel = btn ? btn.textContent : '';
  if (btn) {
    btn.textContent = 'Moving...';
    btn.disabled = true;
  }
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
    if (btn) {
      setTimeout(() => {
        btn.textContent = origLabel;
        btn.disabled = false;
      }, 1000);
    }
  }
}
