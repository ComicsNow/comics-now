/**
 * Comics Now! - Comics Management Facade
 *
 * Coordinates file renaming, directory relocation streams, safety modals, and rule configurations.
 */

import { state } from '../globals.js';
import {
  promptSafetyConfirmation,
  loadOperationErrors,
  populateLibrarySelects,
  showDirectorySelectionModal
} from './management/dialogs.js';
import {
  startRenameStream,
  stopRenameStream,
  runRename
} from './management/rename-stream.js';
import {
  startMoveStream,
  stopMoveStream,
  performMove
} from './management/move-stream.js';
import {
  loadNamingRules,
  renderNamingTokens,
  updateNamingPreview,
  saveNamingRules,
  loadFolderRules,
  renderFolderLevels,
  updateFolderPreview,
  saveFolderRules,
  folderRulesState
} from './management/rules.js';

export {
  startRenameStream,
  stopRenameStream,
  startMoveStream,
  stopMoveStream,
  runRename,
  performMove,
  promptSafetyConfirmation,
  showDirectorySelectionModal,
  loadOperationErrors,
  populateLibrarySelects,
  loadNamingRules,
  loadFolderRules
};

export function initComicsManagement() {
  const apiBaseUrl = (typeof state !== 'undefined' && state.API_BASE_URL) ||
                     (typeof window !== 'undefined' && window.API_BASE_URL) || '';

  const renameCbzBtn = document.getElementById('rename-cbz-btn');
  const renameStatusDiv = document.getElementById('rename-status');
  const renameOutputDiv = document.getElementById('rename-output');
  const renameClearBtn = document.getElementById('rename-clear-output');
  const moveComicsBtn = document.getElementById('move-comics-btn');
  const moveStatusDiv = document.getElementById('move-status');
  const moveOutputDiv = document.getElementById('move-output');
  const moveClearBtn = document.getElementById('move-clear-output');

  // Clear output buttons
  if (renameClearBtn && renameOutputDiv) {
    renameClearBtn.addEventListener('click', async () => {
      if (typeof renameOutputDiv.replaceChildren === 'function') renameOutputDiv.replaceChildren();
      else renameOutputDiv.innerHTML = '';
      renameOutputDiv.classList.add('hidden');
      try {
        await fetch(`${apiBaseUrl}/api/v1/rename/clear`, { method: 'POST' });
      } catch (_) {}
    });
  }

  if (moveClearBtn && moveOutputDiv) {
    moveClearBtn.addEventListener('click', async () => {
      if (typeof moveOutputDiv.replaceChildren === 'function') moveOutputDiv.replaceChildren();
      else moveOutputDiv.innerHTML = '';
      moveOutputDiv.classList.add('hidden');
      try {
        await fetch(`${apiBaseUrl}/api/v1/move/clear`, { method: 'POST' });
      } catch (_) {}
    });
  }

  // Sub-tabs navigation
  const mgmtTabOperations = document.getElementById('mgmt-tab-operations');
  const mgmtTabErrors = document.getElementById('mgmt-tab-errors');
  const mgmtTabName = document.getElementById('mgmt-tab-name');
  const mgmtTabFolder = document.getElementById('mgmt-tab-folder');
  const mgmtContentOperations = document.getElementById('mgmt-content-operations');
  const mgmtContentErrors = document.getElementById('mgmt-content-errors');
  const mgmtContentName = document.getElementById('mgmt-content-name');
  const mgmtContentFolder = document.getElementById('mgmt-content-folder');
  const errorsList = document.getElementById('errors-list');
  const errorsRefreshBtn = document.getElementById('errors-refresh-btn');

  if (errorsRefreshBtn && errorsList) {
    errorsRefreshBtn.addEventListener('click', () => loadOperationErrors(errorsList, apiBaseUrl));
  }

  populateLibrarySelects(apiBaseUrl);

  const mgmtTabs = [
    { tab: mgmtTabOperations, panel: mgmtContentOperations, onShow: null },
    { tab: mgmtTabErrors, panel: mgmtContentErrors, onShow: () => loadOperationErrors(errorsList, apiBaseUrl) },
    { tab: mgmtTabName, panel: mgmtContentName, onShow: () => populateLibrarySelects(apiBaseUrl) },
    { tab: mgmtTabFolder, panel: mgmtContentFolder, onShow: () => populateLibrarySelects(apiBaseUrl) }
  ].filter(entry => entry.tab && entry.panel);

  mgmtTabs.forEach(({ tab, panel, onShow }) => {
    tab.addEventListener('click', () => {
      const ctContentMgmt = document.getElementById('ct-content-management');
      if (ctContentMgmt) {
        ['ct-content-output', 'ct-content-matches', 'ct-content-settings', 'ct-content-gemini', 'ct-content-logs'].forEach(id => {
          document.getElementById(id)?.classList.add('hidden');
        });
        ctContentMgmt.classList.remove('hidden');
      }
      ['ct-tab-output', 'ct-tab-matches', 'ct-tab-settings', 'ct-tab-gemini', 'ct-tab-logs'].forEach(id => {
        document.getElementById(id)?.classList.remove('active');
      });

      mgmtTabs.forEach(other => {
        const isActive = other.tab === tab;
        other.tab.classList.toggle('active', isActive);
        other.panel.classList.toggle('hidden', !isActive);
      });
      if (typeof onShow === 'function') onShow();
    });
  });

  // Naming & folder rules
  const saveNamingRulesBtn = document.getElementById('save-naming-rules-btn');
  if (saveNamingRulesBtn) {
    saveNamingRulesBtn.addEventListener('click', () => saveNamingRules(apiBaseUrl, saveNamingRulesBtn));
  }

  const addFolderLevelBtn = document.getElementById('add-folder-level-btn');
  const addFolderTokenSelect = document.getElementById('add-folder-token-select');
  if (addFolderLevelBtn && addFolderTokenSelect) {
    addFolderLevelBtn.addEventListener('click', () => {
      const val = addFolderTokenSelect.value;
      if (val) {
        folderRulesState.hierarchy.push(val);
        renderFolderLevels(apiBaseUrl);
        updateFolderPreview(apiBaseUrl);
      }
    });
  }

  const saveFolderRulesBtn = document.getElementById('save-folder-rules-btn');
  if (saveFolderRulesBtn) {
    saveFolderRulesBtn.addEventListener('click', () => saveFolderRules(apiBaseUrl, saveFolderRulesBtn));
  }

  loadNamingRules(apiBaseUrl);
  loadFolderRules(apiBaseUrl);

  // Operations tab: rename inbox comics
  if (renameCbzBtn && renameStatusDiv) {
    renameCbzBtn.addEventListener('click', () => runRename({}, renameCbzBtn, apiBaseUrl));
  }

  // Name tab: rename entire library
  const renameLibraryBtn = document.getElementById('rename-library-btn');
  const renameLibrarySelect = document.getElementById('rename-library-select');
  if (renameLibraryBtn) {
    renameLibraryBtn.addEventListener('click', () => {
      const libraryPath = renameLibrarySelect ? renameLibrarySelect.value : '';
      if (!libraryPath) {
        if (renameStatusDiv) {
          renameStatusDiv.textContent = 'Select a library first.';
          renameStatusDiv.className = 'text-xs mt-2 text-yellow-400';
        }
        return;
      }
      promptSafetyConfirmation(
        'Rename Entire Library',
        'This will rename EVERY comic in the selected library using your saved naming rules. This action cannot be easily undone.',
        (confirmation) => {
          if (mgmtTabOperations) mgmtTabOperations.click();
          runRename({ libraryPath, confirmation }, renameLibraryBtn, apiBaseUrl);
        }
      );
    });
  }

  // Operations tab: move inbox comics into library
  if (moveComicsBtn && moveStatusDiv) {
    moveComicsBtn.addEventListener('click', async () => {
      try {
        const dirRes = await fetch(`${apiBaseUrl}/api/v1/comics-directories`);
        const dirData = await dirRes.json();
        if (!dirRes.ok) throw new Error(dirData.message || 'Failed to get comics directories');
        const destinations = (dirData.directories || []).filter(dir => !dir.isInbox);
        if (destinations.length === 0) throw new Error('No destination libraries configured');
        if (destinations.length === 1) {
          await performMove({ targetDirectory: destinations[0].fullPath }, moveComicsBtn, apiBaseUrl);
        } else {
          showDirectorySelectionModal(destinations, (targetDirectory) => {
            return performMove({ targetDirectory }, moveComicsBtn, apiBaseUrl);
          });
        }
      } catch (error) {
        moveStatusDiv.textContent = `Error: ${error.message}`;
        moveStatusDiv.className = 'text-xs mt-2 text-red-400';
      }
    });

    // Folder tab: reorganize entire library
    const moveLibraryBtn = document.getElementById('move-library-btn');
    const moveLibrarySelect = document.getElementById('move-library-select');
    if (moveLibraryBtn) {
      moveLibraryBtn.addEventListener('click', () => {
        const libraryPath = moveLibrarySelect ? moveLibrarySelect.value : '';
        if (!libraryPath) {
          moveStatusDiv.textContent = 'Select a library first.';
          moveStatusDiv.className = 'text-xs mt-2 text-yellow-400';
          return;
        }
        promptSafetyConfirmation(
          'Reorganize Entire Library',
          'This will move & reorganize EVERY comic in the selected library into your saved folder hierarchy. This action cannot be easily undone.',
          (confirmation) => {
            if (mgmtTabOperations) mgmtTabOperations.click();
            performMove({ libraryPath, confirmation }, moveLibraryBtn, apiBaseUrl);
          }
        );
      });
    }
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initComicsManagement);
  } else {
    initComicsManagement();
  }
}

if (typeof state !== 'undefined') {
  state.startRenameStream = startRenameStream;
  state.stopRenameStream = stopRenameStream;
  state.startMoveStream = startMoveStream;
  state.stopMoveStream = stopMoveStream;
}

if (typeof window !== 'undefined') {
  window.startRenameStream = startRenameStream;
  window.stopRenameStream = stopRenameStream;
  window.startMoveStream = startMoveStream;
  window.stopMoveStream = stopMoveStream;
}
