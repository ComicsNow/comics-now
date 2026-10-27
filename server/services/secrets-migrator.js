const defaultVault = require('../utils/crypto-vault');

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

module.exports = {
  KNOWN_SECRET_KEYS,
  migratePlaintextSecrets
};
