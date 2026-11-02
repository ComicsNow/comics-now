import { state, clearElement, escapeHtml } from '../globals.js';
import { html, raw, render } from '../ui/template.js';

export const clear = typeof clearElement === 'function'
  ? clearElement
  : (el) => {
      if (el) {
        if (typeof el.replaceChildren === 'function') el.replaceChildren();
        else el.innerHTML = '';
      }
    };

export const renderContent = (typeof render === 'function' && render.length >= 2)
  ? render
  : (el, content) => {
      if (!el) return;
      const toStr = (c) => {
        if (c === null || c === undefined) return '';
        if (Array.isArray(c)) return c.map(toStr).join('');
        if (typeof c === 'object' && typeof c.toHTML === 'function') return c.toHTML();
        if (typeof c === 'object' && c.__isRawHtml) return c.html;
        return String(c);
      };
      el.innerHTML = toStr(content);
    };

export const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0)
  ? html
  : (strings, ...values) => {
      const formatVal = (v) => {
        if (v === null || v === undefined) return '';
        if (Array.isArray(v)) return v.map(formatVal).join('');
        if (typeof v === 'object' && v.__isRawHtml) return v.html;
        if (typeof v === 'object' && typeof v.toHTML === 'function') return v.toHTML();
        return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v);
      };
      let out = '';
      for (let i = 0; i < strings.length; i++) {
        out += strings[i];
        if (i < values.length) {
          out += formatVal(values[i]);
        }
      }
      return { toHTML: () => out, html: out, __isRawHtml: true };
    };

export const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0)
  ? raw
  : (v) => ({ __isRawHtml: true, html: String(v ?? '') });

export const continuousState = {
  isContinuousMode: false,
  continuousContainer: null,
  pageElements: new Map(),
  intersectionObserver: null,
  loadedPages: new Set(),
  scrollTimeout: null,
  continuousClickHandler: null,
  isInitializingScroll: false,
  isSwitchingContinuousMode: false,
  originalNavigationState: {
    prevBtnText: '←',
    nextBtnText: '→',
    prevBtnHandler: null,
    nextBtnHandler: null,
    navLeftHandler: null,
    navRightHandler: null
  }
};

/**
 * Helper to check whether E-Ink/Kindle screen mode is currently active
 */
export function isEinkActive() {
  const einkMode = state.einkMode || (typeof window !== 'undefined' ? window.einkMode : 'none');
  const bodyHasEink = typeof document !== 'undefined' && document.body && (
    document.body.classList.contains('eink-mode') || document.body.classList.contains('eink-color-mode')
  );
  return !!(bodyHasEink || (einkMode && einkMode !== 'none'));
}
