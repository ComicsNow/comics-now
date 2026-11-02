import { downloadQueueDiv, clearElement, render, html, raw } from '../../globals.js';

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
      if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
        el.innerHTML = content.toHTML();
      } else if (content && typeof content === 'object' && content.__isRawHtml) {
        el.innerHTML = content.html;
      } else {
        el.innerHTML = String(content ?? '');
      }
    };

export const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0)
  ? html
  : (strings, ...values) => {
      let out = '';
      for (let i = 0; i < strings.length; i++) {
        out += strings[i];
        if (i < values.length) {
          const v = values[i];
          if (v && typeof v === 'object' && v.__isRawHtml) out += v.html;
          else if (v && typeof v === 'object' && typeof v.toHTML === 'function') out += v.toHTML();
          else out += (v ?? '');
        }
      }
      return { toHTML: () => out, html: out, __isRawHtml: true };
    };

export const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0)
  ? raw
  : (v) => ({
      __isRawHtml: true,
      html: String(v ?? '')
    });

export const DL_ICONS = {
  start: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  cancel: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>'
};

export function createActionButton(icon, title, colorClass, onClick) {
  const btn = document.createElement('button');
  btn.className = `${colorClass} hover:opacity-80 text-2xl p-2 min-w-[44px] min-h-[44px] flex items-center justify-center`;
  renderContent(btn, safeRaw(icon));
  btn.title = title;
  btn.onclick = async (e) => {
    e.stopPropagation();
    await onClick();
  };
  return btn;
}

export function installQueueTouchTracking(manager) {
  if (!downloadQueueDiv || downloadQueueDiv._touchTrackingInstalled) return;
  downloadQueueDiv._touchTrackingInstalled = true;

  const onStart = () => {
    downloadQueueDiv._userTouching = true;
  };
  const onEnd = () => {
    downloadQueueDiv._userTouching = false;
    if (downloadQueueDiv._pendingUpdate) {
      downloadQueueDiv._pendingUpdate = false;
      requestAnimationFrame(() => manager.updateQueueUI());
    }
  };

  downloadQueueDiv.addEventListener('touchstart', onStart, { passive: true });
  downloadQueueDiv.addEventListener('touchend', onEnd, { passive: true });
  downloadQueueDiv.addEventListener('touchcancel', onEnd, { passive: true });
}

export function renderCollapsedPill(manager, activeCount, totalCount) {
  downloadQueueDiv.className = 'fixed bottom-16 right-4 sm:bottom-8 sm:right-8 z-40';

  const iconButton = document.createElement('button');
  iconButton.className = 'brutalist-btn btn-cyan px-3 py-1.5 flex items-center space-x-2 transition-all';
  iconButton.onclick = () => manager.toggleCollapsed();
  iconButton.title = 'Show download queue';

  const icon = document.createElement('span');
  renderContent(icon, safeHtml`<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>`);
  icon.className = 'inline-flex items-center justify-center';
  iconButton.appendChild(icon);

  const count = document.createElement('span');
  count.textContent = `Downloads (${activeCount}/${totalCount})`;
  count.className = 'text-xs font-mono font-bold uppercase tracking-wider';
  iconButton.appendChild(count);

  downloadQueueDiv.appendChild(iconButton);
}

export function renderEmptyQueueModal(manager) {
  downloadQueueDiv.className = 'fixed bottom-0 right-4 sm:right-8 z-40 w-[22rem] max-w-[calc(100vw-2rem)] dl-queue-container';
  renderContent(downloadQueueDiv, safeHtml`
    <div class="handle"></div>
    <div class="modal-header">
      <div class="dl-icon">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </div>
      <span class="modal-title">Downloads</span>
      <span class="modal-count">0 / 0</span>
      <div class="header-actions">
        <button type="button" data-close="downloads" class="ha" aria-label="Close downloads">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="empty-state-dl">
      <span class="empty-icon">
        <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/></svg>
      </span>
      <p class="empty-title">No active downloads</p>
      <p class="empty-subtitle">Comics you queue will appear here.</p>
    </div>
  `);
  const closeBtn = downloadQueueDiv.querySelector('[data-close="downloads"]');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      manager.explicitlyOpen = false;
      downloadQueueDiv.classList.add('hidden');
    });
  }
}
