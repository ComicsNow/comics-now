/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('AppRouter async route callback navigation guard', () => {
  test('keeps _isNavigatingFromRouter true until async route callback settles to prevent pushState loops', async () => {
    const state = {};
    const pushStateSpy = jest.fn();
    const sandbox = {
      window: null,
      state,
      URL,
      URLSearchParams,
      location: { pathname: '/', search: '' },
      history: {
        scrollRestoration: 'auto',
        pushState: pushStateSpy
      },
      document: {
        querySelector: () => null,
        documentElement: { scrollTop: 0 },
        body: { scrollTop: 0 }
      },
      addEventListener: jest.fn(),
      scrollTo: jest.fn(),
      console
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const routerCode = fs.readFileSync(path.resolve(__dirname, '../../../public/js/router.js'), 'utf8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    vm.runInContext(routerCode, sandbox);

    let observedFlagDuringAsync = null;
    const handler = jest.fn(async (params) => {
      await Promise.resolve();
      observedFlagDuringAsync = sandbox.window._isNavigatingFromRouter;
      if (handler.mock.calls.length < 5 && !sandbox.window._isNavigatingFromRouter) {
        sandbox.router.navigate(`/comic/${params.id}`);
      }
    });

    sandbox.router.addRoute('/comic/:id', handler);
    sandbox.router.navigate('/comic/off-42');

    // Allow microtasks to drain (bounded so an infinite loop won't hang the test)
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    expect(observedFlagDuringAsync).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(sandbox.window._isNavigatingFromRouter).toBe(false);
  });
});
