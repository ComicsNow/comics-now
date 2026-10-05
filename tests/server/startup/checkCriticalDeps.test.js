const { checkCriticalDeps, CRITICAL_DEPS } = require('../../../server/startup/check-critical-deps');

// Issue #7: the old server.js boot block ran `npm install --production` and then
// process.exit(0) when a module was missing. Exit code 0 means systemd
// (Restart=on-failure) and Docker never restart — the service just dies — and a
// running service mutating its own node_modules from the network is unauditable.
// New contract: report the missing modules, tell the operator to run `npm ci`,
// and exit NON-ZERO. Never shell out to a package manager.
describe('checkCriticalDeps (Issue #7)', () => {
  test('exits non-zero and names the missing modules, without installing anything', () => {
    const exit = jest.fn();
    const log = jest.fn();
    const resolve = jest.fn((name) => {
      if (name === 'sharp') throw new Error('MODULE_NOT_FOUND');
      return '/fake/' + name;
    });

    const missing = checkCriticalDeps({ deps: ['express', 'sharp'], resolve, log, exit });

    expect(missing).toEqual(['sharp']);
    expect(exit).toHaveBeenCalledWith(1);
    expect(exit).not.toHaveBeenCalledWith(0);
    // Message is actionable and points at npm ci (not an auto-install).
    const logged = log.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toMatch(/sharp/);
    expect(logged).toMatch(/npm ci/);
  });

  test('does nothing and returns [] when every module resolves', () => {
    const exit = jest.fn();
    const log = jest.fn();
    const resolve = jest.fn(() => '/fake/mod');

    const missing = checkCriticalDeps({ deps: ['express', 'sharp'], resolve, log, exit });

    expect(missing).toEqual([]);
    expect(exit).not.toHaveBeenCalled();
  });

  test('does not shell out to a package manager', () => {
    const src = require('fs').readFileSync(
      require.resolve('../../../server/startup/check-critical-deps'), 'utf8'
    );
    // No spawning a package manager: the real signal is child_process / exec,
    // not the word "npm install" which legitimately appears in the user hint.
    expect(src).not.toMatch(/execSync|exec\(|spawn|require\(['"]child_process/);
  });

  test('ships a sensible default critical-dependency list', () => {
    expect(CRITICAL_DEPS).toEqual(expect.arrayContaining([
      'express', 'sharp', 'better-sqlite3', 'onnxruntime-node'
    ]));
  });
});
