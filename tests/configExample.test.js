const fs = require('fs');
const path = require('path');

describe('config.example.json Integrity and Validity', () => {
  const examplePath = path.join(__dirname, '..', 'config.example.json');

  test('file exists', () => {
    expect(fs.existsSync(examplePath)).toBe(true);
  });

  test('is strictly valid JSON and parseable by JSON.parse', () => {
    const raw = fs.readFileSync(examplePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('contains up-to-date configuration fields and no obsolete keys', () => {
    const raw = fs.readFileSync(examplePath, 'utf8');
    const parsed = JSON.parse(raw);

    // Section notice and structured header checks
    expect(parsed._notice).toBeDefined();
    expect(parsed['// [BOOT] 1. Server, Network & Reverse Proxy']).toBeDefined();
    expect(parsed['// [UI] 2. Storage & Ingestion']).toBeDefined();
    expect(parsed['// [UI] 3. Scrapers & Credentials']).toBeDefined();
    expect(parsed['// [UI] 4. Google Gemini AI']).toBeDefined();
    expect(parsed['// [UI] 5. Tag Comics Now! Subsystem']).toBeDefined();

    // Should not contain non-existent/phantom keys
    expect(parsed.taggerEngine).toBeUndefined();
    expect(parsed.taggerTextEngine).toBeUndefined();

    // Core server & storage fields
    expect(typeof parsed.port).toBe('number');
    expect(typeof parsed.baseUrl).toBe('string');
    expect(typeof parsed.comicsLocation).toBe('string');
    expect(Array.isArray(parsed.libraries)).toBe(true);
    expect(parsed.libraries.length).toBeGreaterThan(0);
    expect(parsed.libraries[0]).toHaveProperty('path');
    expect(parsed.libraries[0]).toHaveProperty('hierarchyMode');

    // Modern ingestion & storage
    expect(parsed.allowed_formats).toBeDefined();
    expect(parsed.metadata_storage).toBeDefined();
    expect(typeof parsed.scanIntervalMinutes).toBe('number');

    // Tagger modern configuration
    expect(parsed.taggerMode).toBe('new');
    expect(parsed.taggerServiceUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(typeof parsed.taggerLowerThreshold).toBe('number');
    expect(typeof parsed.taggerUpperThreshold).toBe('number');
    expect(Array.isArray(parsed.taggerEnabledSources)).toBe(true);

    // AI & Gemini Cover Matching
    expect(parsed.geminiModel).toBeDefined();
    expect(typeof parsed.geminiCoverMatchEnabled).toBe('boolean');
    expect(typeof parsed.geminiCoverDailyCap).toBe('number');

    // Security & Proxy
    expect(parsed.trustProxy).toBeDefined();
    expect(parsed.cors).toBeDefined();
    expect(parsed.authentication).toBeDefined();
  });
});
