const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_FILE = path.join(__dirname, '../../data/.app_secret');

/**
 * Resolves the 32-byte master key for AES-256-GCM encryption.
 * Priority:
 * 1. COMICS_SECRET_KEY environment variable (hashed via SHA-256)
 * 2. COMICS_SECRET_KEY_FILE environment variable (e.g. Docker secret)
 * 3. File on disk (COMICS_SECRET_KEY_PATH or data/.app_secret)
 */
function getMasterKey() {
  if (process.env.COMICS_SECRET_KEY) {
    return crypto.createHash('sha256').update(process.env.COMICS_SECRET_KEY).digest();
  }

  if (process.env.COMICS_SECRET_KEY_FILE && fs.existsSync(process.env.COMICS_SECRET_KEY_FILE)) {
    const raw = fs.readFileSync(process.env.COMICS_SECRET_KEY_FILE, 'utf8').trim();
    return crypto.createHash('sha256').update(raw).digest();
  }

  const keyPath = process.env.COMICS_SECRET_KEY_PATH || DEFAULT_KEY_FILE;

  if (fs.existsSync(keyPath)) {
    const data = fs.readFileSync(keyPath);
    if (data.length === 32) return data;
    return crypto.createHash('sha256').update(data).digest();
  }

  // Auto-generate a secure 256-bit key on first run
  const generatedKey = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, generatedKey, { mode: 0o600 });
  } catch (err) {
    // Fallback if filesystem is read-only
    console.warn(`[CRYPTO] Could not write secret keyfile to ${keyPath}: ${err.message}. Using ephemeral key.`);
  }
  return generatedKey;
}

/**
 * Encrypts a plaintext string into tagged format: enc:v1:<iv>:<tag>:<ciphertext>
 * Safe & idempotent: if text is already encrypted, returns it unchanged.
 */
function encrypt(text) {
  if (text === null || text === undefined || text === '') return text;
  if (typeof text !== 'string') text = String(text);
  if (text.startsWith('enc:v1:')) return text; // Idempotent

  try {
    const masterKey = getMasterKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  } catch (err) {
    console.error(`[CRYPTO] Encryption error: ${err.message}`);
    return text; // Graceful fallback
  }
}

/**
 * Decrypts a tagged ciphertext string back to plaintext.
 * Backward compatible: if string is not encrypted (legacy plaintext), returns it as-is!
 */
function decrypt(text) {
  if (text === null || text === undefined || text === '') return text;
  if (typeof text !== 'string') return text;
  if (!text.startsWith('enc:v1:')) return text; // Legacy plaintext passthrough

  const parts = text.split(':');
  if (parts.length !== 5) return text;

  try {
    const masterKey = getMasterKey();
    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const encrypted = Buffer.from(parts[4], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');
  } catch (err) {
    console.error(`[CRYPTO] Decryption error: ${err.message}`);
    return null;
  }
}

/**
 * Masks a secret string for safe display in UI/API responses.
 * Never leaks the full secret.
 */
function mask(text) {
  if (!text || typeof text !== 'string') return '';
  const plain = decrypt(text);
  if (!plain) return '';
  if (plain.length <= 8) return '••••••••';
  return '••••••••••••' + plain.slice(-4);
}

/**
 * Checks whether a given string is a masked placeholder (user did not change it).
 */
function isMasked(value) {
  return typeof value === 'string' && value.includes('••••');
}

module.exports = {
  getMasterKey,
  encrypt,
  decrypt,
  mask,
  isMasked
};
