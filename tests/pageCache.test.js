const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  setCustomCacheDir,
  getCacheDir,
  getPageCacheKey,
  getPageCachePath,
  hasPageCache,
  getPageCacheBuffer,
  setPageCacheBuffer,
  pruneCacheIfNeeded,
  getPageCacheStats,
  initPageCache
} = require('../server/services/page-cache');
const config = require('../server/config');

describe('page-cache service', () => {
  let testCacheDir;
  let originalMaxMb;

  beforeEach(() => {
    originalMaxMb = config.getPageCacheMaxMb();
    testCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-cache-test-'));
    setCustomCacheDir(testCacheDir);
  });

  afterEach(() => {
    config.setPageCacheMaxMb(originalMaxMb, true);
    try {
      if (fs.existsSync(testCacheDir)) {
        fs.rmSync(testCacheDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test('generates deterministic cache keys', () => {
    const key1 = getPageCacheKey('/comics/issue1.cbz', 12345678, 'page01.jpg');
    const key2 = getPageCacheKey('/comics/issue1.cbz', 12345678, 'page01.jpg');
    const key3 = getPageCacheKey('/comics/issue1.cbz', 12345678, 'page01.jpg', 1600);
    const key4 = getPageCacheKey('/comics/issue1.cbz', 99999999, 'page01.jpg');

    expect(key1).toBe(key2);
    expect(key1.endsWith('.bin')).toBe(true);
    expect(key3.endsWith('_w1600.webp')).toBe(true);
    expect(key1).not.toBe(key3);
    expect(key1).not.toBe(key4);
  });

  test('stores and retrieves cached buffers', async () => {
    const key = getPageCacheKey('/path/test.cbz', 1000, '01.jpg');
    const data = Buffer.from('test image payload 12345');

    expect(await hasPageCache(key)).toBe(false);
    expect(await getPageCacheBuffer(key)).toBeNull();

    await setPageCacheBuffer(key, data);

    expect(await hasPageCache(key)).toBe(true);
    const retrieved = await getPageCacheBuffer(key);
    expect(retrieved).not.toBeNull();
    expect(retrieved.toString()).toBe(data.toString());
  });

  test('ignores empty buffers', async () => {
    const key = getPageCacheKey('/path/empty.cbz', 1, '01.jpg', 1600);
    await setPageCacheBuffer(key, Buffer.alloc(0));
    expect(await hasPageCache(key)).toBe(false);
  });

  test('prunes oldest files when cache cap is breached (LRU)', async () => {
    const keyOld = 'file_old.bin';
    const keyMid = 'file_mid.bin';
    const keyNew = 'file_new.bin';

    const buf10k = Buffer.alloc(10 * 1024, 'a');

    await setPageCacheBuffer(keyOld, buf10k);
    await setPageCacheBuffer(keyMid, buf10k);
    await setPageCacheBuffer(keyNew, buf10k);

    const now = Date.now();
    fs.utimesSync(getPageCachePath(keyOld), new Date(now - 1800000), new Date(now - 1800000));
    fs.utimesSync(getPageCachePath(keyMid), new Date(now - 900000), new Date(now - 900000));
    fs.utimesSync(getPageCachePath(keyNew), new Date(now), new Date(now));

    // Cap at 25KB (target 85% = 21.25KB). Oldest file (10KB) must be evicted.
    await pruneCacheIfNeeded(25 * 1024);

    expect(await hasPageCache(keyOld)).toBe(false);
    expect(await hasPageCache(keyMid)).toBe(true);
    expect(await hasPageCache(keyNew)).toBe(true);
  });

  test('reports usage statistics and excludes in-flight temp files', async () => {
    fs.writeFileSync(getPageCachePath('stats_a.bin'), Buffer.alloc(1024));
    fs.writeFileSync(getPageCachePath('stats_b.bin'), Buffer.alloc(2048));
    fs.writeFileSync(path.join(testCacheDir, 'inflight.tmp.123.abc'), Buffer.alloc(4096));

    const stats = await getPageCacheStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.totalBytes).toBe(3072);
    expect(stats.maxMb).toBe(config.getPageCacheMaxMb());
    expect(stats.maxBytes).toBe(config.getPageCacheMaxMb() * 1024 * 1024);
  });

  test('uses the live config cap when no override is supplied', async () => {
    const now = Date.now();
    const files = ['live_old.bin', 'live_mid.bin', 'live_new.bin'];
    files.forEach((name, i) => {
      const fullPath = path.join(testCacheDir, name);
      fs.writeFileSync(fullPath, '');
      fs.truncateSync(fullPath, 30 * 1024 * 1024);
      const t = new Date(now - (files.length - i) * 60000);
      fs.utimesSync(fullPath, t, t);
    });

    config.setPageCacheMaxMb(50, true); // 50 MiB cap -> 42.5 MiB target
    await pruneCacheIfNeeded();

    const stats = await getPageCacheStats();
    expect(stats.totalBytes).toBeLessThanOrEqual(42.5 * 1024 * 1024);
    expect(fs.existsSync(path.join(testCacheDir, 'live_old.bin'))).toBe(false);
    expect(fs.existsSync(path.join(testCacheDir, 'live_mid.bin'))).toBe(false);
    expect(fs.existsSync(path.join(testCacheDir, 'live_new.bin'))).toBe(true);
  });

  test('survives re-initialization (reboot persistence)', async () => {
    const key = getPageCacheKey('/path/reboot.cbz', 2000, '02.webp', 1600);
    const data = Buffer.from('persistent data across restart');

    await setPageCacheBuffer(key, data);
    expect(await hasPageCache(key)).toBe(true);

    await initPageCache();

    expect(await hasPageCache(key)).toBe(true);
    const retrieved = await getPageCacheBuffer(key);
    expect(retrieved.toString()).toBe(data.toString());
  });
});
