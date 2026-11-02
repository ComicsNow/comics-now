import { state, clearElement } from '../../globals.js';
import { createTreeNode } from './tree-node.js';
import {
  currentAccessUser,
  setLibraryTreeData,
  setUserAccessData
} from './state.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => {
  if (el) {
    if (typeof el.replaceChildren === 'function') el.replaceChildren();
    else el.innerHTML = '';
  }
};

export function renderLibraryAccessTree(tree, accessMap, container) {
  if (!container) return;
  clear(container);

  const rootFolders = Object.keys(tree || {}).sort();

  if (rootFolders.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">No content found</div>';
    return;
  }

  rootFolders.forEach(rootFolder => {
    const nodeInfo = tree[rootFolder];
    const rootDiv = createTreeNode('root_folder', rootFolder, nodeInfo, accessMap, null);
    container.appendChild(rootDiv);
  });
}

export async function loadLibraryTreeAndUserAccess(userId) {
  const statusDiv = typeof document !== 'undefined' ? document.getElementById('access-status') : null;
  const treeContainer = typeof document !== 'undefined' ? document.getElementById('access-tree-container') : null;

  try {
    if (statusDiv) statusDiv.textContent = 'Loading library structure and user access...';

    const apiBaseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
    const [treeResponse, accessResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/api/v1/library-tree`),
      fetch(`${apiBaseUrl}/api/v1/users/${userId}/access`)
    ]);

    const treeData = await treeResponse.json();
    const accessData = await accessResponse.json();

    if (!treeResponse.ok) {
      throw new Error(treeData.message || 'Failed to load library tree');
    }

    if (!accessResponse.ok) {
      throw new Error(accessData.message || 'Failed to load user access');
    }

    const libraryTreeData = treeData.tree || {};
    const userAccessData = accessData.access || [];
    setLibraryTreeData(libraryTreeData);
    setUserAccessData(userAccessData);

    const accessMap = new Map();
    userAccessData.forEach(item => {
      const key = `${item.accessType}:${item.accessValue}`;
      accessMap.set(key, {
        direct: item.direct_access === 1 || item.direct_access === true,
        child: item.child_access === 1 || item.child_access === true
      });
    });

    if (treeContainer) {
      renderLibraryAccessTree(libraryTreeData, accessMap, treeContainer);
    }
    if (statusDiv) statusDiv.textContent = '';

  } catch (error) {
    if (statusDiv) {
      statusDiv.textContent = `Error: ${error.message}`;
      statusDiv.className = 'text-sm text-red-400';
    }
    if (treeContainer) {
      treeContainer.innerHTML = '<div class="text-center text-red-400 py-4">Failed to load library data</div>';
    }
  }
}

export function toggleAllAccess(selectAll) {
  const treeContainer = typeof document !== 'undefined' ? document.getElementById('access-tree-container') : null;
  if (!treeContainer) return;

  treeContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.checked = selectAll;
  });
}

export async function saveUserAccess() {
  const statusDiv = typeof document !== 'undefined' ? document.getElementById('access-status') : null;
  const saveBtn = typeof document !== 'undefined' ? document.getElementById('save-access-btn') : null;

  if (!currentAccessUser) return;

  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }
    if (statusDiv) {
      statusDiv.textContent = 'Saving access permissions...';
      statusDiv.className = 'text-sm text-gray-400';
    }

    const accessMap = new Map();

    const checkboxes = typeof document !== 'undefined'
      ? document.querySelectorAll('#access-tree-container input[type="checkbox"]')
      : [];

    checkboxes.forEach(checkbox => {
      const accessType = checkbox.dataset.accessType;
      const accessValue = checkbox.dataset.accessValue;
      const accessMode = checkbox.dataset.accessMode;
      const key = `${accessType}:${accessValue}`;

      if (accessMode === 'recursive') {
        return;
      }

      if (!accessMap.has(key)) {
        accessMap.set(key, {
          accessType,
          accessValue,
          direct_access: false,
          child_access: false
        });
      }

      const item = accessMap.get(key);
      if (accessMode === 'direct') {
        item.direct_access = item.direct_access || checkbox.checked;
      } else if (accessMode === 'child') {
        item.child_access = item.child_access || checkbox.checked;
      } else if (accessMode === 'both') {
        item.direct_access = item.direct_access || checkbox.checked;
        item.child_access = item.child_access || checkbox.checked;
      }
    });

    const access = Array.from(accessMap.values()).filter(item =>
      item.direct_access || item.child_access
    );

    const apiBaseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
    const response = await fetch(`${apiBaseUrl}/api/v1/users/${currentAccessUser.userId}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to save access permissions');
    }

    if (statusDiv) {
      statusDiv.textContent = 'Access permissions saved successfully!';
      statusDiv.className = 'text-sm text-green-400';
    }

    setTimeout(() => {
      const hideFn = state?.hideUserAccessView || (typeof window !== 'undefined' ? window.hideUserAccessView : null);
      if (typeof hideFn === 'function') hideFn();
      const refreshUsersList = state?.refreshUsersList || (typeof window !== 'undefined' ? window.refreshUsersList : null);
      if (typeof refreshUsersList === 'function') {
        refreshUsersList();
      }
    }, 1500);

  } catch (error) {
    if (statusDiv) {
      statusDiv.textContent = `Error: ${error.message}`;
      statusDiv.className = 'text-sm text-red-400';
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Access';
    }
  }
}
