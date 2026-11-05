const fs = require('fs');
const path = require('path');

/**
 * Decides what to do with a converted CBZ's kept original during a move.
 * Actions: none (no link), clear (original missing), keep (same directory),
 * collision (destination filename taken), move (relocate alongside the CBZ).
 */
function planOriginalMove(originalPath, destDir, deps = {}) {
  const exists = deps.existsSync || fs.existsSync;

  if (!originalPath) return { action: 'none' };
  if (!exists(originalPath)) {
    return { action: 'clear', oldOriginalPath: originalPath, newOriginalPath: null };
  }

  const newOriginalPath = path.join(destDir, path.basename(originalPath));
  if (path.resolve(newOriginalPath) === path.resolve(originalPath)) {
    return { action: 'keep', oldOriginalPath: originalPath, newOriginalPath };
  }
  if (exists(newOriginalPath)) {
    return { action: 'collision', oldOriginalPath: originalPath, newOriginalPath };
  }
  return { action: 'move', oldOriginalPath: originalPath, newOriginalPath };
}

module.exports = { planOriginalMove };
