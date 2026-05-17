(function (global) {
  'use strict';

  function updateBreadcrumb(segments) {
    const nav = document.getElementById('breadcrumb');
    if (!nav) return;

    nav.innerHTML = '';

    if (!segments || segments.length === 0) {
      nav.classList.add('hidden');
      nav.classList.remove('flex');
      return;
    }

    nav.classList.remove('hidden');
    nav.classList.add('flex');

    segments.forEach((seg, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'text-gray-600 select-none';
        sep.textContent = '/';
        nav.appendChild(sep);
      }

      const isLast = i === segments.length - 1;
      const isClickable = seg.action && (!isLast || segments.length === 1);

      if (isClickable) {
        const btn = document.createElement('button');
        btn.className = 'text-gray-400 hover:text-white transition-colors truncate max-w-[10rem] sm:max-w-[16rem]';
        btn.textContent = seg.label;
        btn.addEventListener('click', seg.action);
        nav.appendChild(btn);
      } else {
        const span = document.createElement('span');
        span.className = 'text-white font-medium truncate max-w-[10rem] sm:max-w-[16rem]';
        span.textContent = seg.label;
        nav.appendChild(span);
      }
    });
  }

  function makeCountChips(counts) {
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

  const LibraryBreadcrumb = {
    updateBreadcrumb,
    makeCountChips
  };

  global.LibraryBreadcrumb = LibraryBreadcrumb;
  Object.assign(global, LibraryBreadcrumb);
})(typeof window !== 'undefined' ? window : globalThis);
