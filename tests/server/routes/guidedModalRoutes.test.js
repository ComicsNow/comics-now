const attachGuidedRoutes = require('../../../server/routes/admin/guided');

describe('Admin Guided View Routes - Modal Settings and Credit Endpoints', () => {
  let router;
  let routes;
  let deps;
  let mockSettings;

  beforeEach(() => {
    routes = {};
    router = {
      get: jest.fn((path, handler) => { routes[`GET ${path}`] = handler; }),
      post: jest.fn((path, handler) => { routes[`POST ${path}`] = handler; })
    };

    mockSettings = {
      autoOnAdd: false,
      scheduleEnabled: false,
      scheduleInterval: 24,
      scheduleUnit: 'hours',
      useModal: false,
      modalTokenId: '',
      hasModalSecret: false,
      modalEnvironment: ''
    };

    deps = {
      guidedReader: {
        SETTINGS_KEYS: {
          autoOnAdd: 'guided.autoOnAdd',
          scheduleEnabled: 'guided.scheduleEnabled',
          scheduleInterval: 'guided.scheduleInterval',
          scheduleUnit: 'guided.scheduleUnit',
          useModal: 'guided.useModal',
          modalTokenId: 'guided.modalTokenId',
          modalTokenSecret: 'guided.modalTokenSecret',
          modalEnvironment: 'guided.modalEnvironment',
          concurrency: 'guided.concurrency'
        },
        getStatus: jest.fn().mockResolvedValue({ isRunning: false }),
        getSettings: jest.fn().mockImplementation(async () => mockSettings),
        applySettingsChanged: jest.fn().mockResolvedValue(),
        startRun: jest.fn(),
        startRunForScope: jest.fn(),
        cancelCurrent: jest.fn(),
        cancelAll: jest.fn()
      },
      modalDetector: {
        checkCredits: jest.fn().mockResolvedValue({
          ok: true,
          workspace: 'comicsnowdev',
          totalCredits: 30.0,
          meteredCost: 31.15,
          billedCost: 0.5,
          availableCredits: 0.0,
          spendLimitExceeded: true
        })
      },
      formatErrorMessage: jest.fn((e) => e.message),
      saveSetting: jest.fn().mockImplementation(async (key, val) => {
        if (key === 'guided.useModal') mockSettings.useModal = val;
        if (key === 'guided.modalTokenId') mockSettings.modalTokenId = val;
        if (key === 'guided.modalTokenSecret') mockSettings.hasModalSecret = !!val;
        if (key === 'guided.modalEnvironment') mockSettings.modalEnvironment = val;
      }),
      getGuidedLogs: jest.fn(() => []),
      clearGuidedLogs: jest.fn(),
      registerGuidedClient: jest.fn(),
      unregisterGuidedClient: jest.fn()
    };

    attachGuidedRoutes(router, deps);
  });

  test('GET /api/v1/guided/settings returns modal settings', async () => {
    const req = {};
    const res = { json: jest.fn() };

    await routes['GET /api/v1/guided/settings'](req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      useModal: false,
      modalTokenId: '',
      hasModalSecret: false
    }));
  });

  test('POST /api/v1/guided/settings saves useModal and credentials', async () => {
    const req = {
      body: {
        autoOnAdd: true,
        scheduleEnabled: false,
        scheduleInterval: 12,
        scheduleUnit: 'hours',
        useModal: true,
        modalTokenId: 'ak-test-token',
        modalTokenSecret: 'as-test-secret',
        modalEnvironment: 'production',
        concurrency: 2
      }
    };
    const res = { json: jest.fn() };

    await routes['POST /api/v1/guided/settings'](req, res);

    expect(deps.saveSetting).toHaveBeenCalledWith('guided.useModal', true);
    expect(deps.saveSetting).toHaveBeenCalledWith('guided.modalTokenId', 'ak-test-token');
    expect(deps.saveSetting).toHaveBeenCalledWith('guided.modalTokenSecret', expect.stringMatching(/^enc:v1:/));
    expect(deps.saveSetting).toHaveBeenCalledWith('guided.modalEnvironment', 'production');
    expect(deps.saveSetting).toHaveBeenCalledWith('guided.concurrency', 2);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      settings: expect.objectContaining({
        useModal: true,
        modalTokenId: 'ak-test-token',
        hasModalSecret: true
      })
    }));
  });

  test('GET /api/v1/guided/modal-credits queries modal credit breakdown', async () => {
    const req = {};
    const res = { json: jest.fn() };

    await routes['GET /api/v1/guided/modal-credits'](req, res);

    expect(deps.modalDetector.checkCredits).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      availableCredits: 0.0,
      totalCredits: 30.0,
      spendLimitExceeded: true
    }));
  });

  test('POST /api/v1/guided/modal-test validates credentials passed in body', async () => {
    const req = {
      body: {
        modalTokenId: 'ak-custom',
        modalTokenSecret: 'as-custom'
      }
    };
    const res = { json: jest.fn() };

    await routes['POST /api/v1/guided/modal-test'](req, res);

    expect(deps.modalDetector.checkCredits).toHaveBeenCalledWith({
      modalTokenId: 'ak-custom',
      modalTokenSecret: 'as-custom',
      modalEnvironment: ''
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true
    }));
  });

  test('GET /api/v1/guided/modal-status returns full environment readiness', async () => {
    deps.modalDetector.checkEnvironment = jest.fn().mockResolvedValue({
      ok: true,
      workspace: 'test-workspace',
      modelsUploaded: true,
      appDeployed: true,
      ready: true
    });

    const req = {};
    const res = { json: jest.fn() };

    await routes['GET /api/v1/guided/modal-status'](req, res);

    expect(deps.modalDetector.checkEnvironment).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      ready: true,
      modelsUploaded: true,
      appDeployed: true
    }));
  });

  test('POST /api/v1/guided/modal-setup triggers environment bootstrapping', async () => {
    deps.modalDetector.setupEnvironment = jest.fn().mockResolvedValue({
      ok: true,
      ready: true,
      message: 'Modal environment successfully initialized'
    });

    const req = { body: {} };
    const res = { json: jest.fn() };

    await routes['POST /api/v1/guided/modal-setup'](req, res);

    expect(deps.modalDetector.setupEnvironment).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      ready: true
    }));
  });
});
