/**
 * Lightweight, zero-dependency EventBus for pub/sub event distribution across modules.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event - Event name
   * @param {Function} handler - Callback receiving event payload
   * @returns {Function} Unsubscribe function
   */
  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe a handler from an event.
   */
  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event to all registered listeners.
   * Catches errors in individual listeners to prevent cascading failures.
   */
  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[EventBus] Error in listener for event "${event}":`, err);
      }
    }
  }

  /**
   * Remove all registered listeners.
   */
  clear() {
    this.listeners.clear();
  }
}
