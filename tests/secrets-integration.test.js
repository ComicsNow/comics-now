const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

describe('Full Secrets Migration & Integration Suite', () => {
  let tempDir;
  let keyFilePath;
  let cryptoVault;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-secrets-int-'));
    keyFilePath = path.join(tempDir, '.app_secret');
    delete process.env.COMICS_SECRET_KEY;
    delete process.env.COMICS_SECRET_KEY_FILE;
    process.env.COMICS_SECRET_KEY_PATH = keyFilePath;

    jest.resetModules();
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

  test('end-to-end migration converts plaintext secrets to AES-256-GCM and preserves reading data', async () => {
    // Simulated SQLite state for existing deployment
    const settingsDb = new Map([
      ['comicVineApiKey', 'mockComicVineApiKey0123456789abcdef5678'],
      ['geminiApiKey', JSON.stringify('AIzaSyMockGeminiKeyForUnitTestingOnly12')],
      ['metronPassword', JSON.stringify('mock-metron-password-sequence-999')],
      ['gcdPassword', JSON.stringify('mock-gcd-password-mutable-888')],
      ['googleBooksApiKey', JSON.stringify('AIzaSyMockGoogleBooksKeyForTesting0034')],
      ['guided.modalTokenSecret', JSON.stringify('as-mockModalTokenSecret1234567890')],
      ['folderRules', '{"hierarchy":["publisher"]}'],
      ['scanInterval', '1400']
    ]);

    const mockDb = {
      all: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('FROM settings')) {
          return Array.from(settingsDb.entries()).map(([key, value]) => ({ key, value }));
        }
        return [];
      }),
      run: jest.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('UPDATE settings SET value = ? WHERE key = ?')) {
          const [val, key] = params;
          settingsDb.set(key, val);
          return { changes: 1 };
        }
        return { changes: 0 };
      })
    };

    const { migratePlaintextSecrets } = require('../server/services/secrets-migrator');

    // 1. Run migration
    const stats = await migratePlaintextSecrets(mockDb, cryptoVault);
    expect(stats.migratedCount).toBe(6);

    // 2. Verify all 6 secrets are now encrypted
    const encryptedKeys = [
      'comicVineApiKey',
      'geminiApiKey',
      'metronPassword',
      'gcdPassword',
      'googleBooksApiKey',
      'guided.modalTokenSecret'
    ];

    for (const key of encryptedKeys) {
      const val = settingsDb.get(key);
      expect(typeof val).toBe('string');
      expect(val.startsWith('enc:v1:')).toBe(true);
    }

    // 3. Verify non-secrets are untouched
    expect(settingsDb.get('folderRules')).toBe('{"hierarchy":["publisher"]}');
    expect(settingsDb.get('scanInterval')).toBe('1400');

    // 4. Verify decrypting restores original values perfectly
    expect(cryptoVault.decrypt(settingsDb.get('comicVineApiKey'))).toBe('mockComicVineApiKey0123456789abcdef5678');
    expect(cryptoVault.decrypt(settingsDb.get('geminiApiKey'))).toBe('AIzaSyMockGeminiKeyForUnitTestingOnly12');
    expect(cryptoVault.decrypt(settingsDb.get('metronPassword'))).toBe('mock-metron-password-sequence-999');
    expect(cryptoVault.decrypt(settingsDb.get('gcdPassword'))).toBe('mock-gcd-password-mutable-888');
    expect(cryptoVault.decrypt(settingsDb.get('googleBooksApiKey'))).toBe('AIzaSyMockGoogleBooksKeyForTesting0034');
    expect(cryptoVault.decrypt(settingsDb.get('guided.modalTokenSecret'))).toBe('as-mockModalTokenSecret1234567890');

    // 5. Verify masked previews never leak the secrets
    expect(cryptoVault.mask(settingsDb.get('comicVineApiKey'))).toBe('••••••••••••5678');
    expect(cryptoVault.mask(settingsDb.get('geminiApiKey'))).toBe('••••••••••••ly12');
  });

  test('config getters transparently decrypt all encrypted secrets without leaking enc:v1: ciphertext', () => {
    const config = require('../server/config');
    const plainSecrets = {
      comicVineApiKey: 'mockComicVineApiKey0123456789abcdef5678',
      geminiApiKey: 'AIzaSyMockGeminiKeyForUnitTestingOnly12',
      metronPassword: 'mock-metron-password-sequence-999',
      gcdPassword: 'mock-gcd-password-mutable-888',
      googleBooksApiKey: 'AIzaSyMockGoogleBooksKeyForTesting0034'
    };

    config.setComicVineApiKey(cryptoVault.encrypt(plainSecrets.comicVineApiKey), true);
    config.setGeminiApiKey(cryptoVault.encrypt(plainSecrets.geminiApiKey), true);
    config.setMetronPassword(cryptoVault.encrypt(plainSecrets.metronPassword), true);
    config.setGcdPassword(cryptoVault.encrypt(plainSecrets.gcdPassword), true);
    config.setGoogleBooksApiKey(cryptoVault.encrypt(plainSecrets.googleBooksApiKey), true);

    expect(config.getComicVineApiKey()).toBe(plainSecrets.comicVineApiKey);
    expect(config.getGeminiApiKey()).toBe(plainSecrets.geminiApiKey);
    expect(config.getMetronPassword()).toBe(plainSecrets.metronPassword);
    expect(config.getGcdPassword()).toBe(plainSecrets.gcdPassword);
    expect(config.getGoogleBooksApiKey()).toBe(plainSecrets.googleBooksApiKey);

    for (const getter of [
      config.getComicVineApiKey,
      config.getGeminiApiKey,
      config.getMetronPassword,
      config.getGcdPassword,
      config.getGoogleBooksApiKey
    ]) {
      expect(getter().startsWith('enc:v1:')).toBe(false);
    }
  });
});
