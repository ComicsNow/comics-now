const fs = require('fs');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Counts detected panels across every page in a guided-view sidecar.
 */
function countSidecarPanels(data) {
  if (!isPlainObject(data) || !isPlainObject(data.pages)) return 0;
  let total = 0;
  for (const page of Object.values(data.pages)) {
    if (isPlainObject(page) && Array.isArray(page.panels)) {
      total += page.panels.length;
    }
  }
  return total;
}

/**
 * A sidecar is usable only when at least one panel was detected. This matches
 * the detection worker, which treats zero-panel results as failures.
 */
function isUsableGuidedSidecarData(data) {
  return isPlainObject(data) && isPlainObject(data.pages) && countSidecarPanels(data) > 0;
}

async function readGuidedSidecar(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function hasUsableGuidedSidecar(filePath) {
  return isUsableGuidedSidecarData(await readGuidedSidecar(filePath));
}

module.exports = {
  countSidecarPanels,
  isUsableGuidedSidecarData,
  readGuidedSidecar,
  hasUsableGuidedSidecar
};
