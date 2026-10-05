jest.mock('child_process', () => ({ spawn: jest.fn() }));

const { spawn } = require('child_process');
const { setTaggerServiceUrl } = require('../server/config');
const { startTaggerWorker, stopTaggerWorker } = require('../server/services/tagger-process');

describe('tagger-process spawn environment', () => {
  const originalFetch = global.fetch;
  let savedPortEnv;

  function fakeChild() {
    return {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
      kill: jest.fn()
    };
  }

  beforeEach(() => {
    spawn.mockReset();
    spawn.mockImplementation(() => fakeChild());

    // The parent's own PORT must not be inherited as the tagger's listen port.
    savedPortEnv = process.env.PORT;
    delete process.env.PORT;

    // Health check answers "offline" before the spawn, "online" afterwards so
    // the readiness loop exits on its first iteration.
    let healthCalls = 0;
    global.fetch = jest.fn(async () => {
      healthCalls += 1;
      if (healthCalls === 1) {
        return { ok: false, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ status: 'ok' }) };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    stopTaggerWorker();
    if (savedPortEnv !== undefined) process.env.PORT = savedPortEnv;
    setTaggerServiceUrl('http://127.0.0.1:5000', true);
  });

  test('spawns with APP_PORT/APP_HOST derived from the configured service URL', async () => {
    setTaggerServiceUrl('http://127.0.0.1:5100', true);

    await startTaggerWorker();

    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = spawn.mock.calls[0];
    expect(bin).toBe(process.env.PYTHON_PATH || 'python3');
    expect(args[0]).toEqual(expect.stringContaining('tagger'));
    expect(args[0]).toEqual(expect.stringContaining('app.py'));
    expect(opts.env.APP_PORT).toBe('5100');
    expect(opts.env.APP_HOST).toBe('127.0.0.1');
    expect(opts.env.PORT).toBeUndefined();
    expect(opts.env.DATA_DIR).toEqual(expect.any(String));
    expect(opts.env.FLASK_DEBUG).toBe('0');
  });

  test('defaults APP_PORT to 5000 for the default service URL', async () => {
    await startTaggerWorker();

    expect(spawn).toHaveBeenCalledTimes(1);
    const opts = spawn.mock.calls[0][2];
    expect(opts.env.APP_PORT).toBe('5000');
    expect(opts.env.APP_HOST).toBe('127.0.0.1');
  });

  test('does not spawn a local worker for a remote service URL', async () => {
    setTaggerServiceUrl('http://tagger.example.test:9000', true);

    await startTaggerWorker();

    expect(spawn).not.toHaveBeenCalled();
  });
});
