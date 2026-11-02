/**
 * Comics Now! - Core DOM & String Utilities
 *
 * HTML escaping, path sanitization, skeleton loaders, and e-ink flash control.
 */

import { CSS_CLASSES, ICONS } from './constants.js';
import { render, raw } from '../ui/template.js';

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeDirName(str) {
  return String(str).trim().replace(/[\\/]+/g, '_').replace(/\s+/g, ' ');
}

export function getRelativePath() {
  const baseUrl = (typeof window !== 'undefined' && window.APP_CONFIG?.baseUrl ? window.APP_CONFIG.baseUrl : '').replace(/\/$/, '');
  let path = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (baseUrl && path.startsWith(baseUrl)) {
    path = path.substring(baseUrl.length);
  }
  return path || '/';
}

export function encodePath(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }
  const encode = typeof btoa === 'function' ? btoa : (s => Buffer.from(s, 'binary').toString('base64'));
  return encode(binary);
}

export function toTrimmedString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function createLoadingMessage(message = 'Loading...', count = 8) {
  const card = `
    <div class="skeleton-card">
      <div class="skeleton-img"></div>
      <div class="p-2 space-y-1.5 mt-1">
        <div class="skeleton-line w-3/4"></div>
        <div class="skeleton-line w-1/2 mt-1"></div>
      </div>
    </div>`;
  return card.repeat(count);
}

export function createEmptyMessage(message) {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
      <p class="empty-state-message">${escapeHtml(message)}</p>
    </div>`;
}

export function createErrorMessage(message) {
  return `<div class="${CSS_CLASSES.ERROR}">${escapeHtml(message)}</div>`;
}

export function createCheckmarkIcon() {
  const check = document.createElement('div');
  check.className = CSS_CLASSES.DOWNLOAD_BTN;
  render(check, raw(ICONS.READ));
  return check;
}

export function triggerEinkFlash(einkMode) {
  const mode = einkMode || (typeof window !== 'undefined' && window.state ? window.state.einkMode : 'none');
  if (!mode || mode === 'none') return;

  let flash = document.getElementById('eink-flash-overlay');
  if (!flash && typeof document !== 'undefined') {
    flash = document.createElement('div');
    flash.id = 'eink-flash-overlay';
    document.body.appendChild(flash);
  }
  if (!flash) return;

  flash.style.transition = 'none';
  flash.style.opacity = '1';
  flash.style.backgroundColor = 'black';

  setTimeout(() => {
    flash.style.backgroundColor = 'white';
    setTimeout(() => {
      flash.style.opacity = '0';
    }, 80);
  }, 80);
}
