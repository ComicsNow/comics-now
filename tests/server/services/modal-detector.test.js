const { spawn } = require('child_process');
const fs = require('fs');
const EventEmitter = require('events');
const modalDetector = require('../../../server/services/modal-detector');
const logger = require('../../../server/logger');
const panelDetector = require('../../../server/services/panel-detector');

jest.mock('child_process');
jest.mock('fs');
jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));
jest.mock('../../../server/services/panel-detector', () => ({
  GUIDED_VIEW_DIR: '/mock/guided-view-dir'
}));

describe('modal-detector', () => {
  let mockProcess;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stdout.on = mockProcess.stdout.addListener.bind(mockProcess.stdout);
    mockProcess.stderr = new EventEmitter();
    mockProcess.stderr.on = mockProcess.stderr.addListener.bind(mockProcess.stderr);
    mockProcess.kill = jest.fn();

    spawn.mockReturnValue(mockProcess);
    fs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getPythonBin', () => {
    it('returns MODAL_PYTHON_PATH if it exists', () => {
      process.env.MODAL_PYTHON_PATH = '/custom/modal/python';
      fs.existsSync.mockImplementation((path) => path === '/custom/modal/python');
      expect(modalDetector.getPythonBin()).toBe('/custom/modal/python');
    });

    it('returns .venv candidate if exists', () => {
      fs.existsSync.mockImplementation((path) => path.includes('.venv/bin/python3'));
      expect(modalDetector.getPythonBin()).toMatch(/\.venv\/bin\/python3$/);
    });

    it('returns tagger/venv candidate if exists', () => {
      fs.existsSync.mockImplementation((path) => path.includes('tagger/venv/bin/python3'));
      expect(modalDetector.getPythonBin()).toMatch(/tagger\/venv\/bin\/python3$/);
    });

    it('returns MODAL_VENV_PATH bin if exists', () => {
      process.env.MODAL_VENV_PATH = '/custom/venv';
      fs.existsSync.mockImplementation((path) => path === '/custom/venv/bin/python3');
      expect(modalDetector.getPythonBin()).toBe('/custom/venv/bin/python3');
    });

    it('defaults to python3', () => {
      expect(modalDetector.getPythonBin()).toBe('python3');
    });
  });

  describe('runScriptJson operations (checkCredits, checkEnvironment, setupEnvironment)', () => {
    it('checkCredits returns parsed JSON', async () => {
      const promise = modalDetector.checkCredits();
      mockProcess.stdout.emit('data', JSON.stringify({ ok: true, credits: 100 }));
      mockProcess.emit('close', 0);
      const res = await promise;
      expect(res).toEqual({ ok: true, credits: 100 });
    });

    it('checkEnvironment returns parsed JSON', async () => {
      const promise = modalDetector.checkEnvironment();
      mockProcess.stdout.emit('data', JSON.stringify({ ok: true, ready: true }));
      mockProcess.emit('close', 0);
      const res = await promise;
      expect(res).toEqual({ ok: true, ready: true });
    });

    it('setupEnvironment returns parsed JSON', async () => {
      const promise = modalDetector.setupEnvironment({ modalTokenId: 'token123' });
      mockProcess.stdout.emit('data', JSON.stringify({ ok: true }));
      mockProcess.emit('close', 0);
      const res = await promise;
      expect(res).toEqual({ ok: true });
    });

    it('returns error on non-zero exit code with no JSON', async () => {
      const promise = modalDetector.checkCredits();
      mockProcess.stderr.emit('data', 'some error text');
      mockProcess.emit('close', 1);
      const res = await promise;
      expect(res).toEqual({ ok: false, error: 'some error text' });
    });

    it('returns error on child_process error', async () => {
      const promise = modalDetector.checkCredits();
      mockProcess.emit('error', new Error('spawn EACCES'));
      const res = await promise;
      expect(res).toEqual({ ok: false, error: 'Failed to spawn Modal process: spawn EACCES' });
    });
  });

  describe('ensureEnvironmentReady', () => {
    it('initializes when env is not ready', async () => {
      // Mock checkEnvironment to return ready: false
      const ensurePromise = modalDetector.ensureEnvironmentReady({ modalTokenId: 'my-token' }, logger.log);

      // Give the event loop a tick to let spawn be called for checkEnvironment
      await Promise.resolve();

      // This is for checkEnvironment
      mockProcess.stdout.emit('data', JSON.stringify({ ok: true, ready: false }));
      mockProcess.emit('close', 0);

      // Now ensureEnvironmentReady calls setupEnvironment, which calls spawn again.
      // We need to wait for the next spawn call. We can do this by hooking into the mock, or just waiting.
      await Promise.resolve();
      await Promise.resolve();

      // Get the second spawned process if needed, or if spawn returns the same mock object, just emit again.
      // Since our mock spawn returns the same mockProcess, we emit on it again.
      mockProcess.stdout.emit('data', JSON.stringify({ ok: true }));
      mockProcess.emit('close', 0);

      const res = await ensurePromise;
      expect(res).toEqual({ ok: true });
      expect(logger.log).toHaveBeenCalledWith('INFO', expect.stringContaining('First-time setup detected'));
      expect(logger.log).toHaveBeenCalledWith('INFO', expect.stringContaining('Workspace initialized and deployed successfully'));
    });

    it('returns immediately if already cached', async () => {
      // It should be cached from the previous test for 'my-token'
      const ensurePromise = modalDetector.ensureEnvironmentReady({ modalTokenId: 'my-token' }, logger.log);
      const res = await ensurePromise;
      expect(res).toEqual({ ok: true, ready: true });
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('processComic', () => {
    it('successfully processes a comic', async () => {
      const promise = modalDetector.processComic('comic-123', '/path/to/comic.cbz', 'western');

      mockProcess.stdout.emit('data', JSON.stringify({
        ok: true,
        panels: [],
        pagesProcessed: 10,
        pageCount: 10,
        outputPath: '/mock/out'
      }));
      mockProcess.emit('close', 0);

      const res = await promise;
      expect(res).toEqual({
        panels: [],
        pagesProcessed: 10,
        pageCount: 10,
        outputPath: '/mock/out'
      });

      // Verify spawn arguments
      expect(spawn).toHaveBeenCalled();
      const spawnArgs = spawn.mock.calls[0][1];
      expect(spawnArgs).toContain('--comic-id');
      expect(spawnArgs).toContain('comic-123');
      expect(spawnArgs).toContain('/path/to/comic.cbz');
    });

    it('handles JSON with ok: false', async () => {
      const promise = modalDetector.processComic('comic-123', '/path/to/comic.cbz', 'western');

      mockProcess.stdout.emit('data', JSON.stringify({
        ok: false,
        error: 'Custom modal error'
      }));
      mockProcess.emit('close', 0);

      await expect(promise).rejects.toThrow('Custom modal error');
    });

    it('handles non-zero exit code', async () => {
      const promise = modalDetector.processComic('comic-123', '/path/to/comic.cbz', 'western');

      mockProcess.stderr.emit('data', 'Stderr output');
      mockProcess.emit('close', 1);

      await expect(promise).rejects.toThrow('Stderr output');
    });

    it('handles process error event', async () => {
      const promise = modalDetector.processComic('comic-123', '/path/to/comic.cbz', 'western');

      mockProcess.emit('error', new Error('spawn error'));

      await expect(promise).rejects.toThrow('Failed to spawn Modal process: spawn error');
    });

    it('handles cancellation before completion', async () => {
      let isCancelled = false;
      const promise = modalDetector.processComic('comic-123', '/path/to/comic.cbz', 'western', {
        isCancelled: () => isCancelled
      });

      // Wait a moment, then set to true so the interval picks it up
      await new Promise(r => setTimeout(r, 100));
      isCancelled = true;

      await expect(promise).rejects.toThrow('Cancelled');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('throws error immediately if already cancelled', async () => {
      const promise = modalDetector.processComic('comic-123', '/path/to/comic.cbz', 'western', {
        isCancelled: () => true
      });
      await expect(promise).rejects.toThrow('Cancelled');
    });
  });
});
