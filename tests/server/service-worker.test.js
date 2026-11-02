const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Synthetic deployment paths only: the service worker must work for ANY
// subpath scope, so the capability is exercised across several generic ones.
const DEPLOYED_BASE_PATHS = [
  '/',
  '/reader/',
  '/nested/deploy/path/'
];

const ORIGIN = 'https://app.example';

function createSandbox(basePath) {
  const listeners = {};
  const cacheStores = new Map();
  const getStore = (name) => {
    if (!cacheStores.has(name)) cacheStores.set(name, { puts: [], matches: [] });
    return cacheStores.get(name);
  };
  const sandbox = {
    self: {
      location: { origin: ORIGIN, pathname: basePath },
      registration: { scope: `${ORIGIN}${basePath}` },
      skipWaiting: jest.fn(),
      addEventListener: (ev, fn) => { listeners[ev] = fn; }
    },
    clients: { claim: jest.fn() },
    URL,
    console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
    fetch: jest.fn(async () => ({ ok: true, clone: () => ({}) })),
    caches: {
      open: jest.fn(async (name) => {
        const store = getStore(name);
        return {
          put: jest.fn((key, value) => {
            store.puts.push({ key: String(key), value });
            return Promise.resolve();
          }),
          match: jest.fn(async (key) => {
            store.matches.push(String(key));
            return null;
          }),
          keys: jest.fn(async () => [])
        };
      }),
      keys: jest.fn(async () => []),
      delete: jest.fn(async () => true)
    },
    Response: function Response() {}
  };
  sandbox.__cacheStores = cacheStores;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const swPath = path.resolve(__dirname, '../../public/service-worker.js');
  const swContent = fs.readFileSync(swPath, 'utf8');
  new vm.Script(swContent).runInContext(sandbox);

  return { sandbox, fetchHandler: listeners.fetch };
}

function shellCacheKey(basePath) {
  return `${ORIGIN}${basePath}index.html`;
}

function allPutKeys(sandbox) {
  const keys = [];
  for (const store of sandbox.__cacheStores.values()) {
    for (const put of store.puts) keys.push(put.key);
  }
  return keys;
}

function dispatchFetch(fetchHandler, request) {
  let responsePromise = null;
  const event = {
    request,
    respondWith: jest.fn((promise) => { responsePromise = promise; })
  };
  fetchHandler(event);
  return { event, getResponse: () => responsePromise };
}

function navigationRequest(sandbox, pathname, extraHeaders = {}) {
  return {
    method: 'GET',
    url: `${ORIGIN}${pathname}`,
    mode: 'navigate',
    headers: {
      get: (header) => {
        const headers = { accept: 'text/html', ...extraHeaders };
        return headers[header] || '';
      }
    }
  };
}

describe('service-worker.js plugin handling across deployment paths', () => {
  test.each(DEPLOYED_BASE_PATHS)(
    'never intercepts /plugins/ requests at base path "%s" so private plugins are never PWA-cached',
    (basePath) => {
      const { fetchHandler } = createSandbox(basePath);
      expect(typeof fetchHandler).toBe('function');

      const event = {
        request: {
          method: 'GET',
          url: `${ORIGIN}${basePath}plugins/plugin-bundle.js`,
          mode: 'same-origin',
          headers: { get: () => '' }
        },
        respondWith: jest.fn()
      };

      fetchHandler(event);

      expect(event.respondWith).not.toHaveBeenCalled();
    }
  );

  test.each(DEPLOYED_BASE_PATHS)(
    'still intercepts regular in-scope static assets at base path "%s"',
    (basePath) => {
      const { fetchHandler } = createSandbox(basePath);

      const event = {
        request: {
          method: 'GET',
          url: `${ORIGIN}${basePath}assets/app.js`,
          mode: 'same-origin',
          headers: { get: () => '' }
        },
        respondWith: jest.fn()
      };

      fetchHandler(event);

      expect(event.respondWith).toHaveBeenCalled();
    }
  );

  test.each(DEPLOYED_BASE_PATHS)(
    'ignores requests outside the registered scope at base path "%s"',
    (basePath) => {
      const { fetchHandler } = createSandbox(basePath);

      const event = {
        request: {
          method: 'GET',
          url: `${ORIGIN}/elsewhere/plugins/plugin-bundle.js`,
          mode: 'same-origin',
          headers: { get: () => '' }
        },
        respondWith: jest.fn()
      };

      fetchHandler(event);

      expect(event.respondWith).not.toHaveBeenCalled();
    }
  );

  test.each(DEPLOYED_BASE_PATHS)(
    'never caches a foreign in-scope HTML navigation as the app shell (base "%s")',
    async (basePath) => {
      const { sandbox, fetchHandler } = createSandbox(basePath);
      sandbox.fetch = jest.fn(async () => ({ ok: true, clone: () => ({}) }));

      const request = navigationRequest(sandbox, `${basePath}embedded-ui/`);
      const { event, getResponse } = dispatchFetch(fetchHandler, request);

      expect(event.respondWith).toHaveBeenCalled();
      await getResponse();

      expect(allPutKeys(sandbox)).not.toContain(shellCacheKey(basePath));
    }
  );

  test.each(DEPLOYED_BASE_PATHS)(
    'caches a navigation of the app root as the app shell (base "%s")',
    async (basePath) => {
      const { sandbox, fetchHandler } = createSandbox(basePath);
      sandbox.fetch = jest.fn(async () => ({ ok: true, clone: () => ({}) }));

      const request = navigationRequest(sandbox, basePath);
      const { event, getResponse } = dispatchFetch(fetchHandler, request);

      expect(event.respondWith).toHaveBeenCalled();
      await getResponse();

      expect(allPutKeys(sandbox)).toContain(shellCacheKey(basePath));
    }
  );

  test.each(DEPLOYED_BASE_PATHS)(
    'never intercepts embedded-frame navigations (base "%s")',
    (basePath) => {
      const { sandbox, fetchHandler } = createSandbox(basePath);

      const request = navigationRequest(sandbox, `${basePath}embedded-ui/`, { 'sec-fetch-dest': 'iframe' });
      const { event } = dispatchFetch(fetchHandler, request);

      expect(event.respondWith).not.toHaveBeenCalled();
    }
  );
});
