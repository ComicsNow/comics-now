import { state } from '../globals.js';

let renameEventSource = null;
let moveEventSource = null;

// Setup rename output streaming
export function startRenameStream() {
  if (renameEventSource) return;

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

  // Management sub-tabs
  const mgmtTabOperations = document.getElementById('mgmt-tab-operations');
  const mgmtTabErrors = document.getElementById('mgmt-tab-errors');
  const mgmtContentOperations = document.getElementById('mgmt-content-operations');
  const mgmtContentErrors = document.getElementById('mgmt-content-errors');
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

  if (mgmtTabOperations && mgmtTabErrors) {
    mgmtTabOperations.addEventListener('click', () => {
      mgmtTabOperations.classList.add('active');
      mgmtTabErrors.classList.remove('active');
      mgmtContentOperations.classList.remove('hidden');
      mgmtContentErrors.classList.add('hidden');
    });
    mgmtTabErrors.addEventListener('click', () => {
      mgmtTabErrors.classList.add('active');
      mgmtTabOperations.classList.remove('active');
      mgmtContentErrors.classList.remove('hidden');
      mgmtContentOperations.classList.add('hidden');
      loadOperationErrors();
    });
  }

  if (errorsRefreshBtn) {
    errorsRefreshBtn.addEventListener('click', loadOperationErrors);
  }


  if (renameCbzBtn && renameStatusDiv) {
    renameCbzBtn.addEventListener('click', async () => {
      // Show output and start streaming
      renameOutputDiv.classList.remove('hidden');
      renameOutputDiv.innerHTML = '';
      startRenameStream();

      renameCbzBtn.textContent = 'Renaming...';
      renameCbzBtn.disabled = true;
      renameStatusDiv.textContent = 'Starting rename operation...';

      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/rename-cbz`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || 'Rename operation failed');
        }

        // Build comprehensive status message
        let message = `✓ Processed: ${data.processed || 0} file${data.processed !== 1 ? 's' : ''}`;

        if (data.renamed > 0) {
          message += ` | Renamed: ${data.renamed}`;
        }

        if (data.errors > 0) {
          message += ` | ⚠ Errors: ${data.errors}`;
        }

        // Show detailed results if available
        if (data.results && data.results.length > 0) {
          const failures = data.results.filter(r => !r.success);
          if (failures.length > 0) {
            message += '\n\nFailed files:';
            failures.slice(0, 5).forEach(f => {
              const errorMsg = f.error || 'Unknown error';
              message += `\n• ${f.file}: ${errorMsg}`;
            });
            if (failures.length > 5) {
              message += `\n... and ${failures.length - 5} more error${failures.length - 5 !== 1 ? 's' : ''}`;
            }
          }
        }

        renameStatusDiv.textContent = message;
        renameStatusDiv.style.whiteSpace = 'pre-wrap';

        // Set color based on results
        if (data.errors > 0) {
          renameStatusDiv.className = 'text-sm mt-2 text-yellow-400';
        } else {
          renameStatusDiv.className = 'text-sm mt-2 text-green-400';
        }

      } catch (error) {
        
        renameStatusDiv.textContent = `✗ Failed: ${error.message || 'Unknown error occurred'}`;
        renameStatusDiv.className = 'text-sm mt-2 text-red-400';
        renameStatusDiv.style.whiteSpace = 'pre-wrap';
      } finally {
        // Re-enable button quickly
        setTimeout(() => {
          renameCbzBtn.textContent = 'Rename';
          renameCbzBtn.disabled = false;
        }, 1000);

        // Clear status message after longer delay
        setTimeout(() => {
          renameStatusDiv.textContent = '';
          renameStatusDiv.className = 'text-sm mt-2';
          renameStatusDiv.style.whiteSpace = '';
        }, 10000);
      }
    });
  }

  if (moveComicsBtn && moveStatusDiv) {
    moveComicsBtn.addEventListener('click', async () => {
      try {
        // First, get available directories
        const dirRes = await fetch(`${apiBaseUrl}/api/v1/comics-directories`);
        const dirData = await dirRes.json();

        if (!dirRes.ok) {
          throw new Error(dirData.message || 'Failed to get comics directories');
        }

        if (dirData.directories.length === 0) {
          throw new Error('No comics directories configured');
        }

        if (dirData.directories.length === 1) {
          // Only one directory, move automatically
          await performMove(dirData.directories[0].fullPath);
        } else {
          // Multiple directories, show selection modal
          showDirectorySelectionModal(dirData.directories);
        }

      } catch (error) {
        moveStatusDiv.textContent = `Error: ${error.message}`;
        moveStatusDiv.className = 'text-sm mt-2 text-red-400';
        setTimeout(() => {
          moveStatusDiv.textContent = '';
          moveStatusDiv.className = 'text-sm mt-2';
        }, 5000);
      }
    });

    async function performMove(targetDirectory) {
      // Show output and start streaming
      moveOutputDiv.classList.remove('hidden');
      moveOutputDiv.innerHTML = '';
      startMoveStream();

      moveComicsBtn.textContent = 'Moving...';
      moveComicsBtn.disabled = true;
      moveStatusDiv.textContent = 'Starting move operation...';

      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/move-comics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetDirectory })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || 'Move operation failed');
        }

        let message = `Move complete! Processed: ${data.processed}, Moved: ${data.moved}`;
        if (data.errors > 0) {
          message += `, Errors: ${data.errors}`;
        }
        if (data.destDirectory) {
          message += ` to ${data.destDirectory}`;
        }

        moveStatusDiv.textContent = message;
        moveStatusDiv.className = 'text-sm mt-2 text-green-400';

      } catch (error) {
        moveStatusDiv.textContent = `Error: ${error.message}`;
        moveStatusDiv.className = 'text-sm mt-2 text-red-400';
      } finally {
        setTimeout(() => {
          moveComicsBtn.textContent = 'Move Comic';
          moveComicsBtn.disabled = false;
          moveStatusDiv.textContent = '';
          moveStatusDiv.className = 'text-sm mt-2';
        }, 5000);
      }
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
          await performMove(selectedDirectory);
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