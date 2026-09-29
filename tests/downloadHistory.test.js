/**
 * Pure logic for the 3-tab downloads modal + 24h history window.
 */
const {
  DOWNLOAD_TTL_MS,
  partitionDownloads,
  selectExpired,
  computeBackoffMs,
  nextRangeHeader
} = require('../public/js/offline/download-history.js');

const HOUR = 60 * 60 * 1000;

describe('download-history: partitioning into In Progress / Downloaded / Failed', () => {
  const now = 1_000_000_000_000;

  const items = [
    { id: 'a', status: 'pending', addedAt: now - 5 * HOUR },
    { id: 'b', status: 'downloading', addedAt: now - 4 * HOUR },
    { id: 'c', status: 'paused', addedAt: now - 3 * HOUR },
    { id: 'd', status: 'completed', completedAt: now - 2 * HOUR },   // recent
    { id: 'e', status: 'completed', completedAt: now - 30 * HOUR },  // expired
    { id: 'f', status: 'error', failedAt: now - 1 * HOUR },          // recent
    { id: 'g', status: 'error', failedAt: now - 48 * HOUR }          // expired
  ];

  test('In Progress = pending + downloading + paused, regardless of age', () => {
    const { inProgress } = partitionDownloads(items, now);
    expect(inProgress.map(i => i.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('Downloaded = completed within last 24h only', () => {
    const { downloaded } = partitionDownloads(items, now);
    expect(downloaded.map(i => i.id)).toEqual(['d']);
  });

  test('Failed = errored within last 24h only', () => {
    const { failed } = partitionDownloads(items, now);
    expect(failed.map(i => i.id)).toEqual(['f']);
  });

  test('most-recent-first ordering within Downloaded/Failed', () => {
    const two = [
      { id: 'old', status: 'completed', completedAt: now - 10 * HOUR },
      { id: 'new', status: 'completed', completedAt: now - 1 * HOUR }
    ];
    const { downloaded } = partitionDownloads(two, now);
    expect(downloaded.map(i => i.id)).toEqual(['new', 'old']);
  });

  test('the 24h boundary is exclusive of items older than TTL', () => {
    const edge = [
      { id: 'just-in', status: 'completed', completedAt: now - (DOWNLOAD_TTL_MS - 1000) },
      { id: 'just-out', status: 'completed', completedAt: now - (DOWNLOAD_TTL_MS + 1000) }
    ];
    const { downloaded } = partitionDownloads(edge, now);
    expect(downloaded.map(i => i.id)).toEqual(['just-in']);
  });
});

describe('download-history: selectExpired (items to drop from storage)', () => {
  const now = 1_000_000_000_000;
  test('returns completed/errored items older than 24h; keeps in-progress forever', () => {
    const items = [
      { id: 'keep-progress', status: 'downloading', addedAt: now - 100 * HOUR },
      { id: 'keep-recent', status: 'completed', completedAt: now - 2 * HOUR },
      { id: 'drop-old-done', status: 'completed', completedAt: now - 25 * HOUR },
      { id: 'drop-old-fail', status: 'error', failedAt: now - 25 * HOUR }
    ];
    const expired = selectExpired(items, now).map(i => i.id).sort();
    expect(expired).toEqual(['drop-old-done', 'drop-old-fail']);
  });
});

describe('download-history: retry backoff', () => {
  test('exponential backoff with cap', () => {
    expect(computeBackoffMs(0)).toBe(1000);
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(2)).toBe(4000);
    expect(computeBackoffMs(3)).toBe(8000);
    // capped at 30s
    expect(computeBackoffMs(10)).toBe(30000);
  });
});

describe('download-history: resumable Range header', () => {
  test('no header when nothing received yet', () => {
    expect(nextRangeHeader(0)).toBeNull();
  });
  test('open-ended range from received byte offset', () => {
    expect(nextRangeHeader(1024)).toBe('bytes=1024-');
  });
  test('ignores invalid/negative offsets', () => {
    expect(nextRangeHeader(-5)).toBeNull();
    expect(nextRangeHeader(NaN)).toBeNull();
  });
});
