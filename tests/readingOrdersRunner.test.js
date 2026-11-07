/**
 * Unit tests for reading-orders-runner.js
 */
const { ReadingOrdersRunner } = require('../server/services/reading-orders-runner');

describe('ReadingOrdersRunner', () => {
  let runner;

  beforeEach(() => {
    runner = new ReadingOrdersRunner({ minDelayMs: 10, minJitterMs: 0, maxJitterMs: 0 });
  });

  it('initializes in idle state', () => {
    const status = runner.getStatus();
    expect(status.status).toBe('idle');
    expect(status.progress.current).toBe(0);
    expect(status.progress.total).toBe(0);
  });

  it('skips crawl when sitemap ETag returns 304 Not Modified', async () => {
    // Mock checkSitemapEtag returning 304
    runner._fetchSitemapHeaders = jest.fn().mockResolvedValue({
      status: 304,
      etag: '"test-etag-123"',
    });
    runner.lastSitemapEtag = '"test-etag-123"';
    runner.getOrderCount = jest.fn().mockReturnValue(200);

    const result = await runner.startSync({ mode: 'both' });
    expect(result.skipped).toBe(true);
    expect(result.scrapedCount).toBe(0);
    expect(runner.getStatus().status).toBe('idle');
  });

  it('prevents multiple concurrent sync runs', async () => {
    runner.isSyncing = true;
    await expect(runner.startSync()).rejects.toThrow(/already in progress/i);
  });
});
