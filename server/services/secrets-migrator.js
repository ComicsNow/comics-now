const fs = require('node:fs');
const path = require('node:path');
const defaultVault = require('../utils/crypto-vault');
const { ROOT_DIR } = require('../constants');

const SCHEDULER_SECRET_KEYS = [
  'comicvine_api_key',
  'google_books_api_key',
  'metron_pass',
  'gcd_pass'
];

const KNOWN_SECRET_KEYS = new Set([
  'geminiApiKey',
  'metronPassword',
  'gcdPassword',
  'comicVineApiKey',
  'googleBooksApiKey',
  'guided.modalTokenSecret',
  'impersonation_secret'
]);

/**
 * Automatically inspects the SQLite settings table and encrypts any legacy
 * plaintext credentials in-place using AES-256-GCM.
 *
 * Guarantees:
 * - Strictly non-destructive (only touches known secret rows in settings).
 * - Fully idempotent: already-encrypted rows (starting with enc:v1:) are skipped.
 * - Backward-compatible: decryptor supports reading legacy plaintext.
 *
 * @param {object} db - Database wrapper with .all() and .run() methods
 * @param {object} [vault] - Crypto vault instance (defaults to server/utils/crypto-vault)
 * @returns {Promise<{migratedCount: number, untouchedCount: number}>}
 */
async function migratePlaintextSecrets(db, vault = defaultVault) {
  if (!db || typeof db.all !== 'function') {
    return { migratedCount: 0, untouchedCount: 0 };
  }

  let migratedCount = 0;
  let untouchedCount = 0;

  try {
    const rows = await db.all('SELECT key, value FROM settings');
    if (!Array.isArray(rows)) return { migratedCount: 0, untouchedCount: 0 };

    for (const row of rows) {
      if (!KNOWN_SECRET_KEYS.has(row.key)) {
        untouchedCount++;
        continue;
      }

      let rawVal = row.value;
      if (rawVal === null || rawVal === undefined || rawVal === '') {
        untouchedCount++;
        continue;
      }

      // Handle JSON-encoded values (e.g. "\"AIzaSy...\"")
      if (typeof rawVal === 'string' && (rawVal.startsWith('"') && rawVal.endsWith('"'))) {
        try {
          rawVal = JSON.parse(rawVal);
        } catch (_) {}
      }

      if (typeof rawVal === 'string' && rawVal.startsWith('enc:v1:')) {
        // Already encrypted
        untouchedCount++;
        continue;
      }

      // Legacy plaintext found: encrypt in-place
      const encrypted = vault.encrypt(String(rawVal));
      if (encrypted && encrypted !== rawVal) {
        await db.run('UPDATE settings SET value = ? WHERE key = ?', [encrypted, row.key]);
        migratedCount++;
      } else {
        untouchedCount++;
      }
    }
  } catch (err) {
    console.error(`[SECRETS-MIGRATION] Migration error: ${err.message}`);
  }

  return { migratedCount, untouchedCount };
}

/**
 * Strips any plaintext API keys or passwords from Python tagger scheduler_config.json files.
 * Credentials are passed per-request from the Node.js encrypted vault in memory and must
 * not persist in plaintext inside scheduler_config.json on disk.
 *
 * @param {string[]} [targetPaths] - Optional list of scheduler_config.json paths
 * @returns {number} Number of files scrubbed
 */
function scrubSchedulerConfigSecrets(targetPaths) {
  const dataDir = process.env.DATA_DIR || ROOT_DIR;
  const candidates = Array.isArray(targetPaths) && targetPaths.length > 0
    ? targetPaths
    : [
        path.join(ROOT_DIR, 'tagger', 'scheduler_config.json'),
        path.join(dataDir, 'scheduler_config.json')
      ];

  let scrubbedFiles = 0;
  const seen = new Set();

  for (const filePath of candidates) {
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);

    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.config || typeof parsed.config !== 'object') {
        continue;
      }

      let changed = false;
      for (const key of SCHEDULER_SECRET_KEYS) {
        if (typeof parsed.config[key] === 'string' && parsed.config[key] !== '') {
          parsed.config[key] = '';
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(filePath, JSON.stringify(parsed, null, 4), { mode: 0o600 });
        scrubbedFiles++;
      }
    } catch (err) {
      console.error(`[SECRETS-MIGRATION] Failed to scrub ${filePath}: ${err.message}`);
    }
  }

  return scrubbedFiles;
}

module.exports = {
  KNOWN_SECRET_KEYS,
  SCHEDULER_SECRET_KEYS,
  migratePlaintextSecrets,
  scrubSchedulerConfigSecrets
};
