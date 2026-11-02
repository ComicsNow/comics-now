import { raw, render } from './template.js';

export const ICONS = {
  READ: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`,
  UNREAD: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`,
  DOWNLOAD: `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>`,
  SPINNER: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>`,
  CHECK: `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`,
  CLOSE: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  RETRY: `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`
};

/**
 * Returns raw SVG string for an icon by key with optional custom class replacement.
 *
 * @param {keyof typeof ICONS} name
 * @param {Object} [options]
 * @param {string} [options.className]
 * @returns {string}
 */
export function getIconSvg(name, options = {}) {
  const baseSvg = ICONS[name] || '';
  if (!baseSvg || !options.className) return baseSvg;
  return baseSvg.replace(/class="[^"]*"/, `class="${options.className}"`);
}

/**
 * Returns a trusted raw() wrapper around an icon for use in html`` templates.
 *
 * @param {keyof typeof ICONS} name
 * @param {Object} [options]
 * @returns {Object}
 */
export function rawIcon(name, options = {}) {
  return raw(getIconSvg(name, options));
}

/**
 * Renders an SVG icon directly into an element.
 *
 * @param {HTMLElement} element
 * @param {keyof typeof ICONS} name
 * @param {Object} [options]
 */
export function renderIcon(element, name, options = {}) {
  if (!element) return;
  render(element, rawIcon(name, options));
}
