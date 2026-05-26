import { state, escapeHtml } from '../globals.js';

// --- USER LIBRARY ACCESS MANAGEMENT ---
let currentAccessUser = null;
let libraryTreeData = null;
let userAccessData = null;

export async function showUserAccessView(userId, userEmail, userRole) {
  if (userRole === 'admin') {
    alert('Admin users have full access to all libraries automatically.');
    return;
  }

  currentAccessUser = { userId, userEmail, userRole };

  // Hide users list, show access view
  const usersListDiv = state.usersListDiv || window.usersListDiv;
  const setUsersStatus = state.setUsersStatus || window.setUsersStatus;

  if (usersListDiv) {
    usersListDiv.classList.add('hidden');
  }
  if (typeof setUsersStatus === 'function') {
    setUsersStatus('', 'info', false);
  }

  // Create access view UI
  const accessView = document.createElement('div');
  accessView.id = 'user-access-view';
  accessView.className = 'bg-gradient-to-r from-purple-900/30 to-blue-900/30 border-2 border-purple-700/50 rounded-xl p-6 shadow-lg transition-all duration-300';
  accessView.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div class="flex-1">
        <button id="back-to-users-btn" class="flex items-center text-gray-400 hover:text-white transition-colors mb-4 group">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-1 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Users
        </button>
        <div class="flex items-center">
          <div class="bg-purple-600/20 p-2 rounded-lg mr-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h3 class="text-xl font-bold text-white">Library Access for ${escapeHtml(userEmail)}</h3>
            <p class="text-sm text-gray-400">Configure content permissions</p>
          </div>
        </div>
      </div>
    </div>

    <div id="access-status" class="text-sm text-purple-400 mb-4 pl-14"></div>

    <div class="space-y-6">
      <!-- Collapsible Guide -->
      <div class="pl-14">
        <button id="access-guide-toggle" class="text-xs font-bold uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-2" aria-expanded="false">
          <span>How to Use Library Access</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div id="access-guide-content" class="hidden mt-4 bg-black/30 rounded-xl p-5 border border-purple-500/20 text-sm">
          <h5 class="font-bold text-white mb-3">Understanding Access Control</h5>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-3">
              <div>
                <h6 class="font-bold text-purple-400 text-xs uppercase mb-1">📚 Library Level</h6>
                <p class="text-gray-400 text-xs">Grant or deny access to entire root library folders.</p>
              </div>
              <div>
                <h6 class="font-bold text-green-400 text-xs uppercase mb-1">🏢 Publisher Level</h6>
                <p class="text-gray-400 text-xs">Control access to all comics from a specific publisher.</p>
              </div>
            </div>
            
            <div class="space-y-3">
              <div>
                <h6 class="font-bold text-blue-400 text-xs uppercase mb-1">📖 Series Level</h6>
                <p class="text-gray-400 text-xs">Fine-tune access to specific series.</p>
              </div>
              <div>
                <h6 class="font-bold text-yellow-400 text-xs uppercase mb-1">📕 Comic Level</h6>
                <p class="text-gray-400 text-xs">Grant or revoke access to individual comic books.</p>
              </div>
            </div>
          </div>

          <div class="mt-4 pt-4 border-t border-purple-500/20">
            <h6 class="font-bold text-white text-xs uppercase mb-2">Checkboxes:</h6>
            <div class="flex flex-wrap gap-4">
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-blue-600 rounded text-[10px] font-bold">D</span>
                <span class="text-xs text-gray-400">Direct (This item only)</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-yellow-600 rounded text-[10px] font-bold">R</span>
                <span class="text-xs text-gray-400">Recursive (All siblings)</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-purple-600 rounded text-[10px] font-bold">C</span>
                <span class="text-xs text-gray-400">Child (All descendants)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-black/20 rounded-xl border border-purple-500/30 overflow-hidden">
        <div class="flex items-center justify-between p-4 border-b border-purple-500/20 bg-purple-900/10">
          <h4 class="font-bold text-white text-sm uppercase tracking-wider">Content Hierarchy</h4>
          <div class="flex gap-2">
            <button id="select-all-btn" class="text-[10px] font-bold uppercase tracking-widest bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors border border-gray-700">
              Select All
            </button>
            <button id="deselect-all-btn" class="text-[10px] font-bold uppercase tracking-widest bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors border border-gray-700">
              Deselect All
            </button>
          </div>
        </div>

        <div id="access-tree-container" class="p-4 space-y-2 max-h-[50vh] overflow-y-auto scrollbar-thin scrollbar-thumb-purple-600/50 scrollbar-track-transparent">
          <div class="text-center text-gray-400 py-8 animate-pulse">Loading library structure...</div>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-purple-500/20">
        <button id="cancel-access-btn" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2.5 px-6 rounded-full transition-all border border-gray-600 shadow-lg">
          Cancel
        </button>
        <button id="save-access-btn" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-8 rounded-full transition-all shadow-lg hover:shadow-purple-900/40">
          Save Access
        </button>
      </div>
    </div>
  `;

  if (usersListDiv && usersListDiv.parentElement) {
    usersListDiv.parentElement.appendChild(accessView);
  }

  // Add event listeners
  document.getElementById('back-to-users-btn').addEventListener('click', hideUserAccessView);
  document.getElementById('cancel-access-btn').addEventListener('click', hideUserAccessView);
  document.getElementById('save-access-btn').addEventListener('click', saveUserAccess);
  document.getElementById('select-all-btn').addEventListener('click', () => toggleAllAccess(true));
  document.getElementById('deselect-all-btn').addEventListener('click', () => toggleAllAccess(false));

  // Add guide toggle listener
  const guideToggle = document.getElementById('access-guide-toggle');
  const guideContent = document.getElementById('access-guide-content');
  if (guideToggle && guideContent) {
    guideToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const isExpanded = guideToggle.getAttribute('aria-expanded') === 'true';
      const textSpan = guideToggle.querySelector('span');
      const arrowSvg = guideToggle.querySelector('svg');

      if (isExpanded) {
        guideContent.classList.add('hidden');
        guideToggle.setAttribute('aria-expanded', 'false');
        if (textSpan) textSpan.textContent = 'How to Use Library Access';
        if (arrowSvg) arrowSvg.classList.remove('rotate-180');
      } else {
        guideContent.classList.remove('hidden');
        guideToggle.setAttribute('aria-expanded', 'true');
        if (textSpan) textSpan.textContent = 'Hide Guide';
        if (arrowSvg) arrowSvg.classList.add('rotate-180');
      }
    });
  }

  // Load data
  await loadLibraryTreeAndUserAccess(userId);
}

export function hideUserAccessView() {
  const accessView = document.getElementById('user-access-view');
  if (accessView) {
    accessView.remove();
  }
  const usersListDiv = state.usersListDiv || window.usersListDiv;
  if (usersListDiv) {
    usersListDiv.classList.remove('hidden');
  }
  currentAccessUser = null;
  libraryTreeData = null;
  userAccessData = null;
}

export async function loadLibraryTreeAndUserAccess(userId) {
  const statusDiv = document.getElementById('access-status');
  const treeContainer = document.getElementById('access-tree-container');

  try {
    statusDiv.textContent = 'Loading library structure and user access...';

    // Load library tree and user access in parallel
    const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
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

    libraryTreeData = treeData.tree || {};
    userAccessData = accessData.access || [];

    // Build access lookup map with direct/child flags
    const accessMap = new Map();
    userAccessData.forEach(item => {
      const key = `${item.accessType}:${item.accessValue}`;
      accessMap.set(key, {
        direct: item.direct_access === 1 || item.direct_access === true,
        child: item.child_access === 1 || item.child_access === true
      });
    });

    // Render tree
    renderLibraryAccessTree(libraryTreeData, accessMap, treeContainer);
    statusDiv.textContent = '';

  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'text-sm text-red-400';
    treeContainer.innerHTML = '<div class="text-center text-red-400 py-4">Failed to load library data</div>';
  }
}

export function renderLibraryAccessTree(tree, accessMap, container) {
  container.innerHTML = '';

  const rootFolders = Object.keys(tree).sort();

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

export function bubbleUncheck(nodeDiv) {
  if (!nodeDiv) return;
  const parentNode = nodeDiv.parentElement.closest('.border');
  if (parentNode) {
    const parentChildCheckbox = parentNode.querySelector('input[data-access-mode="child"]');
    if (parentChildCheckbox && parentChildCheckbox.checked) {
      parentChildCheckbox.checked = false;
      bubbleUncheck(parentNode);
    }
  }
}

export function createTreeNode(type, value, nodeInfo, accessMap, parentNodeDiv, hasParentChildAccess = false) {
  const key = `${type}:${value}`;
  const access = accessMap.get(key) || { direct: false, child: false };
  const isLeaf = type === 'comic'; // Comics are leaf nodes

  // Determine if this node has children
  let hasChildren = false;
  if (type === 'root_folder') {
    const children = nodeInfo?.children || {};
    hasChildren = Object.keys(children).length > 0;
  } else if (type === 'publisher' || type === 'folder') {
    const children = nodeInfo?.children || nodeInfo || {};
    hasChildren = Object.keys(children).length > 0;
  } else if (type === 'series') {
    hasChildren = Array.isArray(nodeInfo) && nodeInfo.length > 0;
  }

  // Effective state based on database + parent inheritance
  const isDirectChecked = hasParentChildAccess || access.direct;
  const isChildChecked = hasParentChildAccess || access.child;

  const nodeDiv = document.createElement('div');
  nodeDiv.className = 'border border-gray-700 rounded-lg overflow-hidden mb-2';

  // Create header
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 p-3 bg-gray-900 hover:bg-gray-800 transition-colors';

  // For non-leaf nodes: show three checkboxes (Direct, Recursive, Child)
  // For leaf nodes (comics): show single checkbox
  if (!isLeaf && hasChildren) {
    // Three checkboxes container
    const checkboxesContainer = document.createElement('div');
    checkboxesContainer.className = 'flex flex-col gap-1';

    // Direct access checkbox (D)
    const directCheckbox = document.createElement('input');
    directCheckbox.type = 'checkbox';
    directCheckbox.checked = isDirectChecked;
    directCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-1';
    directCheckbox.dataset.accessType = type;
    directCheckbox.dataset.accessValue = value;
    directCheckbox.dataset.accessMode = 'direct';
    directCheckbox.title = 'Direct access (this item only)';

    // Add event listener to direct checkbox to check children if it's a series or folder
    directCheckbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (directCheckbox.checked && (type === 'series' || type === 'folder')) {
        const childrenContainer = nodeDiv.querySelector('.children-container');
        if (childrenContainer) {
          childrenContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            if (checkbox.dataset.accessMode !== 'recursive') checkbox.checked = true;
          });
        }
      } else if (!directCheckbox.checked) {
        if (type === 'series' || type === 'folder') {
          const childrenContainer = nodeDiv.querySelector('.children-container');
          if (childrenContainer) {
            childrenContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
              if (checkbox.dataset.accessMode !== 'recursive') checkbox.checked = false;
            });
          }
        }
        bubbleUncheck(nodeDiv);
      }
    });

    // Recursive checkbox (R) - UI helper to select all siblings
    const recursiveCheckbox = document.createElement('input');
    recursiveCheckbox.type = 'checkbox';
    recursiveCheckbox.checked = false; // Never checked by default (UI helper only)
    recursiveCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-yellow-600 focus:ring-yellow-500 focus:ring-1';
    recursiveCheckbox.dataset.accessType = type;
    recursiveCheckbox.dataset.accessValue = value;
    recursiveCheckbox.dataset.accessMode = 'recursive';
    recursiveCheckbox.title = 'Recursive (select all siblings at this level)';

    // Child access checkbox (C)
    const childCheckbox = document.createElement('input');
    childCheckbox.type = 'checkbox';
    childCheckbox.checked = isChildChecked;
    childCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-purple-600 focus:ring-purple-500 focus:ring-1';
    childCheckbox.dataset.accessType = type;
    childCheckbox.dataset.accessValue = value;
    childCheckbox.dataset.accessMode = 'child';
    childCheckbox.title = 'Child access (all descendants)';

    checkboxesContainer.appendChild(directCheckbox);
    checkboxesContainer.appendChild(recursiveCheckbox);
    checkboxesContainer.appendChild(childCheckbox);
    header.appendChild(checkboxesContainer);

    // Add event listener to recursive checkbox to select all siblings
    recursiveCheckbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (parentNodeDiv) {
        // Find all sibling nodes at the same level
        const siblingsContainer = parentNodeDiv.querySelector('.children-container');
        if (siblingsContainer) {
          // Find all direct child nodes (siblings of this node)
          siblingsContainer.querySelectorAll(':scope > .border').forEach(siblingNode => {
            // Find both Direct and Child checkboxes in each sibling
            const siblingDirectCheckbox = siblingNode.querySelector('input[data-access-mode="direct"]');
            const siblingChildCheckbox = siblingNode.querySelector('input[data-access-mode="child"]');
            
            if (siblingDirectCheckbox) {
              siblingDirectCheckbox.checked = recursiveCheckbox.checked;
            }
            if (siblingChildCheckbox) {
              siblingChildCheckbox.checked = recursiveCheckbox.checked;
            }

            // If checking siblings, we should also auto-check their internal children
            if (recursiveCheckbox.checked) {
               const siblingInternalContainer = siblingNode.querySelector('.children-container');
               if (siblingInternalContainer) {
                  siblingInternalContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    if (cb.dataset.accessMode !== 'recursive') cb.checked = true;
                  });
               }
            }
          });
        }
      }
    });

    // Add event listener to child checkbox to cascade down and auto-check parent D
    childCheckbox.addEventListener('change', (e) => {
      e.stopPropagation();

      if (childCheckbox.checked) {
        // Auto-check Direct on this same node
        directCheckbox.checked = true;

        // Recursively check all D and C on all descendants
        const childrenContainer = nodeDiv.querySelector('.children-container');
        if (childrenContainer) {
          childrenContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            const mode = checkbox.dataset.accessMode;
            if (mode === 'direct' || mode === 'child' || mode === 'both') {
              checkbox.checked = true;
            }
          });
        }
      } else {
        // Uncheck C: uncheck all descendant D and C
        const childrenContainer = nodeDiv.querySelector('.children-container');
        if (childrenContainer) {
          childrenContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            const mode = checkbox.dataset.accessMode;
            if (mode === 'direct' || mode === 'child' || mode === 'both') {
              checkbox.checked = false;
            }
          });
        }
        bubbleUncheck(nodeDiv);
      }
    });

    // Add labels for the checkboxes
    const labelsContainer = document.createElement('div');
    labelsContainer.className = 'flex flex-col text-xs text-gray-500';
    labelsContainer.innerHTML = '<span>D</span><span>R</span><span>C</span>';
    header.appendChild(labelsContainer);

  } else {
    // Single checkbox for leaf nodes or nodes without children
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isDirectChecked || isChildChecked;
    checkbox.className = 'w-4 h-4 rounded border-gray-600 text-purple-600 focus:ring-purple-500 focus:ring-2';
    checkbox.dataset.accessType = type;
    checkbox.dataset.accessValue = value;
    checkbox.dataset.accessMode = 'both';
    header.appendChild(checkbox);

    checkbox.addEventListener('change', () => {
      if (!checkbox.checked) {
        bubbleUncheck(nodeDiv);
      }
    });
  }

  // Label
  const label = document.createElement('label');
  label.className = 'flex-1 text-white cursor-pointer text-sm';
  if (type === 'root_folder') {
    label.textContent = value;
  } else if (type === 'publisher' || type === 'series') {
    label.textContent = value;
  } else if (type === 'folder') {
    label.textContent = value.replace(/\\/g, '/').split('/').pop();
  } else if (type === 'comic') {
    label.textContent = nodeInfo?.name || value;
  }
  header.appendChild(label);

  // Expand icon (only for non-leaf nodes with children)
  if (hasChildren && !isLeaf) {
    const expandIcon = document.createElement('span');
    expandIcon.className = 'text-gray-400 transition-transform cursor-pointer';
    expandIcon.innerHTML = '▼';
    header.appendChild(expandIcon);

    // Toggle expansion on header click
    header.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        const childrenContainer = nodeDiv.querySelector('.children-container');
        if (childrenContainer) {
          childrenContainer.classList.toggle('hidden');
          expandIcon.classList.toggle('rotate-180');
        }
      }
    });
  }

  nodeDiv.appendChild(header);

  // Create children container
  if (hasChildren && !isLeaf) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'children-container pl-6 pr-3 pb-2 bg-gray-900 hidden';

    if (type === 'root_folder') {
      const mode = nodeInfo.mode;
      const children = nodeInfo.children || {};
      if (mode === 'metadata') {
        Object.keys(children).sort().forEach(publisher => {
          const series = children[publisher];
          const publisherNode = createTreeNode('publisher', publisher, series, accessMap, nodeDiv, isChildChecked);
          childrenContainer.appendChild(publisherNode);
        });
      } else if (mode === 'folder') {
        Object.keys(children).sort().forEach(key => {
          const childNodeInfo = children[key];
          if (childNodeInfo.type === 'folder') {
            const folderNode = createTreeNode('folder', childNodeInfo.path, childNodeInfo, accessMap, nodeDiv, isChildChecked);
            childrenContainer.appendChild(folderNode);
          } else if (childNodeInfo.type === 'comic') {
            const comicNode = createTreeNode('comic', childNodeInfo.id, childNodeInfo, accessMap, nodeDiv, isChildChecked);
            childrenContainer.appendChild(comicNode);
          }
        });
      }
    } else if (type === 'publisher') {
      Object.keys(nodeInfo).sort().forEach(seriesName => {
        const comics = nodeInfo[seriesName];
        const seriesNode = createTreeNode('series', seriesName, comics, accessMap, nodeDiv, isChildChecked);
        childrenContainer.appendChild(seriesNode);
      });
    } else if (type === 'series') {
      if (Array.isArray(nodeInfo)) {
        nodeInfo.forEach(comic => {
          const comicNode = createTreeNode('comic', comic, null, accessMap, nodeDiv, isChildChecked);
          childrenContainer.appendChild(comicNode);
        });
      }
    } else if (type === 'folder') {
      const children = nodeInfo.children || {};
      Object.keys(children).sort().forEach(key => {
        const childNodeInfo = children[key];
        if (childNodeInfo.type === 'folder') {
          const folderNode = createTreeNode('folder', childNodeInfo.path, childNodeInfo, accessMap, nodeDiv, isChildChecked);
          childrenContainer.appendChild(folderNode);
        } else if (childNodeInfo.type === 'comic') {
          const comicNode = createTreeNode('comic', childNodeInfo.id, childNodeInfo, accessMap, nodeDiv, isChildChecked);
          childrenContainer.appendChild(comicNode);
        }
      });
    }

    nodeDiv.appendChild(childrenContainer);
  }

  return nodeDiv;
}

export function toggleAllAccess(selectAll) {
  const treeContainer = document.getElementById('access-tree-container');
  if (!treeContainer) return;

  treeContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.checked = selectAll;
  });
}

export async function saveUserAccess() {
  const statusDiv = document.getElementById('access-status');
  const saveBtn = document.getElementById('save-access-btn');

  if (!currentAccessUser) return;

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusDiv.textContent = 'Saving access permissions...';
    statusDiv.className = 'text-sm text-gray-400';

    // Collect access data from checkboxes
    // Group by accessType:accessValue to combine direct/child
    // Skip 'recursive' mode as it's UI-only (not saved to database)
    const accessMap = new Map();

    document.querySelectorAll('#access-tree-container input[type="checkbox"]').forEach(checkbox => {
      const accessType = checkbox.dataset.accessType;
      const accessValue = checkbox.dataset.accessValue;
      const accessMode = checkbox.dataset.accessMode;
      const key = `${accessType}:${accessValue}`;

      // Skip recursive checkbox - it's just a UI helper
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
        item.direct_access = checkbox.checked;
      } else if (accessMode === 'child') {
        item.child_access = checkbox.checked;
      } else if (accessMode === 'both') {
        // For leaf nodes (comics)
        item.direct_access = checkbox.checked;
        item.child_access = checkbox.checked;
      }
    });

    // Convert map to array, filtering out items with no access
    const access = Array.from(accessMap.values()).filter(item =>
      item.direct_access || item.child_access
    );

    const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
    const response = await fetch(`${apiBaseUrl}/api/v1/users/${currentAccessUser.userId}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to save access permissions');
    }

    statusDiv.textContent = 'Access permissions saved successfully!';
    statusDiv.className = 'text-sm text-green-400';

    setTimeout(() => {
      hideUserAccessView();
      const refreshUsersList = state.refreshUsersList || window.refreshUsersList;
      if (typeof refreshUsersList === 'function') {
        refreshUsersList();
      }
    }, 1500);

  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'text-sm text-red-400';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Access';
  }
}

state.showUserAccessView = showUserAccessView;
state.hideUserAccessView = hideUserAccessView;
state.loadLibraryTreeAndUserAccess = loadLibraryTreeAndUserAccess;
state.renderLibraryAccessTree = renderLibraryAccessTree;
state.bubbleUncheck = bubbleUncheck;
state.createTreeNode = createTreeNode;
state.toggleAllAccess = toggleAllAccess;
state.saveUserAccess = saveUserAccess;

if (typeof window !== 'undefined') {
  window.showUserAccessView = showUserAccessView;
  window.hideUserAccessView = hideUserAccessView;
  window.loadLibraryTreeAndUserAccess = loadLibraryTreeAndUserAccess;
  window.renderLibraryAccessTree = renderLibraryAccessTree;
  window.bubbleUncheck = bubbleUncheck;
  window.createTreeNode = createTreeNode;
  window.toggleAllAccess = toggleAllAccess;
  window.saveUserAccess = saveUserAccess;
}