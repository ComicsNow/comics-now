import { EventBus } from './bus.js';
import { MutationAuditTrail } from './audit-trail.js';
import { createViewerActions } from './actions/viewer.js';
import { createNavigationActions } from './actions/navigation.js';

/**
 * Observable Central State Store for Comics Now.
 * Provides fine-grained subscriptions, mutation tracking, and unidirectional event emission.
 */
export class ComicsStore {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.bus = new EventBus();
    this.audit = new MutationAuditTrail(200);
    this.subscriptions = new Map();
    this.actions = {
      viewer: typeof createViewerActions === 'function' ? createViewerActions(this) : null,
      navigation: typeof createNavigationActions === 'function' ? createNavigationActions(this) : null
    };
  }

  /**
   * Read a property from the canonical store state.
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Mutate a property in the store state.
   * Logs mutation to audit trail and notifies fine-grained subscribers and event bus.
   */
  set(key, value, source = 'direct') {
    const oldValue = this.state[key];
    // Ignore no-op assignments for primitives
    if (oldValue === value && (typeof value !== 'object' || value === null)) {
      return;
    }

    this.audit.record(key, oldValue, value, source);
    this.state[key] = value;

    // Notify fine-grained subscribers for this specific key
    this.notify(key, value, oldValue);

    // Emit event on bus for loose coupling
    this.bus.emit(`change:${key}`, { key, value, oldValue, source });
    this.bus.emit('state:change', { key, value, oldValue, source });
  }

  /**
   * Subscribe to state changes on a specific key.
   * @returns {Function} Unsubscribe function
   */
  subscribe(key, callback) {
    if (typeof callback !== 'function') return () => {};
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    this.subscriptions.get(key).add(callback);
    return () => {
      const subs = this.subscriptions.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscriptions.delete(key);
        }
      }
    };
  }

  /**
   * Internal notifier for subscribed callbacks.
   */
  notify(key, value, oldValue) {
    const handlers = this.subscriptions.get(key);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(value, oldValue);
      } catch (err) {
        console.error(`[ComicsStore] Error in subscriber for "${key}":`, err);
      }
    }
  }
}
