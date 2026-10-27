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
