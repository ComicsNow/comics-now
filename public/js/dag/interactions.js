/**
 * Comics Now! - Reading List DAG Interactive Handlers
 *
 * Pan, zoom, gestures, search, filtering, and comic launch interactions.
 */

import { state, getComicById } from '../globals.js';
import { dagState } from './state.js';
import { applyTransform, fitDAGToViewport } from './layout.js';
import { renderVisuals, showNodeInspector, hideNodeInspector } from './renderer.js';

/**
 * Launch the comic in the reader
 * @param {string} comicId - Comic identifier
 */
export function launchComicReader(comicId) {
  let comic = typeof getComicById === 'function' ? getComicById(comicId) : null;
  if (!comic && typeof window !== 'undefined' && typeof window.getComicById === 'function') {
    comic = window.getComicById(comicId);
  }
  if (!comic && state && typeof state.getComicById === 'function') {
    comic = state.getComicById(comicId);
  }
  if (!comic && dagState.currentDAGData && dagState.currentDAGData.nodes) {
    const node = dagState.currentDAGData.nodes.find(n => n.id === comicId);
    if (node) {
      comic = { id: node.id, name: node.name, series: node.series, totalPages: node.totalPages, lastReadPage: node.lastReadPage };
    }
  }

  const listContext = dagState.activeContextList ? { readingListId: dagState.activeContextList.id, readingListName: dagState.activeContextList.name } : {};

  const openViewer = (typeof window !== 'undefined' && window.openComicViewer) ||
                     (typeof state !== 'undefined' && state.openComicViewer) ||
                     (typeof global !== 'undefined' && global.openComicViewer);
  const closeModal = (typeof window !== 'undefined' && window.closeReadingListModal) ||
                      (typeof state !== 'undefined' && state.closeReadingListModal) ||
                      (typeof global !== 'undefined' && global.closeReadingListModal);

  if (typeof openViewer === 'function') {
    openViewer(comic || { id: comicId }, listContext);
    if (typeof closeModal === 'function') {
      closeModal();
    }
  }
}

/**
 * Binds mouse, touch, and UI event interactions
 * @param {HTMLElement} container - DAG container
 */
