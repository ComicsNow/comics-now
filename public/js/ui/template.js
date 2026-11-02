import { escapeHtml as canonicalEscapeHtml } from '../globals.js';

const escapeHtml = typeof canonicalEscapeHtml === 'function'
  ? canonicalEscapeHtml
  : (typeof globalThis !== 'undefined' && typeof globalThis.escapeHtml === 'function'
      ? globalThis.escapeHtml
      : (str) => String(str ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;'));

/**
 * Encapsulates an evaluated tagged template with automated sanitization.
 */
export class TemplateResult {
  constructor(strings, values) {
    this.strings = strings;
    this.values = values;
  }

  toHTML() {
    let result = '';
    for (let i = 0; i < this.strings.length; i++) {
      result += this.strings[i];
      if (i < this.values.length) {
        result += this._formatValue(this.values[i]);
      }
    }
    return result;
  }

  toString() {
    return this.toHTML();
  }

  _formatValue(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof TemplateResult) return value.toHTML();
    if (Array.isArray(value)) return value.map(v => this._formatValue(v)).join('');
    if (value && typeof value === 'object' && value.__isRawHtml) return String(value.html ?? '');
    return escapeHtml(String(value));
  }
}

/**
 * Tagged template literal for declarative HTML.
 * Automatically escapes dynamic variables against stored and reflected XSS.
 *
 * @example
 * const item = html`<div><h3>${comic.name}</h3></div>`;
 */
export function html(strings, ...values) {
  return new TemplateResult(strings, values);
}

/**
 * Bypasses escaping for trusted markup or SVG icons.
 *
 * @param {string} stringOrHtml
 */
export function raw(stringOrHtml) {
  return { __isRawHtml: true, html: stringOrHtml ?? '' };
}

/**
 * Fast, non-parsing container cleaner using replaceChildren when available.
 *
 * @param {HTMLElement} element
 */
export function clearElement(element) {
  if (!element) return;
  if (typeof element.replaceChildren === 'function') {
    element.replaceChildren();
  } else {
    element.innerHTML = '';
  }
}

/**
 * Declaratively renders a TemplateResult or safe string into a container element.
 *
 * @param {HTMLElement} container
 * @param {TemplateResult|string|null|undefined} templateOrString
 */
export function render(container, templateOrString) {
  if (!container) return;
  if (templateOrString === null || templateOrString === undefined || templateOrString === '') {
    clearElement(container);
    return;
  }
  const toHtmlItem = (item) => {
    if (item === null || item === undefined) return '';
    if (Array.isArray(item)) return item.map(toHtmlItem).join('');
    if (item instanceof TemplateResult) return item.toHTML();
    if (typeof item === 'object' && typeof item.toHTML === 'function') return item.toHTML();
    if (typeof item === 'object' && item.__isRawHtml) return String(item.html ?? '');
    return String(item);
  };

  container.innerHTML = toHtmlItem(templateOrString);
}
