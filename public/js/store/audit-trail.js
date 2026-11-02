/**
 * In-memory ring buffer recording the caller stack trace for every state mutation.
 * Enables instant debugging and audit trail inspection via DevTools.
 */
export class MutationAuditTrail {
  constructor(limit = 200) {
    this.limit = limit;
    this.trail = [];
  }

  /**
   * Extract a concise stack trace pointing to the caller file and line number.
   */
  captureStackTrace() {
    try {
      const stack = new Error().stack;
      if (!stack) return 'unknown';
      const lines = stack.split('\n');
      // Skip error creation lines and return caller lines
      return lines
        .slice(3, 7)
        .map(line => line.trim())
        .join(' <- ');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Record a state mutation in the audit ring buffer.
   */
  record(key, oldValue, newValue, source = 'direct') {
    const trace = this.captureStackTrace();
    const entry = {
      timestamp: Date.now(),
      key,
      oldValue,
      newValue,
      source,
      trace
    };

    if (this.trail.length >= this.limit) {
      this.trail.shift();
    }
    this.trail.push(entry);

    if (typeof window !== 'undefined' && window.__COMICS_DEBUG_STORE__) {
      console.log(
        `%c[STORE MUTATION] %c${key}%c:`,
        'color: #9333ea; font-weight: bold;',
        'color: #3b82f6;',
        'color: inherit;',
        oldValue,
        '->',
        newValue,
        `(${trace})`
      );
    }
  }

  /**
   * Retrieve entries, optionally filtered by key or prefix.
   */
  getEntries(filterKey) {
    if (!filterKey) return [...this.trail];
    return this.trail.filter(entry => 
      entry.key === filterKey || entry.key.startsWith(filterKey + '.')
    );
  }

  /**
   * Clear the audit trail.
   */
  clear() {
    this.trail = [];
  }
}
