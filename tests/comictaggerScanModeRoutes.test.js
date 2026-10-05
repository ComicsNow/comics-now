/**
 * @jest-environment node
 */

const attachComicTaggerRoutes = require('../server/routes/admin/comictagger');

describe('Tag Comics Now! scan mode routes', () => {
  let router;
  let deps;
  let runHandler;
  let scopeCountsHandler;

  const VALID_MODES = ['default', 'unmatched', 'existing-xml', 'force'];

  beforeEach(() => {
    jest.clearAllMocks();

    router = {
      get: jest.fn((path, ...args) => {
        if (path === '/api/v1/tag-comics-now/scope-counts') scopeCountsHandler = args[args.length - 1];
      }),
      post: jest.fn((path, ...args) => {
        if (path === '/api/v1/tag-comics-now/run') runHandler = args[args.length - 1];
      })
    };

    deps = {
      log: jest.fn(),
      runComicTagger: jest.fn(),
      formatErrorMessage: jest.fn((err, req, msg) => msg || err.message),
      resolveScanMode: jest.fn((opts = {}) => {
        if (opts.mode && VALID_MODES.includes(opts.mode)) return opts.mode;
        if (opts.force !== undefined) return opts.force ? 'force' : 'default';
        return 'default';
      }),
      getScanScopeCounts: jest.fn().mockResolvedValue({ unmatched: 7 })
    };

    attachComicTaggerRoutes(router, deps);
  });

  describe('POST /api/v1/tag-comics-now/run', () => {
    function makeRes() {
      const res = {
        json: jest.fn(),
        status: jest.fn(() => res)
      };
      return res;
    }

    test('passes the unmatched mode through to the tagger and echoes the resolved mode', async () => {
      const req = { body: { mode: 'unmatched' } };
      const res = makeRes();

      await runHandler(req, res);

      expect(deps.runComicTagger).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'unmatched' })
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, mode: 'unmatched' });
    });

    test('supports the existing-xml mode', async () => {
      const req = { body: { mode: 'existing-xml' } };
      const res = makeRes();

      await runHandler(req, res);

      expect(deps.runComicTagger).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'existing-xml' })
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, mode: 'existing-xml' });
    });

    test('rejects an unknown scan mode with 400 without starting a run', async () => {
      const req = { body: { mode: 'bogus' } };
      const res = makeRes();

      await runHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid scan mode' });
      expect(deps.runComicTagger).not.toHaveBeenCalled();
      expect(deps.resolveScanMode).not.toHaveBeenCalled();
    });

    test('preserves the legacy force flag', async () => {
      const req = { body: { force: true } };
      const res = makeRes();

      await runHandler(req, res);

      expect(deps.runComicTagger).toHaveBeenCalledWith(
        expect.objectContaining({ force: true })
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, mode: 'force' });
    });

    test('a bare run without options resolves through the default precedence', async () => {
      const req = { body: {} };
      const res = makeRes();

      await runHandler(req, res);

      expect(deps.runComicTagger).toHaveBeenCalled();
      expect(deps.resolveScanMode).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true, mode: 'default' });
    });
  });

  describe('GET /api/v1/tag-comics-now/scope-counts', () => {
    test('returns the unmatched count from the injected counter', async () => {
      const req = {};
      const res = { json: jest.fn() };

      await scopeCountsHandler(req, res);

      expect(deps.getScanScopeCounts).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true, unmatched: 7 });
    });

    test('falls back to zero when the counter is not wired', async () => {
      router = {
        get: jest.fn((path, ...args) => {
          if (path === '/api/v1/tag-comics-now/scope-counts') scopeCountsHandler = args[args.length - 1];
        }),
        post: jest.fn()
      };
      const minimalDeps = {
        log: jest.fn(),
        runComicTagger: jest.fn(),
        formatErrorMessage: deps.formatErrorMessage
      };
      attachComicTaggerRoutes(router, minimalDeps);

      const req = {};
      const res = { json: jest.fn() };
      await scopeCountsHandler(req, res);

      expect(res.json).toHaveBeenCalledWith({ ok: true, unmatched: 0 });
    });

    test('reports a 500 with a zeroed count when the counter throws', async () => {
      deps.getScanScopeCounts.mockRejectedValue(new Error('db locked'));
      const req = {};
      const res = { json: jest.fn() };
      res.status = jest.fn(() => res);

      await scopeCountsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, unmatched: 0 })
      );
    });
  });
});
