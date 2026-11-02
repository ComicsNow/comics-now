/**
 * Comics Now! - Rename Output Streaming & Batch Rename Runner
 *
 * Server-Sent Events (SSE) stream listener and batch rename execution handler.
 */

import { state } from '../../globals.js';

let renameEventSource = null;

/**
 * Resolve the API base URL for stream/fetch calls. Callers (e.g. tab switches)
 * may invoke startRenameStream with no argument, so fall back to the
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
 * Setup rename output streaming
 * @param {string} [apiBaseUrl]
 */
export function startRenameStream(apiBaseUrl = '') {
  if (renameEventSource) return;
  if (typeof EventSource === 'undefined') return;

  const base = resolveApiBaseUrl(apiBaseUrl);
  const renameOutputDiv = document.getElementById('rename-output');
  if (renameOutputDiv) {
    renameOutputDiv.classList.remove('hidden');
  }
  renameEventSource = new EventSource(`${base}/api/v1/rename/stream`);

  renameEventSource.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      const line = document.createElement('div');
      line.textContent = entry.message;
      if (renameOutputDiv) {
        renameOutputDiv.appendChild(line);
        renameOutputDiv.scrollTop = renameOutputDiv.scrollHeight;
      }
    } catch (_) {}
  };

  renameEventSource.onerror = () => {};
}

/**
 * Stop rename output streaming
 */
export function stopRenameStream() {
  if (renameEventSource) {
    renameEventSource.close();
    renameEventSource = null;
  }
}

/**
 * Shared rename runner for either scope:
 *   {}                            -> inbox (comicsLocation), no confirmation
 *   { libraryPath, confirmation } -> whole selected library
 * @param {Object} body
 * @param {HTMLElement} btn
 * @param {string} apiBaseUrl
 */
export async function runRename(body = {}, btn = null, apiBaseUrl = '') {
  const renameStatusDiv = document.getElementById('rename-status');
  const renameOutputDiv = document.getElementById('rename-output');
  if (!renameStatusDiv) return;

  if (renameOutputDiv) {
    renameOutputDiv.classList.remove('hidden');
    if (typeof renameOutputDiv.replaceChildren === 'function') renameOutputDiv.replaceChildren();
    else renameOutputDiv.innerHTML = '';
  }
  startRenameStream(apiBaseUrl);

  const origLabel = btn ? btn.textContent : '';
  if (btn) {
    btn.textContent = 'Renaming...';
    btn.disabled = true;
  }
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
        failures.slice(0, 5).forEach(f => {
          message += `\n• ${f.file}: ${f.error || 'Unknown error'}`;
        });
        if (failures.length > 5) {
          message += `\n... and ${failures.length - 5} more error${failures.length - 5 !== 1 ? 's' : ''}`;
        }
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
    if (btn) {
      setTimeout(() => {
        btn.textContent = origLabel;
        btn.disabled = false;
      }, 1000);
    }
  }
}
