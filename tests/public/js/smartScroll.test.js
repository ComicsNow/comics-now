/**
 * @jest-environment jsdom
 */

describe('Smart Auto-Scroll behavior for Log Viewers', () => {
  function smartScrollToBottom(container, threshold = 35) {
    if (!container) return false;
    const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + threshold;
    if (isAtBottom) {
      container.scrollTop = container.scrollHeight;
      return true;
    }
    return false;
  }

  it('scrolls to bottom if container is already at or near bottom', () => {
    const el = {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 580 // 1000 - 400 = 600, so within 20px of bottom
    };

    const didScroll = smartScrollToBottom(el, 35);
    expect(didScroll).toBe(true);
    expect(el.scrollTop).toBe(1000);
  });

  it('does NOT scroll to bottom if user has scrolled up to inspect history', () => {
    const el = {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 200 // Scrolled up 400px above bottom
    };

    const didScroll = smartScrollToBottom(el, 35);
    expect(didScroll).toBe(false);
    expect(el.scrollTop).toBe(200); // Preserved scroll position!
  });
});
