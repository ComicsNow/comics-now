/**
 * Comics Now! - Debug Logging Subsystem
 *
 * Scoped category filtering and console output formatting.
 */

const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

const DEBUG_LOG_STATE = {
  enabled: false,
  categories: new Set()
};

function normalizeDebugCategories(categories) {
  if (!Array.isArray(categories)) {
    categories = Array.from(arguments);
  }
  return categories
    .flatMap(category => {
      if (Array.isArray(category)) return category;
      if (typeof category === 'string') return category.split(',');
      return [];
    })
    .map(category => (typeof category === 'string' ? category.trim().toUpperCase() : ''))
    .filter(Boolean);
}

function isDebugCategoryEnabled(category) {
  if (!DEBUG_LOG_STATE.enabled) {
    return false;
  }
  if (DEBUG_LOG_STATE.categories.size === 0) {
    return true;
  }
  if (!category) {
    return false;
  }
  return DEBUG_LOG_STATE.categories.has(category);
}

export function debugLog(category, ...args) {
  const normalizedCategory = typeof category === 'string' ? category.toUpperCase() : '';
  if (!isDebugCategoryEnabled(normalizedCategory)) {
    return;
  }
  rawConsole.log(`[${normalizedCategory || 'DEBUG'}]`, ...args);
}

export function enableComicsNowDebug(...categories) {
  const normalized = normalizeDebugCategories(categories);
  DEBUG_LOG_STATE.enabled = true;
  DEBUG_LOG_STATE.categories = new Set(normalized);
  rawConsole.log('[DEBUG]', 'Debug logging enabled', normalized.length ? `for categories: ${normalized.join(', ')}` : 'for all categories');
}

export function disableComicsNowDebug() {
  DEBUG_LOG_STATE.enabled = false;
  DEBUG_LOG_STATE.categories.clear();
  rawConsole.log('[DEBUG]', 'Debug logging disabled');
}

export function isComicsNowDebugEnabled(category) {
  const normalizedCategory = typeof category === 'string' ? category.toUpperCase() : '';
  return isDebugCategoryEnabled(normalizedCategory);
}
