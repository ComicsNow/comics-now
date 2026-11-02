const path = require('path');

function normalizeDirectory(dir) {
  if (typeof dir !== 'string') return null;
  const trimmed = dir.trim();
  if (!trimmed) return null;

  let normalized;
  try {
    normalized = path.normalize(trimmed);
  } catch {
    return null;
  }

  const windowsDriveMatch = /^[A-Za-z]:[\\/]*$/.exec(normalized);
  if (windowsDriveMatch) {
    return `${normalized.slice(0, 2)}${path.sep}`;
  }

  const root = path.parse(normalized).root || '';
  if (normalized === root) {
    return root || normalized;
  }

  return normalized.replace(/[\\/]+$/, '');
}

function sanitizeDirectories(list) {
  if (!Array.isArray(list)) return [];
  const sanitized = [];
  const seen = new Set();
  for (const entry of list) {
    const pathValue = typeof entry === 'string' ? entry : entry.path;
    const normalized = normalizeDirectory(pathValue);
    if (normalized && !seen.has(normalized)) {
      sanitized.push(typeof entry === 'string' ? { path: normalized, hierarchyMode: 'metadata' } : { ...entry, path: normalized });
      seen.add(normalized);
    }
  }
  return sanitized;
}

function getPublicLibraries(libraries) {
  return (libraries || []).map((lib, index) => ({
    id: `lib_${index}`,
    name: path.basename(lib.path) || `Library ${index + 1}`,
    hierarchyMode: lib.hierarchyMode
  }));
}

function getPathFromLibraryId(libraries, libId) {
  const match = /^lib_(\d+)$/.exec(libId);
  if (!match) return null;
  const index = parseInt(match[1], 10);
  if (libraries && index >= 0 && index < libraries.length) {
    return libraries[index].path;
  }
  return null;
}

function getLibraryIdFromPath(libraries, absolutePath) {
  const libs = libraries || [];
  const index = libs.findIndex(lib => absolutePath === lib.path || absolutePath.startsWith(lib.path + path.sep));
  if (index === -1) return null;
  return `lib_${index}`;
}

module.exports = {
  normalizeDirectory,
  sanitizeDirectories,
  getPublicLibraries,
  getPathFromLibraryId,
  getLibraryIdFromPath
};
