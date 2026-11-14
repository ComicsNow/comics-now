const fs = require('fs');
const os = require('os');
const path = require('path');
const cryptoVault = require('../server/utils/crypto-vault');

describe('Config Secret Accessors Decryption', () => {
  let configModule;

  beforeEach(() => {
    delete process.env.COMICVINE_API_KEY;
    delete process.env.GOOGLE_BOOKS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.METRON_PASSWORD;
    delete process.env.GCD_PASSWORD;
    jest.resetModules();
    configModule = require('../server/config');
  });

  test('transparently decrypts encrypted ComicVine API key', () => {
    const rawPlain = 'my-secret-comicvine-key-123';
    const encrypted = cryptoVault.encrypt(rawPlain);

    configModule.setComicVineApiKey(encrypted);
    expect(configModule.getComicVineApiKey()).toBe(rawPlain);
  });

  test('handles legacy plaintext ComicVine API key without error', () => {
    const rawPlain = 'legacy-plain-comicvine-key-456';
    configModule.setComicVineApiKey(rawPlain);
    expect(configModule.getComicVineApiKey()).toBe(rawPlain);
  });

  test('transparently decrypts encrypted Metron password', () => {
    const rawPlain = 'my-secret-metron-pass';
    const encrypted = cryptoVault.encrypt(rawPlain);

    configModule.setMetronPassword(encrypted);
    expect(configModule.getMetronPassword()).toBe(rawPlain);
  });

  test('transparently decrypts encrypted GCD password', () => {
    const rawPlain = 'my-secret-gcd-pass';
    const encrypted = cryptoVault.encrypt(rawPlain);

    configModule.setGcdPassword(encrypted);
    expect(configModule.getGcdPassword()).toBe(rawPlain);
  });
});

describe('Config Disk Auto-Encryption (Option A)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-config-crypto-'));
    process.env.DATA_DIR = tempDir;
    process.env.COMICS_SECRET_KEY_PATH = path.join(tempDir, '.app_secret');
    delete process.env.COMICVINE_API_KEY;
    delete process.env.GOOGLE_BOOKS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.METRON_PASSWORD;
    delete process.env.GCD_PASSWORD;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.COMICS_SECRET_KEY_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('loadConfigFromDisk auto-encrypts plaintext secrets in config.json on disk while keeping usernames plaintext', async () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      comicVineApiKey: 'mock-cv-plaintext-key-1234',
      googleBooksApiKey: 'mock-gb-plaintext-key-5678',
      geminiApiKey: 'AIzaSyMockPlaintextGeminiKey9999',
      metronUser: 'mockMetronUser',
      metronPassword: 'mock-metron-plain-password',
      gcdUser: 'mockGcdUser@example.com',
      gcdPassword: 'mock-gcd-plain-password'
    }, null, 2));

    const configModule = require('../server/config');
    const vault = require('../server/utils/crypto-vault');
    await configModule.loadConfigFromDisk();

    const written = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(written.comicVineApiKey).toMatch(/^enc:v1:/);
    expect(written.googleBooksApiKey).toMatch(/^enc:v1:/);
    expect(written.geminiApiKey).toMatch(/^enc:v1:/);
    expect(written.metronPassword).toMatch(/^enc:v1:/);
    expect(written.gcdPassword).toMatch(/^enc:v1:/);

    // Usernames must remain plaintext
    expect(written.metronUser).toBe('mockMetronUser');
    expect(written.gcdUser).toBe('mockGcdUser@example.com');

    // Getters transparently decrypt
    expect(configModule.getComicVineApiKey()).toBe('mock-cv-plaintext-key-1234');
    expect(configModule.getGoogleBooksApiKey()).toBe('mock-gb-plaintext-key-5678');
    expect(configModule.getGeminiApiKey()).toBe('AIzaSyMockPlaintextGeminiKey9999');
    expect(configModule.getMetronPassword()).toBe('mock-metron-plain-password');
    expect(configModule.getGcdPassword()).toBe('mock-gcd-plain-password');

    // Vault decrypts on-disk ciphertext back to original
    expect(vault.decrypt(written.comicVineApiKey)).toBe('mock-cv-plaintext-key-1234');
  });

  test('secret setters automatically encrypt plaintext inputs before saving to config.json', () => {
    const configModule = require('../server/config');
    configModule.setComicVineApiKey('mock-setter-cv-plain');
    configModule.setGoogleBooksApiKey('mock-setter-gb-plain');
    configModule.setGeminiApiKey('mock-setter-gemini-plain');
    configModule.setMetronPassword('mock-setter-metron-plain');
    configModule.setGcdPassword('mock-setter-gcd-plain');

    const rawConfig = configModule.getConfig();
    expect(rawConfig.comicVineApiKey).toMatch(/^enc:v1:/);
    expect(rawConfig.googleBooksApiKey).toMatch(/^enc:v1:/);
    expect(rawConfig.geminiApiKey).toMatch(/^enc:v1:/);
    expect(rawConfig.metronPassword).toMatch(/^enc:v1:/);
    expect(rawConfig.gcdPassword).toMatch(/^enc:v1:/);

    const written = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf8'));
    expect(written.comicVineApiKey).toMatch(/^enc:v1:/);
    expect(written.googleBooksApiKey).toMatch(/^enc:v1:/);
    expect(written.geminiApiKey).toMatch(/^enc:v1:/);
    expect(written.metronPassword).toMatch(/^enc:v1:/);
    expect(written.gcdPassword).toMatch(/^enc:v1:/);
  });
});
