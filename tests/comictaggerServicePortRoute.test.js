/**
 * @jest-environment node
 */

const attachComicTaggerRoutes = require('../server/routes/admin/comictagger');

describe('Tag Comics Now! tagger service port route behaviour', () => {
  let router;
  let deps;
  let getScheduleHandler;
  let postScheduleHandler;

  const CURRENT_URL = 'http://127.0.0.1:5000';

  beforeEach(() => {
    jest.clearAllMocks();

    getScheduleHandler = null;
    postScheduleHandler = null;

    router = {
      get: jest.fn((path, ...args) => {
        if (path === '/api/v1/tag-comics-now/schedule') getScheduleHandler = args[args.length - 1];
      }),
      post: jest.fn((path, ...args) => {
        if (path === '/api/v1/tag-comics-now/schedule') postScheduleHandler = args[args.length - 1];
      })
    };

    deps = {
      log: jest.fn(),
      getCtScheduleMinutes: jest.fn(() => 60),
      setCtScheduleMinutes: jest.fn(),
      getComicsLocation: jest.fn(() => '/comics'),
      setComicsLocation: jest.fn(),
      getTaggerServiceUrl: jest.fn(() => CURRENT_URL),
      setTaggerServiceUrl: jest.fn(),
      setGoogleBooksApiKey: jest.fn(),
      saveSetting: jest.fn().mockResolvedValue(undefined),
      stopTaggerWorker: jest.fn(),
      startTaggerWorker: jest.fn().mockResolvedValue(undefined),
      isWorkerOnline: jest.fn().mockResolvedValue(true),
      formatErrorMessage: jest.fn((err, req, fallback) => fallback || (err && err.message)),
      scheduleCtRun: jest.fn()
    };

    attachComicTaggerRoutes(router, deps);
  });

  function makeRes() {
    const res = {
      json: jest.fn(),
      status: jest.fn(function () { return res; })
    };
    return res;
  }

  describe('GET /api/v1/tag-comics-now/schedule', () => {
    test('reports serviceOnline true when the tagger health check answers ok', async () => {
      const res = makeRes();

      await getScheduleHandler({}, res);

      expect(deps.isWorkerOnline).toHaveBeenCalledWith(CURRENT_URL);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        taggerServiceUrl: CURRENT_URL,
        serviceOnline: true
      }));
    });

    test('reports serviceOnline false when the health check rejects', async () => {
      deps.isWorkerOnline.mockRejectedValue(new Error('connect ECONNREFUSED'));
      const res = makeRes();

      await getScheduleHandler({}, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ serviceOnline: false }));
    });
  });

  describe('POST /api/v1/tag-comics-now/schedule taggerServicePort', () => {
    test('a new port is persisted and the embedded worker is restarted', async () => {
      const req = { body: { minutes: 60, taggerServicePort: 5100 } };
      const res = makeRes();

      await postScheduleHandler(req, res);

      expect(deps.setTaggerServiceUrl).toHaveBeenCalledWith('http://127.0.0.1:5100', true);
      expect(deps.saveSetting).toHaveBeenCalledWith('taggerServiceUrl', 'http://127.0.0.1:5100');
      expect(deps.stopTaggerWorker).toHaveBeenCalledTimes(1);
      expect(deps.startTaggerWorker).toHaveBeenCalledTimes(1);
      const stopOrder = deps.stopTaggerWorker.mock.invocationCallOrder[0];
      const startOrder = deps.startTaggerWorker.mock.invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(startOrder);
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        changed: true,
        taggerServiceUrl: 'http://127.0.0.1:5100',
        workerRestarted: true
      });
    });

    test('an unchanged port does not touch the service but still saves other settings', async () => {
      const req = { body: { minutes: 15, taggerServicePort: 5000 } };
      const res = makeRes();

      await postScheduleHandler(req, res);

      expect(deps.setTaggerServiceUrl).not.toHaveBeenCalled();
      expect(deps.saveSetting).not.toHaveBeenCalledWith('taggerServiceUrl', expect.anything());
      expect(deps.stopTaggerWorker).not.toHaveBeenCalled();
      expect(deps.startTaggerWorker).not.toHaveBeenCalled();
      expect(deps.setCtScheduleMinutes).toHaveBeenCalledWith(15);
      expect(deps.saveSetting).toHaveBeenCalledWith('ctScheduleMinutes', 15);
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        changed: false,
        taggerServiceUrl: CURRENT_URL
      });
    });

    test.each([0, -1, 65536, 5100.5, 'abc'])('rejects the invalid port %p with 400 and saves nothing', async (badPort) => {
      const req = { body: { minutes: 15, taggerServicePort: badPort } };
      const res = makeRes();

      await postScheduleHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
      expect(deps.setTaggerServiceUrl).not.toHaveBeenCalled();
      expect(deps.stopTaggerWorker).not.toHaveBeenCalled();
      expect(deps.startTaggerWorker).not.toHaveBeenCalled();
      expect(deps.saveSetting).not.toHaveBeenCalled();
      expect(deps.setCtScheduleMinutes).not.toHaveBeenCalled();
    });

    test('a failed worker restart still persists the port and reports a warning', async () => {
      deps.startTaggerWorker.mockRejectedValue(new Error('spawn ENOENT'));
      const req = { body: { taggerServicePort: 5100 } };
      const res = makeRes();

      await postScheduleHandler(req, res);

      expect(deps.setTaggerServiceUrl).toHaveBeenCalledWith('http://127.0.0.1:5100', true);
      expect(deps.saveSetting).toHaveBeenCalledWith('taggerServiceUrl', 'http://127.0.0.1:5100');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        changed: true,
        taggerServiceUrl: 'http://127.0.0.1:5100',
        workerRestarted: false,
        warning: expect.any(String)
      }));
    });

    test('a request carrying a Google Books key still saves through without a ReferenceError', async () => {
      const req = { body: { minutes: 60, googleBooksApiKey: 'gb-key', taggerServicePort: 5000 } };
      const res = makeRes();

      await postScheduleHandler(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(deps.setGoogleBooksApiKey).toHaveBeenCalledWith('gb-key');
      expect(deps.saveSetting).toHaveBeenCalledWith('googleBooksApiKey', 'gb-key');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    test('a request without a port leaves the tagger service untouched', async () => {
      const req = { body: { minutes: 30 } };
      const res = makeRes();

      await postScheduleHandler(req, res);

      expect(deps.setTaggerServiceUrl).not.toHaveBeenCalled();
      expect(deps.stopTaggerWorker).not.toHaveBeenCalled();
      expect(deps.startTaggerWorker).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        changed: false,
        taggerServiceUrl: CURRENT_URL
      }));
    });
  });
});
