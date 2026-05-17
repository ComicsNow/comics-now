// --- CONTINUOUS MODE SETTINGS ---
async function loadContinuousModeDefaults() {
  const toggleCheckbox = document.getElementById('continuous-mode-default-toggle');
  const labelPaginated = document.getElementById('continuous-mode-label-paginated');
  const labelContinuous = document.getElementById('continuous-mode-label-continuous');
  const currentValue = document.getElementById('continuous-mode-current-value');
  const loadingIndicator = document.getElementById('continuous-mode-loading');
  const statusMessage = document.getElementById('continuous-mode-status');

  if (!toggleCheckbox) return;

  // Function to update label visual state
  function updateLabels(enabled) {
    if (enabled) {
      // Continuous Mode - highlight Continuous label
      if (labelPaginated) {
        labelPaginated.classList.remove('text-white', 'scale-110');
        labelPaginated.classList.add('text-gray-500', 'scale-100');
      }
      if (labelContinuous) {
        labelContinuous.classList.remove('text-gray-400', 'scale-100');
        labelContinuous.classList.add('text-blue-300', 'scale-110');
      }
      if (currentValue) {
        currentValue.textContent = 'Continuous Scroll View';
        currentValue.classList.remove('text-gray-300');
        currentValue.classList.add('text-blue-300');
      }
    } else {
      // Paginated Mode - highlight Paginated label
      if (labelPaginated) {
        labelPaginated.classList.remove('text-gray-500', 'scale-100');
        labelPaginated.classList.add('text-white', 'scale-110');
      }
      if (labelContinuous) {
        labelContinuous.classList.remove('text-blue-300', 'scale-110');
        labelContinuous.classList.add('text-gray-400', 'scale-100');
      }
      if (currentValue) {
        currentValue.textContent = 'Paginated Reading View';
        currentValue.classList.remove('text-blue-300');
        currentValue.classList.add('text-gray-300');
      }
    }
  }

  try {
    // Load current continuous mode preference from server
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/continuous-mode-preference`);
      const data = await response.json();

      if (response.ok) {
        const isContinuousModeEnabled = data.continuousMode === true;
        toggleCheckbox.checked = isContinuousModeEnabled;
        updateLabels(isContinuousModeEnabled);
      } else {
        toggleCheckbox.checked = false;
        updateLabels(false);
      }
    } catch (error) {
      console.error('Failed to load continuous mode preference:', error);
      toggleCheckbox.checked = false;
      updateLabels(false);
    }

    // Handle checkbox change events
    toggleCheckbox.addEventListener('change', async (e) => {
      const enabled = e.target.checked;

      // Disable toggle during processing
      toggleCheckbox.disabled = true;

      // Show loading indicator
      if (loadingIndicator) {
        loadingIndicator.classList.remove('hidden');
      }

      // Hide any previous status message
      if (statusMessage) {
        statusMessage.classList.add('hidden');
      }

      try {
        // Call API to set continuous mode for all comics
        const response = await fetch(`${API_BASE_URL}/api/v1/comics/set-all-continuous-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ continuousMode: enabled })
        });

        if (!response.ok) {
          throw new Error('Failed to set continuous mode');
        }

        console.log(`Continuous mode ${enabled ? 'enabled' : 'disabled'} for all comics. Refreshing library...`);

        // Update label visual state
        updateLabels(enabled);

        // Force refresh from server to get updated values
        if (typeof fetchLibraryFromServer === 'function') {
          await fetchLibraryFromServer();
        } else if (typeof fetchLibrary === 'function') {
          await fetchLibrary();
        }

        // Hide loading indicator
        if (loadingIndicator) {
          loadingIndicator.classList.add('hidden');
        }

        // Show success message in the tab
        if (statusMessage) {
          statusMessage.className = 'mt-4 rounded-lg p-3 bg-blue-600/20 border-2 border-blue-500/50 transition-all duration-300';
          statusMessage.innerHTML = `
            <div class="flex items-center text-blue-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="font-medium">Success! Continuous mode ${enabled ? 'enabled' : 'disabled'} for all comics.</span>
            </div>
          `;
          statusMessage.classList.remove('hidden');

          // Auto-hide success message after 5 seconds
          setTimeout(() => {
            if (statusMessage) {
              statusMessage.classList.add('hidden');
            }
          }, 5000);
        }

      } catch (error) {
        console.error('Failed to set continuous mode:', error);

        // Hide loading indicator
        if (loadingIndicator) {
          loadingIndicator.classList.add('hidden');
        }

        // Show error message
        if (statusMessage) {
          statusMessage.className = 'mt-4 rounded-lg p-3 bg-red-600/20 border-2 border-red-500/50 transition-all duration-300';
          statusMessage.innerHTML = `<span class="text-red-400">Error: ${error.message}</span>`;
          statusMessage.classList.remove('hidden');
        }

        // Revert checkbox on error
        e.target.checked = !enabled;
        updateLabels(!enabled);
      } finally {
        // Re-enable toggle
        toggleCheckbox.disabled = false;
      }
    });

  } catch (error) {
    console.error('Failed to load continuous mode defaults:', error);
  }
}

// Setup continuous mode toggle event listener
function initContinuousModeSettings() {
  loadContinuousModeDefaults();
}