const EventEmitter = require('events');

const {
  MAX_CLIENTS_PER_USER,
  registerSyncClient,
  unregisterSyncClient,
  notifySyncUpdate,
  closeAllSyncClients,
  getSyncClientCount
} = require('../../server/services/sync-stream');
const attachUserSyncStreamRoutes = require('../../server/routes/user/sync-stream');
const attachUserProgressRoutes = require('../../server/routes/user/progress');

function createMockRes() {
  const res = new EventEmitter();
  res.headers = {};
  res.statusCode = 200;
  res.destroyed = false;
  res.writableEnded = false;
  res.chunks = [];
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  res.flushHeaders = jest.fn();
  res.setTimeout = jest.fn();
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    res.writableEnded = true;
    return res;
  });
  res.write = jest.fn((chunk) => {
    if (res.destroyed || res.writableEnded) return false;
    res.chunks.push(chunk);
    return true;
  });
  res.end = jest.fn(() => {
    res.writableEnded = true;
  });
  return res;
}

describe('Server Cross-Device Sync SSE Stream', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    closeAllSyncClients();
  });

  afterEach(() => {
    closeAllSyncClients();
    jest.useRealTimers();
  });

  test('registerSyncClient sends retry + ok, evicts oldest past MAX_CLIENTS_PER_USER, and notifies other devices', () => {
    const clients = [];
    for (let i = 0; i < MAX_CLIENTS_PER_USER + 1; i++) {
      const res = createMockRes();
      registerSyncClient('user-1', `dev-${i}`, res);
      clients.push(res);
    }

    expect(clients[0].end).toHaveBeenCalled();
    expect(getSyncClientCount('user-1')).toBe(MAX_CLIENTS_PER_USER);

    const senderRes = clients[1];
    const peerRes = clients[2];
    expect(peerRes.chunks.join('')).toContain('retry: 5000\n\n:ok\n\n');

    notifySyncUpdate('user-1', 'dev-1', { comicId: 'c1', lastReadPage: 12 });
    expect(senderRes.chunks.join('')).not.toContain('event: sync-update');
    expect(peerRes.chunks.join('')).toContain('event: sync-update\ndata: {"comicId":"c1","lastReadPage":12}\n\n');

    unregisterSyncClient('user-1', peerRes);
    expect(getSyncClientCount('user-1')).toBe(MAX_CLIENTS_PER_USER - 1);
  });

  test('GET /api/v1/sync/stream validates deviceId, enforces ownership, and avoids leaked clients on early disconnect', async () => {
    let streamHandler;
    const mockRouter = {
      get: jest.fn((route, handler) => {
        if (route === '/api/v1/sync/stream') streamHandler = handler;
      })
    };

    let resolveDb;
    const dbGet = jest.fn(() => new Promise((resolve) => { resolveDb = resolve; }));

    attachUserSyncStreamRoutes(mockRouter, {
      dbGet,
      validateDeviceId: (id) => id && id.startsWith('dev-')
        ? { valid: true, sanitized: id }
        : { valid: false, error: 'Invalid device ID' },
      formatErrorMessage: (_e, _r, msg) => msg,
      log: jest.fn()
    });

    // 1. Invalid deviceId -> 400
    const badRes = createMockRes();
    await streamHandler({ query: { deviceId: 'bad' }, user: { userId: 'u1' }, on: jest.fn() }, badRes);
    expect(badRes.statusCode).toBe(400);

    // 2. Early disconnect during async dbGet -> never registers client
    const reqEarly = new EventEmitter();
    reqEarly.query = { deviceId: 'dev-early' };
    reqEarly.user = { userId: 'u1' };
    reqEarly.socket = { setTimeout: jest.fn() };
    const earlyRes = createMockRes();

    const pending = streamHandler(reqEarly, earlyRes);
    reqEarly.emit('close');
    resolveDb({ userId: 'u1' });
    await pending;
    expect(getSyncClientCount('u1')).toBe(0);

    // 3. Foreign device -> 403
    const reqForeign = new EventEmitter();
    reqForeign.query = { deviceId: 'dev-other' };
    reqForeign.user = { userId: 'u1' };
    const foreignRes = createMockRes();
    dbGet.mockResolvedValueOnce({ userId: 'u2' });
    await streamHandler(reqForeign, foreignRes);
    expect(foreignRes.statusCode).toBe(403);

    // 4. Unregistered device -> 404 (no DB writes on GET)
    const reqMissing = new EventEmitter();
    reqMissing.query = { deviceId: 'dev-missing' };
    reqMissing.user = { userId: 'u1' };
    const missingRes = createMockRes();
    dbGet.mockResolvedValueOnce(null);
    await streamHandler(reqMissing, missingRes);
    expect(missingRes.statusCode).toBe(404);

    // 5. Valid connection -> sets SSE headers and registers
    const reqOk = new EventEmitter();
    reqOk.query = { deviceId: 'dev-ok' };
    reqOk.user = { userId: 'u1' };
    reqOk.socket = { setTimeout: jest.fn() };
    const okRes = createMockRes();
    dbGet.mockResolvedValueOnce({ userId: 'u1' });
    await streamHandler(reqOk, okRes);
    expect(okRes.headers['Content-Type']).toBe('text/event-stream');
    expect(okRes.headers['Cache-Control']).toBe('no-cache, no-transform');
    expect(okRes.headers['X-Accel-Buffering']).toBe('no');
    expect(getSyncClientCount('u1')).toBe(1);

    reqOk.emit('close');
    expect(getSyncClientCount('u1')).toBe(0);
  });

  test('POST /api/v1/sync/update resolves deviceName and notifies only when lastReadPage is provided', async () => {
    let postUpdateHandler;
    const mockRouter = {
      get: jest.fn(),
      post: jest.fn((route, handler) => {
        if (route === '/api/v1/sync/update') postUpdateHandler = handler;
      })
    };

    const peerRes = createMockRes();
    registerSyncClient('u1', 'dev-peer', peerRes);

    const dbGet = jest.fn(async (sql) => {
      if (sql.includes('FROM devices')) return { userId: 'u1', deviceName: 'iPad Pro' };
      if (sql.includes('FROM comics')) return { totalPages: 30 };
      return null;
    });
    const dbRun = jest.fn(async () => ({}));

    attachUserProgressRoutes(mockRouter, {
      dbGet,
      dbAll: jest.fn(),
      dbRun,
      log: jest.fn(),
      formatErrorMessage: (_e, _r, msg) => msg,
      validateComicId: (id) => ({ valid: true, sanitized: id }),
      validateDeviceId: (id) => ({ valid: true, sanitized: id }),
      validateLastReadPage: (p) => ({ valid: true, sanitized: p }),
      validateStatus: () => ({ valid: true })
    });

    // Heartbeat (no lastReadPage) -> should NOT broadcast sync-update
    const hbRes = createMockRes();
    await postUpdateHandler({ body: { comicId: 'c1', deviceId: 'dev-sender' }, user: { userId: 'u1' } }, hbRes);
    expect(hbRes.body.ok).toBe(true);
    expect(peerRes.chunks.join('')).not.toContain('event: sync-update');

    // Page update -> SHOULD broadcast sync-update with resolved deviceName
    const updRes = createMockRes();
    await postUpdateHandler({ body: { comicId: 'c1', deviceId: 'dev-sender', lastReadPage: 7 }, user: { userId: 'u1' } }, updRes);
    expect(updRes.body.ok).toBe(true);
    const out = peerRes.chunks.join('');
    expect(out).toContain('event: sync-update');
    expect(out).toContain('"lastSyncDeviceName":"iPad Pro"');
    expect(out).toContain('"lastReadPage":7');
  });
});