export function bindInteractions(container) {
  const viewport = container.querySelector('#rl-dag-viewport');
  if (!viewport || viewport._rlDagBound) return;
  viewport._rlDagBound = true;
  viewport.style.touchAction = 'none';

  // Mouse pan
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.rl-dag-node button') || e.target.closest('input')) return;
    dagState.isDraggingGraph = true;
    dagState.dragStart = { x: e.clientX - dagState.graphTransform.x, y: e.clientY - dagState.graphTransform.y };
    viewport.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dagState.isDraggingGraph) return;
    dagState.graphTransform.x = e.clientX - dagState.dragStart.x;
    dagState.graphTransform.y = e.clientY - dagState.dragStart.y;
    applyTransform(container);
  });

  window.addEventListener('mouseup', () => {
    if (dagState.isDraggingGraph) {
      dagState.isDraggingGraph = false;
      viewport.style.cursor = 'grab';
    }
  });

  // Mobile Touch Pan & Pinch-to-Zoom
  let touchStartDist = 0;
  let touchStartScale = 1;
  let isTouching = false;
  let touchStartPos = { x: 0, y: 0 };

  viewport.addEventListener('touchstart', (e) => {
    if (e.target.closest('.rl-dag-node button') || e.target.closest('input')) return;
    if (e.touches.length === 1) {
      isTouching = true;
      touchStartPos = {
        x: e.touches[0].clientX - dagState.graphTransform.x,
        y: e.touches[0].clientY - dagState.graphTransform.y
      };
    } else if (e.touches.length === 2) {
      isTouching = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDist = Math.hypot(dx, dy);
      touchStartScale = dagState.graphTransform.scale;
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && isTouching) {
      dagState.graphTransform.x = e.touches[0].clientX - touchStartPos.x;
      dagState.graphTransform.y = e.touches[0].clientY - touchStartPos.y;
      applyTransform(container);
    } else if (e.touches.length === 2 && touchStartDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);
      const factor = currentDist / touchStartDist;
      dagState.graphTransform.scale = Math.min(2.5, Math.max(0.25, touchStartScale * factor));
      applyTransform(container);
    }
  }, { passive: true });

  viewport.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      isTouching = false;
      touchStartDist = 0;
    } else if (e.touches.length === 1) {
      isTouching = true;
      touchStartPos = {
        x: e.touches[0].clientX - dagState.graphTransform.x,
        y: e.touches[0].clientY - dagState.graphTransform.y
      };
    }
  }, { passive: true });

  viewport.addEventListener('touchcancel', () => {
    isTouching = false;
    touchStartDist = 0;
  });

  // Wheel zoom toward pointer
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(2.5, Math.max(0.25, dagState.graphTransform.scale * zoomFactor));

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    dagState.graphTransform.x = mouseX - (mouseX - dagState.graphTransform.x) * (newScale / dagState.graphTransform.scale);
    dagState.graphTransform.y = mouseY - (mouseY - dagState.graphTransform.y) * (newScale / dagState.graphTransform.scale);
    dagState.graphTransform.scale = newScale;
    applyTransform(container);
  }, { passive: false });

  // Node Card Click & Quick Read
  viewport.addEventListener('click', (e) => {
    const quickReadBtn = e.target.closest('.rl-dag-quick-read-btn');
    if (quickReadBtn) {
      e.stopPropagation();
      const comicId = quickReadBtn.dataset.comicId;
      launchComicReader(comicId);
      return;
    }

    const nodeCard = e.target.closest('.rl-dag-node');
    if (nodeCard) {
      const nodeId = nodeCard.dataset.nodeId;
      dagState.activeSelectedNodeId = dagState.activeSelectedNodeId === nodeId ? null : nodeId;
      renderVisuals(container);
      if (dagState.activeSelectedNodeId) {
        showNodeInspector(container, dagState.activeSelectedNodeId, launchComicReader);
      } else {
        hideNodeInspector(container);
      }
      return;
    }

    // Clicking empty space closes inspector
    if (!e.target.closest('#rl-dag-inspector')) {
      dagState.activeSelectedNodeId = null;
      renderVisuals(container);
      hideNodeInspector(container);
    }
  });

  // Double click node to read immediately
  viewport.addEventListener('dblclick', (e) => {
    const nodeCard = e.target.closest('.rl-dag-node');
    if (nodeCard) {
      const nodeId = nodeCard.dataset.nodeId;
      launchComicReader(nodeId);
    }
  });

  // Search input
  const searchInput = container.querySelector('#rl-dag-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      dagState.searchQuery = e.target.value.trim();
      renderVisuals(container);
    });
  }

  // Filter buttons (All / Unread / Read)
  const filterBtns = container.querySelectorAll('.rl-dag-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      dagState.activeFilterMode = btn.dataset.filter;
      filterBtns.forEach(b => {
        const isActive = b.dataset.filter === dagState.activeFilterMode;
        b.className = `rl-dag-filter-btn px-2.5 py-1 rounded font-medium transition-colors ${isActive ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:text-white'}`;
      });
      renderVisuals(container);
    });
  });

  // Focus next unread button
  const focusUnreadBtn = container.querySelector('#rl-dag-focus-unread-btn');
  if (focusUnreadBtn) {
    focusUnreadBtn.addEventListener('click', () => {
      fitDAGToViewport(container, dagState.currentDAGData, true);
    });
  }

  // Reset button
  const resetBtn = container.querySelector('#rl-dag-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      fitDAGToViewport(container, dagState.currentDAGData, false);
    });
  }

  // Series legend chips
  const legendChips = container.querySelectorAll('.rl-series-legend-chip');
  legendChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const series = chip.dataset.series;
      if (dagState.activeSeriesFilter === series) {
        dagState.activeSeriesFilter = null;
        chip.style.opacity = '1';
      } else {
        dagState.activeSeriesFilter = series;
        legendChips.forEach(c => {
          c.style.opacity = c.dataset.series === series ? '1' : '0.4';
        });
      }
      renderVisuals(container);
    });
  });
}
