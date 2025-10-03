/**
 * Input validation utilities
 * Prevents XSS, data integrity issues, and database bloat
 */

/**
 * Sanitize HTML by escaping special characters
 * Prevents XSS attacks in user-generated content
 */
function sanitizeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate and sanitize device name
 * Max 200 characters, HTML escaped, trimmed
 */
function validateDeviceName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, sanitized: 'Unnamed Device', error: 'Device name must be a string' };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: true, sanitized: 'Unnamed Device' };
  }

  if (trimmed.length > 200) {
    const truncated = trimmed.substring(0, 200);
    return {
      valid: true,
      sanitized: sanitizeHtml(truncated),
      warning: 'Device name truncated to 200 characters'
    };
  }

  return { valid: true, sanitized: sanitizeHtml(trimmed) };
}

/**
 * Validate device ID
 * Must be alphanumeric with hyphens, max 100 chars
 */
function validateDeviceId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Device ID must be a string' };
  }

  const trimmed = id.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Device ID cannot be empty' };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: 'Device ID too long (max 100 characters)' };
  }

  // Allow alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { valid: false, error: 'Device ID contains invalid characters' };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Validate fingerprint
 * Max 200 characters
 */
function validateFingerprint(fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'string') {
    return { valid: true, sanitized: '' }; // Fingerprint is optional
  }

  const trimmed = fingerprint.trim();

  if (trimmed.length > 200) {
    return { valid: false, error: 'Fingerprint too long (max 200 characters)' };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Validate lastReadPage
 * Must be non-negative integer, <= totalPages
 */
function validateLastReadPage(page, totalPages) {
  if (typeof page !== 'number') {
    return { valid: false, error: 'lastReadPage must be a number' };
  }

  if (!Number.isInteger(page)) {
    return { valid: false, error: 'lastReadPage must be an integer' };
  }

  if (page < 0) {
    return { valid: false, error: 'lastReadPage cannot be negative' };
  }

  if (totalPages !== undefined && page > totalPages) {
    return {
      valid: false,
      error: `lastReadPage (${page}) exceeds totalPages (${totalPages})`
    };
  }

  return { valid: true, sanitized: page };
}

/**
 * Validate comic/series status
 * Must be 'read' or 'unread'
 */
function validateStatus(status) {
  if (!status || typeof status !== 'string') {
    return { valid: false, error: 'Status must be a string' };
  }

  const trimmed = status.trim().toLowerCase();

  if (trimmed !== 'read' && trimmed !== 'unread') {
    return {
      valid: false,
      error: 'Status must be either "read" or "unread"'
    };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Validate scan interval (in minutes)
 * Must be >= 1 minute, <= 1440 minutes (24 hours)
 */
function validateScanInterval(interval) {
  if (typeof interval !== 'number') {
    return { valid: false, error: 'Interval must be a number' };
  }

  if (!Number.isInteger(interval)) {
    return { valid: false, error: 'Interval must be an integer' };
  }

  if (interval < 1) {
    return { valid: false, error: 'Interval must be at least 1 minute' };
  }

  if (interval > 1440) {
    return { valid: false, error: 'Interval cannot exceed 1440 minutes (24 hours)' };
  }

  return { valid: true, sanitized: interval };
}

/**
 * Validate ComicVine API key
 * Max 100 characters, alphanumeric
 */
function validateApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: true, sanitized: '' }; // Empty API key is allowed
  }

  const trimmed = apiKey.trim();

  if (trimmed.length === 0) {
    return { valid: true, sanitized: '' };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: 'API key too long (max 100 characters)' };
  }

  // ComicVine API keys are alphanumeric
  if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return { valid: false, error: 'API key contains invalid characters' };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Validate search query
 * Max 500 characters, trimmed
 */
function validateSearchQuery(query) {
  if (!query || typeof query !== 'string') {
    return { valid: true, sanitized: '' };
  }

  const trimmed = query.trim();

  if (trimmed.length > 500) {
    return { valid: false, error: 'Search query too long (max 500 characters)' };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Validate comic ID (SHA hash)
 * Must be 40-character hex string
 */
function validateComicId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Comic ID must be a string' };
  }

  const trimmed = id.trim();

  if (!/^[a-f0-9]{40}$/.test(trimmed)) {
    return { valid: false, error: 'Invalid comic ID format' };
  }

  return { valid: true, sanitized: trimmed };
}

module.exports = {
  sanitizeHtml,
  validateDeviceName,
  validateDeviceId,
  validateFingerprint,
  validateLastReadPage,
  validateStatus,
  validateScanInterval,
  validateApiKey,
  validateSearchQuery,
  validateComicId
};
