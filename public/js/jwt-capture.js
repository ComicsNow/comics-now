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

// jwt-capture.js
// Captures Cloudflare Access JWT token for Service Worker authentication

/**
 * Extract Cloudflare Access token from cookies
 * @returns {string|null} JWT token or null
 */
function extractCFToken() {
  try {
    const cookies = document.cookie.split('; ');

    // Check for CF_Authorization cookie
    const cfCookie = cookies.find(c => c.startsWith('CF_Authorization='));
    if (cfCookie) {
      const token = cfCookie.split('=')[1];
      if (token && token.length > 0) {
        return decodeURIComponent(token);
      }
    }

    return null;
  } catch (error) {
    console.error('[JWT CAPTURE] Error extracting token:', error);
    return null;
  }
}

/**
 * Capture and save Cloudflare JWT token to IndexedDB
 * @returns {Promise<boolean>} True if token was saved, false otherwise
 */
async function captureCFToken() {
  try {
    const token = extractCFToken();

    if (!token) {
      return false;
    }

    // Save token to IndexedDB
    if (typeof global.saveJWTToken === 'function') {
      await global.saveJWTToken(token);
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('[JWT CAPTURE] Error capturing token:', error);
    return false;
  }
}

/**
 * Initialize JWT token capture with periodic refresh
 * @param {number} intervalMs - Refresh interval in milliseconds (default: 30 minutes)
 */
async function initializeJWTCapture(intervalMs = 30 * 60 * 1000) {

  // Capture token immediately
  await captureCFToken();

  // Set up periodic refresh
  const intervalId = setInterval(async () => {
    await captureCFToken();
  }, intervalMs);

  // Store interval ID so it can be cleared if needed
  global._jwtCaptureIntervalId = intervalId;

}

/**
 * Stop JWT token capture
 */
function stopJWTCapture() {
  if (global._jwtCaptureIntervalId) {
    clearInterval(global._jwtCaptureIntervalId);
    global._jwtCaptureIntervalId = null;
  }
}

export {
  extractCFToken,
  captureCFToken,
  initializeJWTCapture,
  stopJWTCapture
};

state.extractCFToken = extractCFToken;
state.captureCFToken = captureCFToken;
state.initializeJWTCapture = initializeJWTCapture;
state.stopJWTCapture = stopJWTCapture;

if (typeof window !== 'undefined') {
  window.extractCFToken = extractCFToken;
  window.captureCFToken = captureCFToken;
  window.initializeJWTCapture = initializeJWTCapture;
  window.stopJWTCapture = stopJWTCapture;
}

