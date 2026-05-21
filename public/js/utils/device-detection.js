/**
 * Device Detection Utility
 * Detects whether the user is on a desktop or mobile device
 */

'use strict';

import { state } from '../globals.js';

// Desktop threshold: screens 1024px and wider are considered desktop
const DESKTOP_WIDTH_THRESHOLD = 1024;

// Cache the current device type
let cachedIsDesktop = null;

/**
 * Check if current device is a desktop
 * @returns {boolean} - True if desktop, false if mobile/tablet
 */
export function isDesktopDevice() {
  // Check cached value first
  if (cachedIsDesktop !== null) {
    return cachedIsDesktop;
  }

  // Determine if desktop based on screen width
  const screenWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
  const isWideScreen = screenWidth >= DESKTOP_WIDTH_THRESHOLD;

  // Check for touch capability (coarse pointer)
  // Devices with touch as primary input (tablets/phones) are not considered desktop
  const isTouchDevice = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // Desktop is a wide screen that is NOT primarily a touch device
  cachedIsDesktop = isWideScreen && !isTouchDevice;

  return cachedIsDesktop;
}

/**
 * Check if current device is mobile/tablet
 * @returns {boolean} - True if mobile/tablet, false if desktop
 */
export function isMobileDevice() {
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
recalculateDeviceType();

state.isDesktopDevice = isDesktopDevice;
state.isMobileDevice = isMobileDevice;

if (typeof window !== 'undefined') {
  window.isDesktopDevice = isDesktopDevice;
  window.isMobileDevice = isMobileDevice;
}
