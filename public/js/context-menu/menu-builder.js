/**
 * Context Menu Builder - Core utilities for creating and managing context menus
 */
(function (global) {
  'use strict';

  let activeContextMenu = null;
  let activeOverlay = null;

  // ============================================================================
  // SVG ICON CONSTANTS
  // ============================================================================

  const ICONS = {
    // Success/Checkmark icon (filled circle with check)
    SUCCESS: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>',

    // Download arrow icon
    DOWNLOAD: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>',

    // Eye/Read icon
    EYE: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>',

    // Simple checkmark icon (for manga mode enabled)
    CHECKMARK: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>',

    // Book icon (for manga mode)
    BOOK: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>',

    // Scroll icon (for continuous mode)
    SCROLL: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>',

    // Bookmark/Reading List icon
    READING_LIST: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>'
  };

  // ============================================================================
  // CONTEXT MENU UTILITIES
  // ============================================================================

  /**
   * Create an overlay element to prevent interaction with underlying elements
   * @returns {HTMLElement} The overlay element
   */
  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'context-menu-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 9998;
      background: transparent;
      cursor: default;
    `;

    // Close menu when overlay is clicked
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
    });

    overlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
    });

    return overlay;
  }

  /**
   * Position a context menu at the event coordinates and adjust if off-screen
   * @param {HTMLElement} menu - The menu element to position
   * @param {Event} event - The event containing coordinates
   */
  function positionContextMenu(menu, event) {
    const x = event.clientX || (event.touches && event.touches[0].clientX) || 0;
    const y = event.clientY || (event.touches && event.touches[0].clientY) || 0;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = '9999'; // Ensure menu is above overlay

    // Create and add overlay first (lower z-index)
    const overlay = createOverlay();
    document.body.appendChild(overlay);
    activeOverlay = overlay;

    // Then add menu (higher z-index)
    document.body.appendChild(menu);
    activeContextMenu = menu;

    // Adjust position if menu goes off-screen
    setTimeout(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 10}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 10}px`;
      }
    }, 0);
  }

  /**
   * Attach click-outside close handler to a context menu
   * @param {HTMLElement} menu - The menu element to attach handler to
   * Note: With overlay in place, this is primarily for desktop right-click + Esc key
   */
  function attachCloseHandler(menu) {
    // Handle Escape key to close menu
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        closeContextMenu();
        document.removeEventListener('keydown', keyHandler);
      }
    };

    document.addEventListener('keydown', keyHandler);

    // Desktop right-click outside menu area (overlay handles mobile)
    const clickHandler = (e) => {
      if (activeOverlay && !menu.contains(e.target) && e.target !== activeOverlay) {
        return; // Let overlay handle it
      }
    };

    // Add a small delay to avoid immediate closure from the triggering event
    setTimeout(() => {
      document.addEventListener('click', clickHandler, true);
    }, 100);
  }

  /**
   * Close the active context menu and remove overlay
   */
  function closeContextMenu() {
    if (activeContextMenu) {
      activeContextMenu.remove();
      activeContextMenu = null;
    }
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
  }

  // Expose public API
  global.ContextMenuBuilder = {
    ICONS,
    positionContextMenu,
    attachCloseHandler,
    closeContextMenu
  };

})(typeof window !== 'undefined' ? window : globalThis);
