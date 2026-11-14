import { state, clearElement } from '../globals.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };

export function updateBreadcrumb(segments) {
  const nav = document.getElementById('breadcrumb');
  if (!nav) return;

  clear(nav);

  const ancestorSegments = Array.isArray(segments) && segments.length > 1
    ? segments.slice(0, -1)
    : [];

  if (ancestorSegments.length === 0) {
    nav.classList.add('hidden');
    nav.classList.remove('flex');
    return;
  }

  nav.classList.remove('hidden');
  nav.classList.add('flex');

  ancestorSegments.forEach((seg, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'text-gray-600 select-none';
      sep.textContent = '/';
      nav.appendChild(sep);
    }

    if (seg.action) {
      const btn = document.createElement('button');
      btn.className = 'text-gray-400 hover:text-white underline underline-offset-2 transition-colors truncate max-w-[10rem] sm:max-w-[16rem] cursor-pointer';
      btn.textContent = seg.label;
      btn.addEventListener('click', seg.action);
      nav.appendChild(btn);
    } else {
      const span = document.createElement('span');
      span.className = 'text-gray-400 font-medium truncate max-w-[10rem] sm:max-w-[16rem]';
      span.textContent = seg.label;
      nav.appendChild(span);
    }
  });
}

export function makeCountChips(counts) {
  const activeFilter = state.activeFilter;
  if (activeFilter === 'in-progress') {
    return `<div class="card-counts"><span class="card-count-chip in-progress">${counts.inProgress} in prog</span></div>`;
  } else if (activeFilter === 'read') {
    return `<div class="card-counts"><span class="card-count-chip read">${counts.read} read</span></div>`;
  } else if (activeFilter === 'unread') {
    return `<div class="card-counts"><span class="card-count-chip unread">${counts.unread} unread</span></div>`;
  }
  const chips = [];
  if (counts.total > 0) chips.push(`<span class="card-count-chip">${counts.total}</span>`);
  if (counts.unread > 0) chips.push(`<span class="card-count-chip unread">${counts.unread} unread</span>`);
  if (counts.inProgress > 0) chips.push(`<span class="card-count-chip in-progress">${counts.inProgress} prog</span>`);
  if (counts.read > 0) chips.push(`<span class="card-count-chip read">${counts.read} read</span>`);
  return `<div class="card-counts">${chips.join('')}</div>`;
}

export const LibraryBreadcrumb = {
  updateBreadcrumb,
  makeCountChips
};

// Expose on state & window for transitional compatibility
state.LibraryBreadcrumb = LibraryBreadcrumb;
Object.assign(state, LibraryBreadcrumb);

if (typeof window !== 'undefined') {
  window.LibraryBreadcrumb = LibraryBreadcrumb;
  Object.assign(window, LibraryBreadcrumb);
}
