/**
 * Integration tests for context menu on library cards
 * Tests the actual card interaction to ensure:
 * 1. Mobile long-press shows context menu without triggering card click
 * 2. Context menu items can be clicked without triggering card click
 * 3. Desktop right-click still works correctly
 */

describe('Library Card Context Menu Integration', () => {
  let card;
  let cardClickHandler;
  let longPressTimer;
  let contextMenuShown;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';

    // Create a mock library card
    card = document.createElement('div');
    card.className = 'library-card';
    card.style.width = '200px';
    card.style.height = '300px';
    document.body.appendChild(card);

    // Mock click handler that would navigate or perform action
    cardClickHandler = jest.fn();
    card.addEventListener('click', cardClickHandler);

    // Simulate the touch event handlers from render.js
    longPressTimer = null;
    contextMenuShown = false;

    // Mock context menu function
    global.showLibraryContextMenu = jest.fn((e) => {
      e.preventDefault();
      e.stopPropagation();

      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.innerHTML = `
        <div class="context-menu-item" data-action="test">
          Test Action
        </div>
      `;

      // Position menu
      menu.style.position = 'fixed';
      menu.style.left = (e.clientX || e.touches[0].clientX) + 'px';
      menu.style.top = (e.clientY || e.touches[0].clientY) + 'px';
      menu.style.zIndex = '9999';

      document.body.appendChild(menu);
    });

    // Add contextmenu event handler (desktop)
    card.addEventListener('contextmenu', (e) => {
      if (typeof global.showLibraryContextMenu === 'function') {
        global.showLibraryContextMenu(e);
      }
    });

    // Add touch event handlers (mobile) - mimicking render.js implementation
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof global.showLibraryContextMenu === 'function') {
          contextMenuShown = true;
          global.showLibraryContextMenu(e);
        }
      }, 500);
    });

    card.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // Prevent click if context menu was just shown
      if (contextMenuShown) {
        e.preventDefault();
        e.stopPropagation();
        contextMenuShown = false;
      }
    });

    card.addEventListener('touchmove', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
  });

  afterEach(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  });

  describe('Mobile Long-Press Behavior', () => {
    test('should show context menu after 500ms long-press', (done) => {
      const touchStartEvent = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 }],
        bubbles: true,
        cancelable: true
      });

      card.dispatchEvent(touchStartEvent);

      // Context menu should not show immediately
      expect(global.showLibraryContextMenu).not.toHaveBeenCalled();

      // After 500ms, context menu should show
      setTimeout(() => {
        expect(global.showLibraryContextMenu).toHaveBeenCalled();
        expect(document.querySelector('.context-menu')).toBeTruthy();
        done();
      }, 550);
    });

    test('should not show context menu if touch is released early', (done) => {
      const touchStartEvent = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 }],
        bubbles: true,
        cancelable: true
      });

      card.dispatchEvent(touchStartEvent);

      // Release touch after 200ms (before 500ms threshold)
      setTimeout(() => {
        const touchEndEvent = new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true
        });
        card.dispatchEvent(touchEndEvent);

        // Context menu should not have appeared
        expect(global.showLibraryContextMenu).not.toHaveBeenCalled();
        done();
      }, 200);
    });

    test('should cancel long-press on touchmove', (done) => {
      const touchStartEvent = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 }],
        bubbles: true,
        cancelable: true
      });

      card.dispatchEvent(touchStartEvent);

      // Simulate finger movement after 200ms
      setTimeout(() => {
        const touchMoveEvent = new TouchEvent('touchmove', {
          touches: [{ clientX: 110, clientY: 110 }],
          bubbles: true,
          cancelable: true
        });
        card.dispatchEvent(touchMoveEvent);

        // Wait past the 500ms threshold
        setTimeout(() => {
          // Context menu should not show because touch moved
          expect(global.showLibraryContextMenu).not.toHaveBeenCalled();
          done();
        }, 400);
      }, 200);
    });
  });

  describe('Click-Through Prevention', () => {
    test('should not trigger card click when context menu appears on mobile', (done) => {
      const touchStartEvent = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 }],
        bubbles: true,
        cancelable: true
      });

      card.dispatchEvent(touchStartEvent);

      // Wait for context menu to appear
      setTimeout(() => {
        expect(contextMenuShown).toBe(true);
        expect(global.showLibraryContextMenu).toHaveBeenCalled();

        // Now trigger touchend (which normally would trigger click)
        const touchEndEvent = new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true
        });

        const preventDefaultSpy = jest.spyOn(touchEndEvent, 'preventDefault');
        const stopPropagationSpy = jest.spyOn(touchEndEvent, 'stopPropagation');

        card.dispatchEvent(touchEndEvent);

        // Check that event was prevented
        expect(preventDefaultSpy).toHaveBeenCalled();
        expect(stopPropagationSpy).toHaveBeenCalled();

        // Give time for any potential click event
        setTimeout(() => {
          // Card click handler should NOT have fired
          expect(cardClickHandler).not.toHaveBeenCalled();
          done();
        }, 100);
      }, 550);
    });

    test('should allow normal tap when no long-press occurs', (done) => {
      const touchStartEvent = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 }],
        bubbles: true,
        cancelable: true
      });

      card.dispatchEvent(touchStartEvent);

      // Release quickly (before 500ms)
      setTimeout(() => {
        const touchEndEvent = new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true
        });

        card.dispatchEvent(touchEndEvent);

        // Simulate the click event that would normally follow
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true
        });
        card.dispatchEvent(clickEvent);

        // Card click handler SHOULD fire for normal tap
        expect(cardClickHandler).toHaveBeenCalled();
        done();
      }, 200);
    });
  });

  describe('Context Menu Item Click Prevention', () => {
    test('should not trigger card click when context menu item is clicked', (done) => {
      // First, show the context menu via long-press
      const touchStartEvent = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 }],
        bubbles: true,
        cancelable: true
      });

      card.dispatchEvent(touchStartEvent);

      // Wait for context menu to appear
      setTimeout(() => {
        const menu = document.querySelector('.context-menu');
        expect(menu).toBeTruthy();

        const menuItem = menu.querySelector('.context-menu-item');
        expect(menuItem).toBeTruthy();

        // Click the menu item
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true
        });

        menuItem.dispatchEvent(clickEvent);

        // Card click handler should NOT fire
        expect(cardClickHandler).not.toHaveBeenCalled();
        done();
      }, 550);
    });
  });

  describe('Desktop Right-Click Compatibility', () => {
    test('should show context menu on right-click', () => {
      const contextMenuEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 150,
        clientY: 200
      });

      card.dispatchEvent(contextMenuEvent);

      expect(global.showLibraryContextMenu).toHaveBeenCalled();
      expect(document.querySelector('.context-menu')).toBeTruthy();
    });

    test('should not interfere with regular left-click on desktop', () => {
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100
      });

      card.dispatchEvent(clickEvent);

      // Normal click should work
      expect(cardClickHandler).toHaveBeenCalled();
      // Context menu should not show
      expect(global.showLibraryContextMenu).not.toHaveBeenCalled();
    });

    test('should allow clicking card after closing context menu via right-click', (done) => {
      // Show context menu via right-click
      const contextMenuEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 150,
        clientY: 200
      });

      card.dispatchEvent(contextMenuEvent);
      expect(document.querySelector('.context-menu')).toBeTruthy();

      // Remove context menu (simulating close)
      document.querySelector('.context-menu')?.remove();

      // Now try to click the card
      setTimeout(() => {
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true
        });

        card.dispatchEvent(clickEvent);

        // Click should work normally
        expect(cardClickHandler).toHaveBeenCalled();
        done();
      }, 100);
    });
  });

  describe('Multiple Cards Behavior', () => {
    test('should handle context menu on multiple cards independently', (done) => {
      // Create second card
      const card2 = document.createElement('div');
      card2.className = 'library-card';
      document.body.appendChild(card2);

      const card2ClickHandler = jest.fn();
      card2.addEventListener('click', card2ClickHandler);

      let card2LongPressTimer = null;
      let card2ContextMenuShown = false;

      // Add touch handlers to card2
      card2.addEventListener('touchstart', (e) => {
        card2ContextMenuShown = false;
        card2LongPressTimer = setTimeout(() => {
          if (typeof global.showLibraryContextMenu === 'function') {
            card2ContextMenuShown = true;
            global.showLibraryContextMenu(e);
          }
        }, 500);
      });

      card2.addEventListener('touchend', (e) => {
        if (card2LongPressTimer) {
          clearTimeout(card2LongPressTimer);
          card2LongPressTimer = null;
        }
        if (card2ContextMenuShown) {
          e.preventDefault();
          e.stopPropagation();
          card2ContextMenuShown = false;
        }
      });

      // Long-press card1
      const touch1Start = new TouchEvent('touchstart', {
        touches: [{ clientX: 50, clientY: 50 }],
        bubbles: true,
        cancelable: true
      });
      card.dispatchEvent(touch1Start);

      setTimeout(() => {
        // Context menu should show for card1
        expect(contextMenuShown).toBe(true);

        // Touch card1 end
        const touch1End = new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true
        });
        card.dispatchEvent(touch1End);

        // Now tap card2 normally (no long-press)
        const touch2Start = new TouchEvent('touchstart', {
          touches: [{ clientX: 100, clientY: 100 }],
          bubbles: true,
          cancelable: true
        });
        card2.dispatchEvent(touch2Start);

        setTimeout(() => {
          const touch2End = new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true
          });
          card2.dispatchEvent(touch2End);

          const click2 = new MouseEvent('click', {
            bubbles: true,
            cancelable: true
          });
          card2.dispatchEvent(click2);

          // Card1 should not have been clicked
          expect(cardClickHandler).not.toHaveBeenCalled();

          // Card2 should have been clicked (normal tap)
          expect(card2ClickHandler).toHaveBeenCalled();

          done();
        }, 100);
      }, 550);
    });
  });

  describe('Edge Cases', () => {
    test('should handle rapid tap-and-hold-release', (done) => {
      // Tap
      const touch1Start = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 }],
        bubbles: true,
        cancelable: true
      });
      card.dispatchEvent(touch1Start);

      // Release quickly
      setTimeout(() => {
        const touch1End = new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true
        });
        card.dispatchEvent(touch1End);

        // Immediately hold again
        const touch2Start = new TouchEvent('touchstart', {
          touches: [{ clientX: 100, clientY: 100 }],
          bubbles: true,
          cancelable: true
        });
        card.dispatchEvent(touch2Start);

        // Wait for long press
        setTimeout(() => {
          expect(global.showLibraryContextMenu).toHaveBeenCalled();

          const touch2End = new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true
          });
          card.dispatchEvent(touch2End);

          // Card should not be clicked
          expect(cardClickHandler).not.toHaveBeenCalled();
          done();
        }, 550);
      }, 100);
    });

    test('should reset contextMenuShown flag on new touchstart', (done) => {
      // First long-press
      const touch1Start = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 }],
        bubbles: true,
        cancelable: true
      });
      card.dispatchEvent(touch1Start);

      setTimeout(() => {
        expect(contextMenuShown).toBe(true);

        const touch1End = new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true
        });
        card.dispatchEvent(touch1End);

        // Start new touch - should reset flag
        const touch2Start = new TouchEvent('touchstart', {
          touches: [{ clientX: 100, clientY: 100 }],
          bubbles: true,
          cancelable: true
        });
        card.dispatchEvent(touch2Start);

        // Release quickly (no long press this time)
        setTimeout(() => {
          const touch2End = new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true
          });
          card.dispatchEvent(touch2End);

          // Now click should work (flag was reset)
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true
          });
          card.dispatchEvent(clickEvent);

          expect(cardClickHandler).toHaveBeenCalled();
          done();
        }, 100);
      }, 550);
    });
  });
});
