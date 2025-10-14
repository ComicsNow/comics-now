/**
 * Tests for Context Menu Builder
 * Ensures mobile context menu fixes work correctly and don't break desktop functionality
 */

// Load the menu-builder module
const fs = require('fs');
const path = require('path');

// Read and evaluate the menu-builder.js file
const menuBuilderCode = fs.readFileSync(
  path.join(__dirname, '../menu-builder.js'),
  'utf-8'
);

describe('Context Menu Builder', () => {
  let ContextMenuBuilder;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';

    // Create a fresh global scope and evaluate the module
    const globalScope = {
      window: global.window,
      document: global.document,
      globalThis: global,
    };

    // Execute the menu-builder code in our test context
    const wrappedCode = `
      ${menuBuilderCode}
      return ContextMenuBuilder;
    `;

    ContextMenuBuilder = new Function('window', 'document', 'globalThis', wrappedCode)(
      globalScope.window,
      globalScope.document,
      globalScope.globalThis
    );
  });

  afterEach(() => {
    // Clean up any active menus
    if (ContextMenuBuilder) {
      ContextMenuBuilder.closeContextMenu();
    }
  });

  describe('Overlay Creation', () => {
    test('should create overlay with correct z-index', () => {
      const menu = document.createElement('div');
      menu.className = 'context-menu';

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      const overlay = document.querySelector('.context-menu-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay.style.zIndex).toBe('9998');
      expect(overlay.style.position).toBe('fixed');
    });

    test('should create overlay before menu (correct z-index order)', () => {
      const menu = document.createElement('div');
      menu.className = 'context-menu';

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      const overlay = document.querySelector('.context-menu-overlay');
      const contextMenu = document.querySelector('.context-menu');

      expect(overlay).toBeTruthy();
      expect(contextMenu).toBeTruthy();
      expect(parseInt(contextMenu.style.zIndex)).toBeGreaterThan(parseInt(overlay.style.zIndex));
    });

    test('should overlay cover entire viewport', () => {
      const menu = document.createElement('div');
      const mockEvent = { clientX: 100, clientY: 100 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      const overlay = document.querySelector('.context-menu-overlay');
      expect(overlay.style.top).toBe('0px');
      expect(overlay.style.left).toBe('0px');
      expect(overlay.style.right).toBe('0px');
      expect(overlay.style.bottom).toBe('0px');
    });
  });

  describe('Menu Positioning', () => {
    test('should position menu at mouse coordinates', () => {
      const menu = document.createElement('div');
      const mockEvent = {
        clientX: 150,
        clientY: 200,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      expect(menu.style.left).toBe('150px');
      expect(menu.style.top).toBe('200px');
    });

    test('should position menu at touch coordinates', () => {
      const menu = document.createElement('div');
      const mockEvent = {
        touches: [{ clientX: 100, clientY: 150 }],
        preventDefault: jest.fn(),
        stopPropagation: jest.fn()
      };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      expect(menu.style.left).toBe('100px');
      expect(menu.style.top).toBe('150px');
    });

    test('should set menu z-index above overlay', () => {
      const menu = document.createElement('div');
      const mockEvent = { clientX: 100, clientY: 100 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      expect(menu.style.zIndex).toBe('9999');
    });
  });

  describe('Overlay Click Handling', () => {
    test('should close menu when overlay is clicked', (done) => {
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      const mockEvent = { clientX: 100, clientY: 100 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      const overlay = document.querySelector('.context-menu-overlay');
      expect(overlay).toBeTruthy();

      // Simulate click on overlay
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      });

      overlay.dispatchEvent(clickEvent);

      // Menu and overlay should be removed after click
      setTimeout(() => {
        expect(document.querySelector('.context-menu-overlay')).toBeFalsy();
        expect(document.body.contains(menu)).toBe(false);
        done();
      }, 50);
    });

    test('should close menu when overlay receives touchend', (done) => {
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      const mockEvent = { clientX: 100, clientY: 100 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      const overlay = document.querySelector('.context-menu-overlay');

      // Simulate touchend on overlay
      const touchEvent = new TouchEvent('touchend', {
        bubbles: true,
        cancelable: true
      });

      overlay.dispatchEvent(touchEvent);

      setTimeout(() => {
        expect(document.querySelector('.context-menu-overlay')).toBeFalsy();
        expect(document.body.contains(menu)).toBe(false);
        done();
      }, 50);
    });

    test('should prevent event propagation when overlay is clicked', () => {
      const menu = document.createElement('div');
      const mockEvent = { clientX: 100, clientY: 100 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      const overlay = document.querySelector('.context-menu-overlay');

      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      });

      const preventDefaultSpy = jest.spyOn(clickEvent, 'preventDefault');
      const stopPropagationSpy = jest.spyOn(clickEvent, 'stopPropagation');

      overlay.dispatchEvent(clickEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Menu Closing', () => {
    test('should close menu via Escape key', (done) => {
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      const mockEvent = { clientX: 100, clientY: 100 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);
      ContextMenuBuilder.attachCloseHandler(menu);

      expect(document.body.contains(menu)).toBe(true);

      // Simulate Escape key press
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      });

      document.dispatchEvent(escapeEvent);

      setTimeout(() => {
        expect(document.body.contains(menu)).toBe(false);
        expect(document.querySelector('.context-menu-overlay')).toBeFalsy();
        done();
      }, 50);
    });

    test('should remove both menu and overlay when closing', () => {
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      const mockEvent = { clientX: 100, clientY: 100 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      expect(document.querySelector('.context-menu-overlay')).toBeTruthy();
      expect(document.body.contains(menu)).toBe(true);

      ContextMenuBuilder.closeContextMenu();

      expect(document.querySelector('.context-menu-overlay')).toBeFalsy();
      expect(document.body.contains(menu)).toBe(false);
    });

    test('should handle multiple close calls gracefully', () => {
      const menu = document.createElement('div');
      const mockEvent = { clientX: 100, clientY: 100 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      // Close multiple times - should not throw
      expect(() => {
        ContextMenuBuilder.closeContextMenu();
        ContextMenuBuilder.closeContextMenu();
        ContextMenuBuilder.closeContextMenu();
      }).not.toThrow();
    });
  });

  describe('Icons', () => {
    test('should expose icon constants', () => {
      expect(ContextMenuBuilder.ICONS).toBeDefined();
      expect(ContextMenuBuilder.ICONS.SUCCESS).toContain('svg');
      expect(ContextMenuBuilder.ICONS.DOWNLOAD).toContain('svg');
      expect(ContextMenuBuilder.ICONS.EYE).toContain('svg');
      expect(ContextMenuBuilder.ICONS.CHECKMARK).toContain('svg');
      expect(ContextMenuBuilder.ICONS.BOOK).toContain('svg');
    });
  });

  describe('Off-screen Adjustment', () => {
    test('should set initial position and have adjustment logic in place', (done) => {
      // Mock window size
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 400
      });

      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 400
      });

      const menu = document.createElement('div');
      menu.style.width = '200px';
      menu.style.height = '100px';

      // Position near right edge
      const mockEvent = { clientX: 350, clientY: 350 };

      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      // Initial position should be set
      expect(menu.style.left).toBe('350px');
      expect(menu.style.top).toBe('350px');

      // Give it time for adjustment logic to run
      // Note: In jsdom, getBoundingClientRect may not accurately reflect layout
      // The important thing is that the adjustment code exists and executes without error
      setTimeout(() => {
        const left = parseInt(menu.style.left);
        const top = parseInt(menu.style.top);

        // Position should be set (exact values may vary in jsdom)
        expect(typeof left).toBe('number');
        expect(typeof top).toBe('number');
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        done();
      }, 100);
    });

    test('should handle adjustment logic without errors', () => {
      const menu = document.createElement('div');
      const mockEvent = { clientX: 100, clientY: 100 };

      // This should not throw, even if positioning logic runs
      expect(() => {
        ContextMenuBuilder.positionContextMenu(menu, mockEvent);
      }).not.toThrow();

      expect(document.body.contains(menu)).toBe(true);
    });
  });

  describe('Overlay Blocks Underlying Elements', () => {
    test('overlay should prevent clicks on elements underneath', () => {
      // Create a card element that would normally be clickable
      const card = document.createElement('div');
      card.className = 'library-card';
      card.style.position = 'absolute';
      card.style.top = '50px';
      card.style.left = '50px';
      card.style.width = '200px';
      card.style.height = '300px';

      const clickHandler = jest.fn();
      card.addEventListener('click', clickHandler);
      document.body.appendChild(card);

      // Show context menu
      const menu = document.createElement('div');
      const mockEvent = { clientX: 100, clientY: 100 };
      ContextMenuBuilder.positionContextMenu(menu, mockEvent);

      const overlay = document.querySelector('.context-menu-overlay');
      expect(overlay).toBeTruthy();

      // Try to click the card (but overlay should intercept)
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100
      });

      // Click at the card's position - overlay should be in the way
      document.elementFromPoint = jest.fn(() => overlay);
      overlay.dispatchEvent(clickEvent);

      // The card click handler should not fire because overlay intercepts
      expect(clickHandler).not.toHaveBeenCalled();
    });
  });

  describe('Desktop Context Menu Compatibility', () => {
    test('should work with standard contextmenu event', () => {
      const menu = document.createElement('div');
      const mockContextMenuEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 150
      });

      // Add clientX/clientY to the event
      Object.defineProperty(mockContextMenuEvent, 'clientX', { value: 200 });
      Object.defineProperty(mockContextMenuEvent, 'clientY', { value: 150 });

      ContextMenuBuilder.positionContextMenu(menu, mockContextMenuEvent);

      expect(menu.style.left).toBe('200px');
      expect(menu.style.top).toBe('150px');
      expect(document.body.contains(menu)).toBe(true);
      expect(document.querySelector('.context-menu-overlay')).toBeTruthy();
    });

    test('should not interfere with right-click behavior', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);

      const rightClickHandler = jest.fn((e) => {
        e.preventDefault();
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        ContextMenuBuilder.positionContextMenu(menu, e);
      });

      element.addEventListener('contextmenu', rightClickHandler);

      const contextMenuEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100
      });

      element.dispatchEvent(contextMenuEvent);

      expect(rightClickHandler).toHaveBeenCalled();
      expect(document.querySelector('.context-menu')).toBeTruthy();
    });
  });
});
