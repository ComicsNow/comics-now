/**
 * Device Detection Utility
 * Detects whether the user is on a desktop or mobile device
 */

(function(global) {
  'use strict';

  // Desktop threshold: screens 1024px and wider are considered desktop
  const DESKTOP_WIDTH_THRESHOLD = 1024;

  // Cache the current device type
  let cachedIsDesktop = null;

  /**
   * Check if current device is a desktop
   * @returns {boolean} - True if desktop, false if mobile/tablet
   */
  function isDesktopDevice() {
    // Check cached value first
    if (cachedIsDesktop !== null) {
      return cachedIsDesktop;
    }

    // Determine if desktop based on screen width
    const screenWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    cachedIsDesktop = screenWidth >= DESKTOP_WIDTH_THRESHOLD;

    return cachedIsDesktop;
  }

  /**
   * Check if current device is mobile/tablet
   * @returns {boolean} - True if mobile/tablet, false if desktop
   */
  function isMobileDevice() {
    return !isDesktopDevice();
  }

  /**
   * Recalculate device type (called on window resize)
   */
  function recalculateDeviceType() {
    const wasDesktop = cachedIsDesktop;
    cachedIsDesktop = null; // Clear cache
    const isDesktop = isDesktopDevice();

    // If device type changed, dispatch event
    if (wasDesktop !== null && wasDesktop !== isDesktop) {
      const event = new CustomEvent('deviceTypeChanged', {
        detail: { isDesktop, isMobile: !isDesktop }
      });
      window.dispatchEvent(event);
      console.log('[DEVICE] Device type changed:', isDesktop ? 'Desktop' : 'Mobile');
    }
  }

  // Listen for window resize events (debounced)
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      recalculateDeviceType();
    }, 250);
  });

  // Initial detection
  const initialType = isDesktopDevice() ? 'Desktop' : 'Mobile';
  console.log('[DEVICE] Initial detection:', initialType);

  // Expose functions globally
  global.isDesktopDevice = isDesktopDevice;
  global.isMobileDevice = isMobileDevice;

})(typeof window !== 'undefined' ? window : globalThis);
