const fs = require('fs');
const db = require('../server/db');
const { getCtLogs } = require('../server/logger');
const metadataService = require('../server/services/metadata');
const attachComicTaggerRoutes = require('../server/routes/admin/comictagger');
const {
  runComicTagger,
  cancelComicTagger,
  applyUserSelection,
  skipCurrentMatch,
  getPendingMatch
} = require('../server/services/tagger');

describe('WAITING FOR USER SELECTION log line lifecycle', () => {
  const originalFetch = global.fetch;
  let dbGetSpy;
  let dbRunSpy;
  let metaSpy;

  const completeMeta = { Series: 'The Amazing Spider-Man', Publisher: 'Marvel Comics', Number: '1', Year: '1963' };

  function reviewFetchMock() {
    return jest.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'ok', version: '1.0' }) };
      }
      if (typeof url === 'string' && url.includes('/api/tag-file')) {
        return {
          ok: true,
          json: async () => ({
            status: 'review',
            confidence: 72,
            candidates: [
              {
                score: 72,
                source: 'comicvine',
                metadata: { title: 'The Amazing Spider-Man #1', publisher: 'Marvel Comics', number: '1', year: '1963' }
              }
            ]
          })
        };
      }
      if (typeof url === 'string' && url.includes('/api/apply-tag')) {
        return { ok: true, json: async () => ({ status: 'success' }) };
      }
      return { ok: true, json: async () => ({}) };
    });
  }

  async function waitForPending(maxTicks = 500) {
    for (let i = 0; i < maxTicks && !getPendingMatch(); i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    return getPendingMatch();
  }

  function findWaitingEntry() {
    const logs = getCtLogs();
    const idx = logs.findIndex(l => l.message.includes('WAITING FOR USER SELECTION'));
    return { logs, idx, entry: idx >= 0 ? logs[idx] : null };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getCtLogs().length = 0;
    global.fetch = reviewFetchMock();
    dbGetSpy = jest.spyOn(db, 'dbGet').mockResolvedValue(null);
    dbRunSpy = jest.spyOn(db, 'dbRun').mockResolvedValue();
    metaSpy = jest.spyOn(metadataService, 'getComicInfoFromArchive').mockResolvedValue({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockSingleComic(name = 'Spider-Man 01.cbz') {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([{ name, isFile: () => true }]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 10000 });
  }

  test('review emits a waiting entry stamped with a stable ct-wait id', async () => {
    mockSingleComic();
    const runPromise = runComicTagger();

    const pending = await waitForPending();
    expect(pending).toBeTruthy();

    const { idx, entry } = findWaitingEntry();
    expect(idx).toBeGreaterThan(-1);
    expect(entry.id).toMatch(/^ct-wait-/);

    // Resolve so the run can finish cleanly
    await applyUserSelection(['1']);
    await runPromise;
  });

  test('applying a selection replaces the waiting entry in place (no duplicate, no stale WAITING text)', async () => {
    mockSingleComic();
    metaSpy
      .mockResolvedValueOnce({}) // checkFileSuccess before tagging: not already complete
      .mockResolvedValue(completeMeta); // checkFileSuccess + getComicInfoFromArchive after apply

    const runPromise = runComicTagger();
    await waitForPending();

    const { idx, entry } = findWaitingEntry();
    const waitingId = entry.id;
    const logsRef = getCtLogs();

    await applyUserSelection(['1']);
    await runPromise;

    const logs = logsRef;
    // Exactly one entry carries the id - the original entry was updated, not duplicated
    expect(logs.filter(l => l.id === waitingId).length).toBe(1);
    expect(logs[idx].id).toBe(waitingId);
    expect(logs[idx].message).toContain('User selected candidate #1');
    expect(logs.some(l => l.message.includes('WAITING FOR USER SELECTION'))).toBe(false);
  });

  test('skipping replaces the waiting entry in place', async () => {
    mockSingleComic('X-Men 01.cbz');
    const runPromise = runComicTagger();
    await waitForPending();

    const { idx, entry } = findWaitingEntry();
    const waitingId = entry.id;

    await skipCurrentMatch();
    await runPromise;

    const logs = getCtLogs();
    expect(logs.filter(l => l.id === waitingId).length).toBe(1);
    expect(logs[idx].id).toBe(waitingId);
    expect(logs[idx].message).toContain('Skipped');
    expect(logs[idx].message).toContain('unmatched');
    expect(logs.some(l => l.message.includes('WAITING FOR USER SELECTION'))).toBe(false);
  });

  test('cancelling during review updates the waiting entry to a retained-match notice, and a later apply reuses the same id', async () => {
    mockSingleComic();
    metaSpy
      .mockResolvedValueOnce({}) // gate 2 before tagging
      .mockResolvedValue(completeMeta); // apply path after cancellation

    const runPromise = runComicTagger();
    await waitForPending();

    const { idx, entry } = findWaitingEntry();
    const waitingId = entry.id;

    expect(cancelComicTagger()).toBe(true);
    await runPromise;

    const logs = getCtLogs();
    expect(logs.filter(l => l.id === waitingId).length).toBe(1);
    expect(logs[idx].id).toBe(waitingId);
    expect(logs[idx].message).toContain('Scan cancelled');
    expect(logs[idx].message).toContain('retained');
    expect(logs.some(l => l.message.includes('WAITING FOR USER SELECTION'))).toBe(false);

    // Pending state retained so the user can still resolve it after cancellation
    expect(getPendingMatch()).toBeTruthy();
    expect(getPendingMatch().waitingLogId).toBe(waitingId);

    await applyUserSelection(['1']);

    const finalLogs = getCtLogs();
    expect(finalLogs.filter(l => l.id === waitingId).length).toBe(1);
    expect(finalLogs[idx].id).toBe(waitingId);
    expect(finalLogs[idx].message).toContain('User selected candidate #1');
    expect(getPendingMatch()).toBeNull();
  });

  test('pending-details response does not leak waitingLogId to the client', async () => {
    let detailsHandler;
    const router = {
      get: jest.fn((path, ...args) => {
        if (path === '/api/v1/comictagger/pending-details') detailsHandler = args[args.length - 1];
      }),
      post: jest.fn()
    };

    attachComicTaggerRoutes(router, {
      log: jest.fn(),
      getPendingMatch: jest.fn(() => ({
        fileName: 'Spider-Man #1.cbz',
        filePath: '/comics/Spider-Man #1.cbz',
        waitingForResponse: true,
        waitingLogId: 'ct-wait-9',
        previewBuffer: Buffer.from([1, 2, 3]),
        previewMime: 'image/jpeg',
        matches: [{ choice: '1', title: 'Spider-Man #1', score: 85, publisher: 'Marvel' }]
      })),
      formatErrorMessage: jest.fn((err, req, msg) => msg || err.message)
    });

    const res = { json: jest.fn(), set: jest.fn() };
    await detailsHandler({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.waitingLogId).toBeUndefined();
    expect(payload.previewBuffer).toBeUndefined();
    expect(payload.fileName).toBe('Spider-Man #1.cbz');
  });
});
