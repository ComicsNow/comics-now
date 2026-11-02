/**
 * Canonical global proxy factory bridging access across window, globalThis, and reactive state.
 * Consolidates the duplicate proxy definitions across the codebase into a single robust implementation.
 */
export function createGlobalProxy(stateRef, target = (typeof window !== 'undefined' ? window : globalThis)) {
  const root = target || (typeof window !== 'undefined' ? window : globalThis);

  return new Proxy(root, {
    get(t, prop) {
      if (prop === 'state') return stateRef;
      if (stateRef && prop in stateRef) {
        return stateRef[prop];
      }
      const val = t[prop];
      if (typeof val === 'function') {
        return val.bind(t);
      }
      return val;
    },
    set(t, prop, value) {
      if (stateRef) {
        stateRef[prop] = value;
      }
      try {
        t[prop] = value;
      } catch {}
      return true;
    }
  });
}
