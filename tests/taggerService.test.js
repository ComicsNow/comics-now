const { isWorkerOnline } = require('../server/services/tagger-process');
const { searchExternal, getScanLogsList, getScanLogDetail, clearEnhancedTracking } = require('../server/services/tagger');

describe('Tagger Service & Process Tests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('isWorkerOnline returns true when health check responds ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: '1.0' })
    });

    const online = await isWorkerOnline('http://127.0.0.1:5000');
    expect(online).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5000/api/health', expect.any(Object));
  });

  test('isWorkerOnline returns false when health check fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const online = await isWorkerOnline('http://127.0.0.1:5000');
    expect(online).toBe(false);
  });

  test('searchExternal queries /api/search with parameters', async () => {
    const mockResults = [
      { title: 'Batman #1', publisher: 'DC Comics', year: 2016 }
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResults
    });

    const results = await searchExternal('comicvine', 'Batman 1');
    expect(results).toEqual(mockResults);
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5000/api/search', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }));
  });

  test('getScanLogsList retrieves logs from /api/logs', async () => {
    const mockLogs = [
      { id: 'scan_1', total_files: 5, tagged_count: 5 }
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockLogs
    });

    const logs = await getScanLogsList();
    expect(logs).toEqual(mockLogs);
  });

  test('clearEnhancedTracking sends POST to /api/enhanced-comics/clear', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, count: 10 })
    });

    const res = await clearEnhancedTracking();
    expect(res).toEqual({ success: true, count: 10 });
  });
});
