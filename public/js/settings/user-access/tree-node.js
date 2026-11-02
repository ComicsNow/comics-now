export function bubbleUncheck(nodeDiv) {
  if (!nodeDiv) return;
  const parentNode = nodeDiv.parentElement?.closest('.border');
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
  const access = accessMap?.get(key) || { direct: false, child: false };
  const isLeaf = type === 'comic';

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

  const isDirectChecked = hasParentChildAccess || access.direct;
  const isChildChecked = hasParentChildAccess || access.child;

  const nodeDiv = document.createElement('div');
  nodeDiv.className = 'border border-gray-700 rounded-lg overflow-hidden mb-2';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 p-3 bg-gray-900 hover:bg-gray-800 transition-colors';

  if (!isLeaf && hasChildren) {
    const checkboxesContainer = document.createElement('div');
    checkboxesContainer.className = 'flex flex-col gap-1';

    const directCheckbox = document.createElement('input');
    directCheckbox.type = 'checkbox';
    directCheckbox.checked = isDirectChecked;
    directCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-1';
    directCheckbox.dataset.accessType = type;
    directCheckbox.dataset.accessValue = value;
    directCheckbox.dataset.accessMode = 'direct';
    directCheckbox.title = 'Direct access (this item only)';

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

    const recursiveCheckbox = document.createElement('input');
    recursiveCheckbox.type = 'checkbox';
    recursiveCheckbox.checked = false;
    recursiveCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-yellow-600 focus:ring-yellow-500 focus:ring-1';
    recursiveCheckbox.dataset.accessType = type;
    recursiveCheckbox.dataset.accessValue = value;
    recursiveCheckbox.dataset.accessMode = 'recursive';
    recursiveCheckbox.title = 'Recursive (select all siblings at this level)';

    const childCheckbox = document.createElement('input');
    childCheckbox.type = 'checkbox';
    childCheckbox.checked = isChildChecked;
    childCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-purple-600 focus:ring-purple-500 focus:ring-1';
    childCheckbox.dataset.accessType = type;
    childCheckbox.dataset.accessValue = value;
    childCheckbox.dataset.accessMode = 'child';
    childCheckbox.title = 'Child access (all descendants)';

    const directLabel = document.createElement('label');
    directLabel.className = 'flex items-center gap-1 cursor-pointer bg-blue-950/60 hover:bg-blue-900/80 border border-blue-700/60 rounded px-1.5 py-0.5 text-blue-300 text-[11px] font-bold select-none shrink-0';
    directLabel.title = 'Direct access (this item only)';
    directLabel.appendChild(directCheckbox);
    const directText = document.createElement('span');
    directText.textContent = 'D';
    directLabel.appendChild(directText);

    const recursiveLabel = document.createElement('label');
    recursiveLabel.className = 'flex items-center gap-1 cursor-pointer bg-amber-950/60 hover:bg-amber-900/80 border border-amber-700/60 rounded px-1.5 py-0.5 text-amber-300 text-[11px] font-bold select-none shrink-0';
    recursiveLabel.title = 'Recursive (select all siblings at this level)';
    recursiveLabel.appendChild(recursiveCheckbox);
    const recursiveText = document.createElement('span');
    recursiveText.textContent = 'R';
    recursiveLabel.appendChild(recursiveText);

    const childLabel = document.createElement('label');
    childLabel.className = 'flex items-center gap-1 cursor-pointer bg-purple-950/60 hover:bg-purple-900/80 border border-purple-700/60 rounded px-1.5 py-0.5 text-purple-300 text-[11px] font-bold select-none shrink-0';
    childLabel.title = 'Child access (all descendants)';
    childLabel.appendChild(childCheckbox);
    const childText = document.createElement('span');
    childText.textContent = 'C';
    childLabel.appendChild(childText);

    checkboxesContainer.appendChild(directLabel);
    checkboxesContainer.appendChild(recursiveLabel);
    checkboxesContainer.appendChild(childLabel);
    header.appendChild(checkboxesContainer);

    recursiveCheckbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (parentNodeDiv) {
        const siblingsContainer = parentNodeDiv.querySelector('.children-container');
        if (siblingsContainer) {
          siblingsContainer.querySelectorAll(':scope > .border').forEach(siblingNode => {
            const siblingDirectCheckbox = siblingNode.querySelector('input[data-access-mode="direct"]');
            const siblingChildCheckbox = siblingNode.querySelector('input[data-access-mode="child"]');
            
            if (siblingDirectCheckbox) {
              siblingDirectCheckbox.checked = recursiveCheckbox.checked;
            }
            if (siblingChildCheckbox) {
              siblingChildCheckbox.checked = recursiveCheckbox.checked;
            }

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

    childCheckbox.addEventListener('change', (e) => {
      e.stopPropagation();

      if (childCheckbox.checked) {
        directCheckbox.checked = true;

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

  } else {
    const leafContainer = document.createElement('div');
    leafContainer.className = 'flex items-center shrink-0';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isDirectChecked || isChildChecked;
    checkbox.className = 'w-4 h-4 rounded border-gray-600 text-purple-600 focus:ring-purple-500 focus:ring-2';
    checkbox.dataset.accessType = type;
    checkbox.dataset.accessValue = value;
    checkbox.dataset.accessMode = 'both';
    leafContainer.appendChild(checkbox);
    header.appendChild(leafContainer);

    checkbox.addEventListener('change', () => {
      if (!checkbox.checked) {
        bubbleUncheck(nodeDiv);
      }
    });
  }

  const label = document.createElement('label');
  label.className = 'flex-1 text-white cursor-pointer text-xs sm:text-sm min-w-0 break-all sm:wrap-break-word leading-snug';
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

  if (hasChildren && !isLeaf) {
    const expandIcon = document.createElement('span');
    expandIcon.className = 'text-gray-400 transition-transform cursor-pointer shrink-0';
    expandIcon.textContent = '▼';
    header.appendChild(expandIcon);

    header.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && !e.target.closest('label.cursor-pointer')?.querySelector('input')) {
        const childrenContainer = nodeDiv.querySelector('.children-container');
        if (childrenContainer) {
          childrenContainer.classList.toggle('hidden');
          expandIcon.classList.toggle('rotate-180');
        }
      }
    });
  }

  nodeDiv.appendChild(header);

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
      Object.keys(nodeInfo || {}).sort().forEach(seriesName => {
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
