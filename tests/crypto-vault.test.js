const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

describe('Crypto Vault & Secrets Management', () => {
  let tempDir;
  let keyFilePath;
  let cryptoVault;

  beforeEach(() => {
    // Isolated temporary directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-vault-test-'));
    keyFilePath = path.join(tempDir, '.app_secret');
    delete process.env.COMICS_SECRET_KEY;
    delete process.env.COMICS_SECRET_KEY_FILE;

    // Fresh instance of module
    jest.resetModules();
    process.env.COMICS_SECRET_KEY_PATH = keyFilePath;
    cryptoVault = require('../server/utils/crypto-vault');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
    delete process.env.COMICS_SECRET_KEY;
    delete process.env.COMICS_SECRET_KEY_FILE;
    delete process.env.COMICS_SECRET_KEY_PATH;
  });

  describe('Key Initialization', () => {
    test('generates a new 32-byte master key if none exists', () => {
      expect(fs.existsSync(keyFilePath)).toBe(false);
      const key = cryptoVault.getMasterKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
      expect(fs.existsSync(keyFilePath)).toBe(true);

      // Subsequent call loads the identical key
      const key2 = cryptoVault.getMasterKey();
      expect(key.equals(key2)).toBe(true);
    });

    test('respects COMICS_SECRET_KEY environment variable', () => {
      process.env.COMICS_SECRET_KEY = 'custom-user-provided-secret-key';
      jest.resetModules();
      cryptoVault = require('../server/utils/crypto-vault');

      const key = cryptoVault.getMasterKey();
      const expected = crypto.createHash('sha256').update('custom-user-provided-secret-key').digest();
      expect(key.equals(expected)).toBe(true);
      // Key file should not be created if env var is supplied
      expect(fs.existsSync(keyFilePath)).toBe(false);
    });

    test('respects COMICS_SECRET_KEY_FILE environment variable', () => {
      const secretFile = path.join(tempDir, 'docker_secret.txt');
      fs.writeFileSync(secretFile, 'secret-from-docker-file\n');
      process.env.COMICS_SECRET_KEY_FILE = secretFile;

      jest.resetModules();
      cryptoVault = require('../server/utils/crypto-vault');

      const key = cryptoVault.getMasterKey();
      const expected = crypto.createHash('sha256').update('secret-from-docker-file').digest();
      expect(key.equals(expected)).toBe(true);
    });
  });

  describe('Encryption & Decryption (AES-256-GCM)', () => {
    test('encrypts plaintext into tagged enc:v1 format', () => {
      const plain = 'AIzaSyMockGeminiKeyForUnitTestingOnly12';
      const enc = cryptoVault.encrypt(plain);

      expect(typeof enc).toBe('string');
      expect(enc.startsWith('enc:v1:')).toBe(true);
      const parts = enc.split(':');
      expect(parts.length).toBe(5); // enc : v1 : iv : tag : ciphertext
    });

    test('decrypts encrypted string back to original plaintext', () => {
      const plain = 'MySuperSecretPassword-123!';
      const enc = cryptoVault.encrypt(plain);
      const decrypted = cryptoVault.decrypt(enc);

      expect(decrypted).toBe(plain);
    });

    test('is idempotent: encrypting an already encrypted string does not double-encrypt', () => {
      const plain = 'already-encrypted-token';
      const enc1 = cryptoVault.encrypt(plain);
      const enc2 = cryptoVault.encrypt(enc1);

      expect(enc1).toBe(enc2);
    });

    test('backward compatibility: decrypting legacy plaintext returns it unchanged', () => {
      const legacyPlain = 'mock-gcd-password-mutable-888';
      const result = cryptoVault.decrypt(legacyPlain);

      expect(result).toBe(legacyPlain);
    });

    test('handles empty, null, or undefined values safely', () => {
      expect(cryptoVault.encrypt('')).toBe('');
      expect(cryptoVault.encrypt(null)).toBe(null);
      expect(cryptoVault.encrypt(undefined)).toBe(undefined);

      expect(cryptoVault.decrypt('')).toBe('');
      expect(cryptoVault.decrypt(null)).toBe(null);
      expect(cryptoVault.decrypt(undefined)).toBe(undefined);
    });
  });

  describe('Secret Masking for UI Display', () => {
    test('masks long keys keeping only last 4 characters', () => {
      const plain = 'mockComicVineApiKey0123456789abcdef5678';
      const masked = cryptoVault.mask(plain);
      expect(masked).toBe('••••••••••••5678');
    });

    test('masks encrypted strings transparently', () => {
      const plain = 'AIzaSyMockGoogleBooksKeyForTesting0034';
      const enc = cryptoVault.encrypt(plain);
      const masked = cryptoVault.mask(enc);
      expect(masked).toBe('••••••••••••0034');
    });

    test('masks short passwords safely without leaking characters', () => {
      const plain = 'pass123';
      const masked = cryptoVault.mask(plain);
      expect(masked).toBe('••••••••');
    });

    test('isMasked detects placeholder values', () => {
      expect(cryptoVault.isMasked('••••••••••••5678')).toBe(true);
      expect(cryptoVault.isMasked('••••••••')).toBe(true);
      expect(cryptoVault.isMasked('mockComicVineApiKey0123456789abcdef5678')).toBe(false);
      expect(cryptoVault.isMasked('')).toBe(false);
    });
  });

  describe('Database In-Place Migration (Existing vs New Installs)', () => {
    test('migrates legacy plaintext settings to encrypted without altering other tables', async () => {
      const mockSettings = {
        geminiApiKey: 'AIzaSyMockGeminiKeyForUnitTestingOnly12',
        metronPassword: 'mock-metron-password-sequence-999',
        comicVineApiKey: 'mockComicVineApiKey0123456789abcdef5678',
        folderRules: '{"hierarchy":["publisher"]}', // non-secret: should remain untouched
        scanInterval: '1400'                        // non-secret: should remain untouched
      };

      const mockDb = {
        all: jest.fn().mockResolvedValue([
          { key: 'geminiApiKey', value: JSON.stringify(mockSettings.geminiApiKey) },
          { key: 'metronPassword', value: JSON.stringify(mockSettings.metronPassword) },
          { key: 'comicVineApiKey', value: mockSettings.comicVineApiKey },
          { key: 'folderRules', value: mockSettings.folderRules },
          { key: 'scanInterval', value: mockSettings.scanInterval }
        ]),
        run: jest.fn().mockResolvedValue({ changes: 1 })
      };

      const { migratePlaintextSecrets } = require('../server/services/secrets-migrator');
      const stats = await migratePlaintextSecrets(mockDb, cryptoVault);

      expect(stats.migratedCount).toBe(3);
      expect(stats.untouchedCount).toBe(2);

      // Verify DB updates were called only for secrets
      expect(mockDb.run).toHaveBeenCalledTimes(3);
      for (const call of mockDb.run.mock.calls) {
        const [sql, [encryptedVal, key]] = call;
        expect(sql).toContain('UPDATE settings SET value = ? WHERE key = ?');
        expect(encryptedVal.startsWith('enc:v1:')).toBe(true);
        expect(['geminiApiKey', 'metronPassword', 'comicVineApiKey']).toContain(key);
      }
    });

    test('is idempotent: running migration twice makes 0 changes on second run', async () => {
      const alreadyEncrypted = cryptoVault.encrypt('secret-key-123');
      const mockDb = {
        all: jest.fn().mockResolvedValue([
          { key: 'geminiApiKey', value: JSON.stringify(alreadyEncrypted) }
        ]),
        run: jest.fn()
      };

      const { migratePlaintextSecrets } = require('../server/services/secrets-migrator');
      const stats = await migratePlaintextSecrets(mockDb, cryptoVault);

      expect(stats.migratedCount).toBe(0);
      expect(mockDb.run).not.toHaveBeenCalled();
    });
  });
});
