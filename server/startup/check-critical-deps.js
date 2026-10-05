// Critical runtime modules that must be present for the app to boot.
const CRITICAL_DEPS = [
  'express',
  'cors',
  'helmet',
  'onnxruntime-node',
  'sharp',
  'better-sqlite3',
  'express-rate-limit'
];

/**
 * Verify critical node modules are installed before boot.
 *
 * Issue #7: the previous implementation ran `npm install --production` from the
 * running service and then exited 0. That mutated node_modules from the network
 * at boot (unauditable, bypasses the lockfile) and the zero exit code meant
 * systemd (Restart=on-failure) and Docker never restarted — the service just
 * stopped. We now fail fast with an actionable message and a NON-ZERO exit; we
 * never shell out to a package manager.
 *
 * Returns the list of missing modules (useful when `exit` is stubbed in tests).
 */
function checkCriticalDeps({
  deps = CRITICAL_DEPS,
  resolve = require.resolve,
  log = console.error,
  exit = process.exit
} = {}) {
  const missing = deps.filter((dep) => {
    try {
      resolve(dep);
      return false;
    } catch {
      return true;
    }
  });

  if (missing.length > 0) {
    log(
      `\x1b[31mMissing required modules: ${missing.join(', ')}.\x1b[0m\n` +
      'Install dependencies and restart, e.g.: npm ci   (or: npm install --omit=dev)'
    );
    exit(1);
  }

  return missing;
}

module.exports = { checkCriticalDeps, CRITICAL_DEPS };
