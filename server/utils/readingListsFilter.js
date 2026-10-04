'use strict';

/**
 * Filter a list of reading list objects by name (search) and/or publisher.
 *
 * @param {Array} lists       - Reading list objects from the API
 * @param {Object} opts
 * @param {string} [opts.search]     - Substring to match against list name (case-insensitive)
 * @param {string} [opts.publisher]  - Publisher name that must appear in list.publishers
 * @returns {Array} Filtered reading lists
 */
function filterReadingLists(lists, { search = '', publisher = '' } = {}) {
  const term = (search || '').trim().toLowerCase();
  const pub  = (publisher || '').trim();

  return (lists || []).filter(list => {
    if (!list) return false;

    if (term && !(list.name || '').toLowerCase().includes(term)) return false;

    if (pub) {
      const pubs = Array.isArray(list.publishers) ? list.publishers : [];
      if (!pubs.includes(pub)) return false;
    }

    return true;
  });
}

/**
 * Extract unique, sorted publisher names from an array of reading lists.
 *
 * @param {Array} lists
 * @returns {string[]} Sorted unique publisher names
 */
function extractPublishers(lists) {
  const set = new Set();
  for (const list of (lists || [])) {
    if (!list) continue;
    for (const p of (Array.isArray(list.publishers) ? list.publishers : [])) {
      if (p && p.trim()) set.add(p.trim());
    }
  }
  return Array.from(set).sort();
}

module.exports = { filterReadingLists, extractPublishers };
