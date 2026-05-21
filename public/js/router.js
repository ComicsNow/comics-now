import { state } from './globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
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

// public/js/router.js
class AppRouter {
  constructor() {
    this.routes = [];
    global.addEventListener('popstate', this.handlePopState.bind(this));
  }

  getBaseUrl() {
    // 1. Try injected config
    if (global.APP_CONFIG && global.APP_CONFIG.baseUrl) {
      return global.APP_CONFIG.baseUrl.replace(/\/$/, '');
    }
    // 2. Try <base> tag
    const baseTag = document.querySelector('base');
    if (baseTag && baseTag.href) {
      try {
        const url = new URL(baseTag.href);
        return url.pathname.replace(/\/$/, '');
      } catch (e) {
        // Fallback
      }
    }
    // 3. Fallback to API_BASE_URL if it's set
    if (global.API_BASE_URL) {
      return global.API_BASE_URL.replace(/\/$/, '');
    }
    return '';
  }

  // Adds a route like '/comic/:id' or '/settings/downloads'
  addRoute(pattern, callback) {
    const paramNames = [];
    let regexString = pattern.replace(/:([^/]+)/g, (match, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    });
    regexString = `^${regexString}$`;
    this.routes.push({ regex: new RegExp(regexString), paramNames, callback });
  }

  getFullPath(path) {
    const baseUrl = this.getBaseUrl();
    let internalPath = path;
    if (baseUrl && internalPath.startsWith(baseUrl)) {
      internalPath = internalPath.substring(baseUrl.length);
    }
    if (!internalPath.startsWith('/')) internalPath = '/' + internalPath;
    return (baseUrl + internalPath).replace(/\/+/g, '/');
  }

  navigate(path, pushState = true) {
    const baseUrl = this.getBaseUrl();
    
    // Normalize path for matching: strip baseUrl if present, ensure leading slash
    let internalPath = path;
    if (path.startsWith('http')) {
      try {
        internalPath = new URL(path).pathname + new URL(path).search;
      } catch (e) {}
    }

    if (baseUrl && internalPath.startsWith(baseUrl)) {
      internalPath = internalPath.substring(baseUrl.length);
    }
    if (!internalPath.startsWith('/')) internalPath = '/' + internalPath;

    // Full URL for browser history: prepend baseUrl
    const fullPath = (baseUrl + internalPath).replace(/\/+/g, '/');

    if (pushState) {
      global.history.pushState({ path: fullPath }, '', fullPath);
    }
    
    // Use URL with dummy origin to parse internalPath (which includes query params)
    const url = new URL(internalPath, 'http://localhost');
    const pathname = url.pathname;
    
    for (const route of this.routes) {
      const match = pathname.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        
        global._isNavigatingFromRouter = true;
        route.callback(params, url.searchParams);
        global._isNavigatingFromRouter = false;
        return;
      }
    }
    
    // Default fallback to index
    if (this.routes.length > 0 && internalPath !== '/') {
       console.log('[ROUTER] Fallback to index from:', internalPath);
       this.navigate('/', false);
    }
  }

  handlePopState(event) {
    this.navigate(global.location.pathname + global.location.search, false);
  }
}

const router = new AppRouter();

export {
  AppRouter,
  router
};

state.AppRouter = AppRouter;
state.router = router;

if (typeof window !== 'undefined') {
  window.AppRouter = AppRouter;
  window.router = router;
}

