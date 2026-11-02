/**
 * Comics Now! - DAG State & DOM Helpers
 *
 * Centralized state store and DOM safety helpers for Reading List DAG visualizer.
 */

import { state, escapeHtml, getComicById, clearElement, render, html, raw } from '../globals.js';

export const clear = typeof clearElement === 'function' ? clearElement : (el) => {
  if (el) {
    if (typeof el.replaceChildren === 'function') el.replaceChildren();
    else el.innerHTML = '';
  }
};

export const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
    el.innerHTML = content.toHTML();
  } else if (content && typeof content === 'object' && content.__isRawHtml) {
    el.innerHTML = content.html;
  } else {
    el.innerHTML = String(content ?? '');
  }
};

export const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__isRawHtml) out += v.html;
      else if (v && typeof v === 'object' && typeof v.toHTML === 'function') out += v.toHTML();
      else out += (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''));
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

export const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({
  __isRawHtml: true,
  html: String(v ?? '')
});

export function getBaseUrl() {
  if (typeof state !== 'undefined' && state.API_BASE_URL) return state.API_BASE_URL.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.API_BASE_URL) return window.API_BASE_URL.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.baseUrl) {
    return window.APP_CONFIG.baseUrl.replace(/\/$/, '');
  }
  if (typeof document !== 'undefined') {
    const baseTag = document.querySelector('base');
    if (baseTag && baseTag.href) {
      try {
        const url = new URL(baseTag.href, window.location.origin);
        return url.pathname.replace(/\/$/, '');
      } catch (e) {}
    }
  }
  return '';
}

export const dagState = {
  currentDAGData: null,
  graphTransform: { x: 60, y: 220, scale: 0.85 },
  isDraggingGraph: false,
  dragStart: { x: 0, y: 0 },
  activeFilterMode: 'all', // 'all' | 'unread' | 'read'
  searchQuery: '',
  activeSelectedNodeId: null,
  activeSeriesFilter: null,
  activeContextList: null,

  reset() {
    this.currentDAGData = null;
    this.graphTransform = { x: 60, y: 220, scale: 0.85 };
    this.isDraggingGraph = false;
    this.dragStart = { x: 0, y: 0 };
    this.activeFilterMode = 'all';
    this.searchQuery = '';
    this.activeSelectedNodeId = null;
    this.activeSeriesFilter = null;
    this.activeContextList = null;
  }
};
