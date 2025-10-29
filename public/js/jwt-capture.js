// jwt-capture.js
// Captures Cloudflare Access JWT token for Service Worker authentication

(function (global) {
  'use strict';

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
          console.log('[JWT CAPTURE] Found CF_Authorization cookie');
          return decodeURIComponent(token);
        }
      }

      console.log('[JWT CAPTURE] No CF_Authorization cookie found');
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
        console.log('[JWT CAPTURE] No token to save');
        return false;
      }

      // Save token to IndexedDB
      if (typeof global.saveJWTToken === 'function') {
        await global.saveJWTToken(token);
        console.log('[JWT CAPTURE] Token saved successfully');
        return true;
      } else {
        console.warn('[JWT CAPTURE] saveJWTToken function not available');
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
    console.log('[JWT CAPTURE] Initializing JWT capture');

    // Capture token immediately
    await captureCFToken();

    // Set up periodic refresh
    const intervalId = setInterval(async () => {
      console.log('[JWT CAPTURE] Refreshing token');
      await captureCFToken();
    }, intervalMs);

    // Store interval ID so it can be cleared if needed
    global._jwtCaptureIntervalId = intervalId;

    console.log('[JWT CAPTURE] JWT capture initialized with', intervalMs / 1000 / 60, 'minute refresh');
  }

  /**
   * Stop JWT token capture
   */
  function stopJWTCapture() {
    if (global._jwtCaptureIntervalId) {
      clearInterval(global._jwtCaptureIntervalId);
      global._jwtCaptureIntervalId = null;
      console.log('[JWT CAPTURE] JWT capture stopped');
    }
  }

  // Export functions
  global.extractCFToken = extractCFToken;
  global.captureCFToken = captureCFToken;
  global.initializeJWTCapture = initializeJWTCapture;
  global.stopJWTCapture = stopJWTCapture;

})(typeof window !== 'undefined' ? window : globalThis);
