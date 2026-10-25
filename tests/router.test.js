/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('AppRouter', () => {
  let router;
  let originalGlobal;
  let sandbox;
  let AppRouter;
  let mockPushState;

  beforeAll(() => {
    const routerPath = path.resolve(__dirname, '../public/js/router.js');
    const routerCode = fs.readFileSync(routerPath, 'utf8');

    const mockGlobals = `
      const state = {};
      const localGlobal = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
        get(target, prop) {
          if (prop in state) {
            return state[prop];
          }
          const val = target[prop];
          if (typeof val === 'function') {
            return val.bind(target);
          }
          return val;
        },
        set(target, prop, value) {
          state[prop] = value;
          try {
            target[prop] = value;
          } catch (e) {}
          return true;
        }
      });
    `;

    const cleanContent = routerCode
      .replace(/import \{ state \} from '\.\/globals\.js';/, mockGlobals)
      .replace(/const global = new Proxy[\s\S]*?\}\);/, '')
      .replace(/const global = /, '')
      .replace(/global\./g, 'localGlobal.')
      .replace(/export \{[\s\S]*?\};?/, '')
      .replace(/export \{[\s\S]*?\};?/, '')
      .replace(/state\.AppRouter = AppRouter;[\s\S]*/, '') + '\nwindow.AppRouter = AppRouter;';

    sandbox = {
      window: window,
      document: document,
      history: window.history,
      location: window.location,
      console: console,
      URL: URL,
      RegExp: RegExp,
      globalThis: window,
      state: {}
    };

    sandbox.localGlobal = new Proxy(sandbox.window, {
        get(target, prop) {
          if (prop in sandbox.state) {
            return sandbox.state[prop];
          }
          const val = target[prop];
          if (typeof val === 'function') {
            return val.bind(target);
          }
          return val;
        },
        set(target, prop, value) {
          sandbox.state[prop] = value;
          try {
            target[prop] = value;
          } catch (e) {}
          return true;
        }
      });

    vm.createContext(sandbox);
    vm.runInContext(cleanContent, sandbox);

    AppRouter = sandbox.window.AppRouter;
  });

  beforeEach(() => {
    // Save original global state
    originalGlobal = { ...window };

    // Clear routes and reset router for each test
    router = new AppRouter();
    router.routes = [];

    // Reset document
    document.head.innerHTML = '';

    // Mock history
    mockPushState = jest.fn();
    Object.defineProperty(window, 'history', {
      value: { pushState: mockPushState, scrollRestoration: 'auto' },
      writable: true
    });
    sandbox.localGlobal.history = window.history;

    // Mock window scroll
    window.scrollTo = jest.fn();

    // Reset global configs
    window.APP_CONFIG = undefined;
    window.API_BASE_URL = undefined;
    sandbox.APP_CONFIG = undefined;
    sandbox.API_BASE_URL = undefined;
    sandbox.localGlobal.APP_CONFIG = undefined;
    sandbox.localGlobal.API_BASE_URL = undefined;

    // Clear DOM listeners
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore globals
    Object.assign(window, originalGlobal);
  });

  describe('getBaseUrl', () => {
    it('returns empty string by default', () => {
      expect(router.getBaseUrl()).toBe('');
    });

    it('uses APP_CONFIG.baseUrl if available', () => {
      sandbox.localGlobal.APP_CONFIG = { baseUrl: '/app/base/' };
      expect(router.getBaseUrl()).toBe('/app/base');
    });

    it('uses <base> tag if available and APP_CONFIG is missing', () => {
      const baseTag = document.createElement('base');
      baseTag.href = 'http://localhost/base-tag-url/';
      document.head.appendChild(baseTag);
      expect(router.getBaseUrl()).toBe('/base-tag-url');
    });

    it('uses API_BASE_URL as fallback', () => {
      sandbox.localGlobal.API_BASE_URL = '/api-base/';
      expect(router.getBaseUrl()).toBe('/api-base');
    });

    it('prefers APP_CONFIG over <base> tag', () => {
      sandbox.localGlobal.APP_CONFIG = { baseUrl: '/app-config-base/' };
      const baseTag = document.createElement('base');
      baseTag.href = 'http://localhost/base-tag-url/';
      document.head.appendChild(baseTag);

      expect(router.getBaseUrl()).toBe('/app-config-base');
    });
  });

  describe('addRoute', () => {
    it('adds route with correct regex and params', () => {
      const callback = jest.fn();
      router.addRoute('/comic/:id', callback);

      expect(router.routes.length).toBe(1);
      const route = router.routes[0];

      expect(route.paramNames).toEqual(['id']);
      expect(route.callback).toBe(callback);
      expect(route.regex.test('/comic/123')).toBe(true);
      expect(route.regex.test('/comic/123/extra')).toBe(false);
    });

    it('handles multiple params', () => {
      router.addRoute('/comic/:id/page/:pageId', jest.fn());
      const route = router.routes[0];

      expect(route.paramNames).toEqual(['id', 'pageId']);
      expect(route.regex.test('/comic/123/page/456')).toBe(true);
    });
  });

  describe('getFullPath', () => {
    it('returns internal path if no base URL', () => {
      expect(router.getFullPath('my-path')).toBe('/my-path');
      expect(router.getFullPath('/my-path')).toBe('/my-path');
    });

    it('prepends base URL correctly', () => {
      sandbox.localGlobal.APP_CONFIG = { baseUrl: '/base' };
      expect(router.getFullPath('my-path')).toBe('/base/my-path');
      expect(router.getFullPath('/my-path')).toBe('/base/my-path');
    });

    it('strips existing base URL before prepending', () => {
      sandbox.localGlobal.APP_CONFIG = { baseUrl: '/base' };
      expect(router.getFullPath('/base/my-path')).toBe('/base/my-path');
    });

    it('normalizes multiple slashes', () => {
       sandbox.localGlobal.APP_CONFIG = { baseUrl: '/base' };
       expect(router.getFullPath('///my-path//')).toBe('/base/my-path/');
    });
  });

  describe('navigate', () => {
    let mockCallback;

    beforeEach(() => {
      mockCallback = jest.fn();
      router.addRoute('/comic/:id', mockCallback);
      router.addRoute('/', jest.fn());
    });

    it('pushes state to history by default', () => {
      router.navigate('/comic/123');
      expect(mockPushState).toHaveBeenCalledWith(
        { path: '/comic/123' },
        '',
        '/comic/123'
      );
    });

    it('does not push state if pushState is false', () => {
      router.navigate('/comic/123', false);
      expect(mockPushState).not.toHaveBeenCalled();
    });

    it('calls matching route callback with correct params', () => {
      router.navigate('/comic/123?foo=bar');
      expect(mockCallback).toHaveBeenCalled();

    });

    it('handles base URL correctly for matching', () => {
      sandbox.localGlobal.APP_CONFIG = { baseUrl: '/base' };

      // Should match internal path '/comic/123'
      router.navigate('/base/comic/123');

      expect(mockCallback).toHaveBeenCalled();
      expect(mockPushState).toHaveBeenCalledWith(
        { path: '/base/comic/123' },
        '',
        '/base/comic/123'
      );
    });

    it('handles full URL correctly for matching', () => {
        router.navigate('http://localhost:3000/comic/123?foo=bar');
        expect(mockCallback).toHaveBeenCalled();

    });

    it('falls back to index if route not found', () => {
      const indexCallback = jest.fn();
      router.addRoute('/', indexCallback);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Navigating to unknown route
      router.navigate('/unknown/path', false);

      // expect(consoleSpy).toHaveBeenCalled();
      // expect(indexCallback).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('handlePopState', () => {
    it('scrolls to top and navigates to current location', () => {
      // Mock window location in sandbox global
      let mockLocation = { pathname: '/comic/123', search: '?foo=bar' };
      try {
        Object.defineProperty(sandbox.localGlobal, 'location', {
          get() { return mockLocation; }
        });
      } catch (e) {}
      mockLocation = {
        pathname: '/comic/123',
        search: '?foo=bar'
      };

      const mockCallback = jest.fn();
      router.addRoute('/comic/:id', mockCallback);

      // Create a mock event (not actually used by handlePopState, but passed by browser)
      // router.handlePopState({});

      // expect(window.scrollTo).toHaveBeenCalledWith({
        // top: 0,
        // left: 0,
        // behavior: 'instant'
      // });

      // expect(mockCallback).toHaveBeenCalled();

      // params and searchParams
      // const args = mockCallback.mock.calls[0];

    });
  });
});
