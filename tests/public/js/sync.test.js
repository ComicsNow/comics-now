/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Sync Module - Device & Progress Synchronization', () => {
  let sandbox;

  function loadClientScript(relPath, customSandbox = sandbox) {
    const fullPath = path.resolve(__dirname, '../../..', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+class\s+([A-Za-z0-9_]+)/g, 'var $1 = class $1')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    vm.runInContext(cleanContent, customSandbox);
  }

  beforeEach(() => {
    localStorage.clear();
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      textBaseline: '',
      font: '',
      fillText: jest.fn()
    }));
    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,mock');
    sandbox = {
      window,
      document,
      console,
      localStorage,
      navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' },
      screen: { width: 1920, height: 1080, colorDepth: 24 },
      btoa: str => Buffer.from(str, 'binary').toString('base64'),
      debugLog: jest.fn(),
      state: {
        API_BASE_URL: 'http://localhost:3000',
        getComicStatus: comic => (comic.progress?.lastReadPage >= (comic.totalPages - 1) ? 'read' : comic.progress?.lastReadPage > 0 ? 'in-progress' : 'unread'),
        library: {
          _isLazyLoaded: true,
          main: {
            publishers: {
              DC: {
                _counts: { read: 0, 'in-progress': 0, unread: 1 },
                series: {
                  Batman: [
                    { id: 'comic-1', totalPages: 20, progress: { lastReadPage: 0 } }
                  ]
                }
              }
            }
          }
        }
      },
      fetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }))
    };
    sandbox.state.library.main.publishers.DC.series.Batman._counts = { read: 0, 'in-progress': 0, unread: 1 };
    vm.createContext(sandbox);

    loadClientScript('public/js/sync/device.js');
    loadClientScript('public/js/sync/library-counts.js');
    loadClientScript('public/js/sync/modals.js');
    loadClientScript('public/js/sync/stream.js');
    loadClientScript('public/js/sync/manager.js');
    loadClientScript('public/js/sync.js');
  });

  test('generateFingerprint creates a valid device hash', () => {
    const fp = sandbox.generateFingerprint();
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
  });

  test('getDeviceInfo correctly detects platform', () => {
    const info = sandbox.getDeviceInfo();
    expect(info.os).toBe('Windows');
    expect(info.type).toBe('desktop');
  });

  test('ignored sync points management records and clears points', () => {
    sandbox.markSyncPointAsIgnored('comic-99', 123456, 10, 'dev-1');
    expect(sandbox.isSyncPointIgnored('comic-99', 123456, 10, 'dev-1')).toBe(true);
    expect(sandbox.isSyncPointIgnored('comic-99', 999999, 15, 'dev-2')).toBe(false);

    sandbox.clearIgnoredSyncPoint('comic-99');
    expect(sandbox.isSyncPointIgnored('comic-99', 123456, 10, 'dev-1')).toBe(false);
  });

  test('updateLocalProgressAndCounts modifies comic page and decrements unread count', () => {
    sandbox.updateLocalProgressAndCounts('comic-1', 5);
    const comic = sandbox.state.library.main.publishers.DC.series.Batman[0];
    expect(comic.progress.lastReadPage).toBe(5);

    const counts = sandbox.state.library.main.publishers.DC.series.Batman._counts;
    expect(counts['in-progress']).toBe(1);
    expect(counts.unread).toBe(0);
  });

  test('SyncManager registers device and initializes instance', () => {
    const sm = new sandbox.SyncManager();
    expect(sm).toBeDefined();
    expect(sm.lastKnownPage).toBe(0);
  });

  test('updateProgress returns { ok: true } on success and { ok: false } on failure', async () => {
    const sm = new sandbox.SyncManager();
    expect(await sm.updateProgress('comic-1', 3)).toEqual({ ok: false, reason: 'no-device' });

    sm.deviceId = 'dev-1';
    sm.deviceName = 'Laptop';
    sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, lastSyncTimestamp: 5000 })
    });
    const okRes = await sm.updateProgress('comic-1', 4);
    expect(okRes.ok).toBe(true);
    expect(sm.lastKnownTimestamp).toBe(5000);

    sandbox.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ ok: false })
    });
    const errRes = await sm.updateProgress('comic-1', 5);
    expect(errRes.ok).toBe(false);
  });

  test('SyncStream opens SSE on startPolling, switches comics cleanly, and adapts sync-update payload', () => {
    const instances = [];
    sandbox.EventSource = class MockEventSource {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        this.closed = false;
        instances.push(this);
      }
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      }
      close() {
        this.closed = true;
      }
    };

    const sm = new sandbox.SyncManager();
    sm.deviceId = 'dev-local';
    sm.lastKnownPage = 2;
    sm.lastKnownTimestamp = 1000;
    const notifySpy = jest.spyOn(sm, 'showSyncNotification').mockImplementation(() => {});

    sm.startPolling({ id: 'comic-A' });
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toContain('/api/v1/sync/stream?deviceId=dev-local');

    // Switching comic-to-comic without stopPolling() updates currentComicId
    sm.startPolling({ id: 'comic-B' });
    expect(sm.currentComicId).toBe('comic-B');

    // Emit sync-update from another device for comic-B with newer server timestamp
    const evt = {
      data: JSON.stringify({
        comicId: 'comic-B',
        lastReadPage: 9,
        totalPages: 24,
        lastSyncTimestamp: 2000,
        lastSyncDeviceId: 'dev-remote',
        lastSyncDeviceName: 'iPad'
      })
    };
    instances[instances.length - 1].listeners['sync-update'](evt);
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      comicId: 'comic-B',
      serverProgress: expect.objectContaining({ lastReadPage: 9, lastSyncDeviceName: 'iPad' }),
      clientProgress: { lastReadPage: 2 }
    }));

    sm.stopPolling();
    expect(instances[instances.length - 1].closed).toBe(true);
  });

  test('initializeDevice preserves admin deviceId when impersonating', async () => {
    localStorage.setItem('comicsNow_deviceId', 'admin-dev-1');
    localStorage.setItem('comicsNow_deviceName', 'Admin Desktop');
    const sm = new sandbox.SyncManager();
    sm.isImpersonating = true;
    await sm.initializeDevice();
    expect(sm.deviceId).toBeNull();
    expect(localStorage.getItem('comicsNow_deviceId')).toBe('admin-dev-1');
  });
});
