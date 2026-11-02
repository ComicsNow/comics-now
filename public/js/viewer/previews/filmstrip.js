import { state, clearElement } from '../../globals.js';
import { getThumbnailUrl, goToPage } from './thumbnail-url.js';
import { openPagePreviewGrid } from './grid-overlay.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };

let filmstripObserver = null;
let lastRenderedComicId = null;
let lastRenderedPageCount = 0;
let isFilmstripDragging = false;
let filmstripDragStartX = 0;
let filmstripDragStartScroll = 0;

function updateFilmstripActiveCard(currentIndex, totalPages) {
  const itemsContainer = document.getElementById('reader-filmstrip-items');
  const indicator = document.getElementById('reader-filmstrip-page-indicator');
  if (indicator && typeof currentIndex === 'number') {
    indicator.textContent = `Page ${currentIndex + 1} of ${totalPages || 1}`;
  }
  if (!itemsContainer) return;

  let activeCard = null;
  const cards = itemsContainer.querySelectorAll('.comic-filmstrip-card');
  cards.forEach((card) => {
    const cardIdx = parseInt(card.getAttribute('data-page-index'), 10);
    if (cardIdx === currentIndex) {
      card.classList.add('active-filmstrip-card');
      card.setAttribute('aria-label', `Page ${cardIdx + 1} (current)`);
      activeCard = card;
    } else {
      card.classList.remove('active-filmstrip-card');
      card.setAttribute('aria-label', `Page ${cardIdx + 1}`);
    }
  });

  if (activeCard && typeof activeCard.scrollIntoView === 'function') {
    try {
      activeCard.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      try { activeCard.scrollIntoView(); } catch (err) {}
    }
  }
}

function renderThumbnailFilmstrip() {
  const global = typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? window.state : {});
  const itemsContainer = document.getElementById('reader-filmstrip-items');
  const scrollEl = document.getElementById('reader-filmstrip-scroll');
  const indicator = document.getElementById('reader-filmstrip-page-indicator');
  if (!itemsContainer) return;

  const pages = global.getViewerPages?.() || [];
  const comic = global.currentComic;
  const comicId = comic?.id || comic?.path || 'unknown';
  const currentIndex = typeof global.currentPageIndex === 'number' ? global.currentPageIndex : 0;

  if (indicator) {
    indicator.textContent = `Page ${currentIndex + 1} of ${pages.length || 1}`;
  }

  if (lastRenderedComicId === comicId && lastRenderedPageCount === pages.length && itemsContainer.children.length === pages.length) {
    updateFilmstripActiveCard(currentIndex, pages.length);
    return;
  }

  if (filmstripObserver) {
    try { filmstripObserver.disconnect(); } catch (e) {}
    filmstripObserver = null;
  }

  clear(itemsContainer);
  lastRenderedComicId = comicId;
  lastRenderedPageCount = pages.length;

  const IO = (typeof IntersectionObserver !== 'undefined') ? IntersectionObserver : null;
  if (IO) {
    filmstripObserver = new IO((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target._loadThumb?.();
          filmstripObserver.unobserve(entry.target);
        }
      }
    }, { root: scrollEl || null, rootMargin: '300px' });
  }

  const getThumb = typeof getThumbnailUrl === 'function' ? getThumbnailUrl : (global.getThumbnailUrl || (typeof window !== 'undefined' ? window.getThumbnailUrl : null));
  const goTo = typeof goToPage === 'function' ? goToPage : (global.goToPage || (typeof window !== 'undefined' ? window.goToPage : null));

  for (let i = 0; i < pages.length; i++) {
    const pageName = pages[i];
    const pageNumber = i + 1;
    const isActive = (i === currentIndex);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `comic-filmstrip-card ${isActive ? 'active-filmstrip-card' : ''}`.trim();
    card.setAttribute('data-page-index', String(i));
    card.setAttribute('aria-label', `Page ${pageNumber}${isActive ? ' (current)' : ''}`);

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'comic-filmstrip-thumb-wrap';

    const img = document.createElement('img');
    img.alt = `Page ${pageNumber}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'comic-filmstrip-img';

    img._loadThumb = () => {
      if (img._thumbRequested) return;
      img._thumbRequested = true;
      if (typeof getThumb === 'function') {
        getThumb(comic, pageName, global).then((url) => { if (url) img.src = url; });
      }
    };

    thumbWrap.appendChild(img);

    const label = document.createElement('div');
    label.className = 'comic-filmstrip-number';
    label.textContent = String(pageNumber);

    card.appendChild(thumbWrap);
    card.appendChild(label);

    card.addEventListener('click', (e) => {
      if (isFilmstripDragging) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      if (typeof goTo === 'function') {
        goTo(i);
      }
      updateFilmstripActiveCard(i, pages.length);
    });

    itemsContainer.appendChild(card);

    if (filmstripObserver) filmstripObserver.observe(img);
    else img._loadThumb();
  }

  updateFilmstripActiveCard(currentIndex, pages.length);
}

function isFilmstripOpen() {
  const el = document.getElementById('reader-thumbnail-filmstrip');
  return !!(el && !el.classList.contains('hidden'));
}

function setupFilmstripDragScroll(scrollEl) {
  if (!scrollEl || scrollEl._dragScrollBound) return;
  scrollEl._dragScrollBound = true;

  const filmstripEl = document.getElementById('reader-thumbnail-filmstrip');
  if (filmstripEl && !filmstripEl._stopPropBound) {
    filmstripEl._stopPropBound = true;
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend'].forEach((evt) => {
      filmstripEl.addEventListener(evt, (e) => {
        e.stopPropagation();
      }, { passive: evt.startsWith('touch') });
    });
  }

  let touchStartX = 0;
  let touchStartScroll = 0;
  let isTouchDown = false;

  scrollEl.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      isTouchDown = true;
      touchStartX = e.touches[0].clientX;
      touchStartScroll = scrollEl.scrollLeft;
      isFilmstripDragging = false;
    }
  }, { passive: true });

  scrollEl.addEventListener('touchmove', (e) => {
    if (!isTouchDown || !e.touches || e.touches.length !== 1) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX;
    if (Math.abs(diff) > 4) {
      isFilmstripDragging = true;
      scrollEl.scrollLeft = touchStartScroll - diff;
    }
  }, { passive: true });

  const onTouchEnd = () => {
    isTouchDown = false;
    if (isFilmstripDragging) {
      setTimeout(() => { isFilmstripDragging = false; }, 100);
    }
  };

  scrollEl.addEventListener('touchend', onTouchEnd, { passive: true });
  scrollEl.addEventListener('touchcancel', onTouchEnd, { passive: true });

  let isMouseDown = false;

  scrollEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isMouseDown = true;
    isFilmstripDragging = false;
    filmstripDragStartX = e.clientX;
    filmstripDragStartScroll = scrollEl.scrollLeft;
    scrollEl.classList.add('is-dragging');
  });

  const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('mousemove', (e) => {
      if (!isMouseDown) return;
      const diff = e.clientX - filmstripDragStartX;
      if (Math.abs(diff) > 4) {
        isFilmstripDragging = true;
        scrollEl.scrollLeft = filmstripDragStartScroll - diff;
      }
    });

    win.addEventListener('mouseup', () => {
      if (isMouseDown) {
        isMouseDown = false;
        scrollEl.classList.remove('is-dragging');
        if (isFilmstripDragging) {
          setTimeout(() => { isFilmstripDragging = false; }, 100);
        }
      }
    });
  }
}

function openFilmstrip(triggerEl = null) {
  const el = document.getElementById('reader-thumbnail-filmstrip');
  if (!el) return;
  el.classList.remove('hidden');

  const btn = document.getElementById('fullscreen-filmstrip-btn');
  if (btn) btn.setAttribute('aria-pressed', 'true');

  const scrollEl = document.getElementById('reader-filmstrip-scroll');
  if (scrollEl) setupFilmstripDragScroll(scrollEl);

  renderThumbnailFilmstrip();
}

function closeFilmstrip() {
  const el = document.getElementById('reader-thumbnail-filmstrip');
  if (el) el.classList.add('hidden');

  const btn = document.getElementById('fullscreen-filmstrip-btn');
  if (btn) btn.setAttribute('aria-pressed', 'false');
}

function toggleFilmstrip(triggerEl = null) {
  if (isFilmstripOpen()) {
    closeFilmstrip();
  } else {
    openFilmstrip(triggerEl);
  }
}

function initReaderFilmstrip() {
  const scrollEl = document.getElementById('reader-filmstrip-scroll');
  if (scrollEl) {
    setupFilmstripDragScroll(scrollEl);
  }

  const filmstripBtn = document.getElementById('fullscreen-filmstrip-btn');
  if (filmstripBtn && !filmstripBtn._filmstripBound) {
    filmstripBtn._filmstripBound = true;
    filmstripBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFilmstrip(filmstripBtn);
    });
  }

  const openGrid = typeof openPagePreviewGrid === 'function' ? openPagePreviewGrid : (typeof state !== 'undefined' ? state.openPagePreviewGrid : (typeof window !== 'undefined' ? window.openPagePreviewGrid : null));
  const gridBtn = document.getElementById('reader-filmstrip-grid-btn');
  if (gridBtn && !gridBtn._gridBound) {
    gridBtn._gridBound = true;
    gridBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openGrid === 'function') {
        openGrid(gridBtn);
      }
    });
  }

  const closeBtn = document.getElementById('reader-filmstrip-close-btn');
  if (closeBtn && !closeBtn._closeBound) {
    closeBtn._closeBound = true;
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeFilmstrip();
    });
  }
}

if (typeof state !== 'undefined') {
  state.updateFilmstripActiveCard = updateFilmstripActiveCard;
  state.renderThumbnailFilmstrip = renderThumbnailFilmstrip;
  state.isFilmstripOpen = isFilmstripOpen;
  state.openFilmstrip = openFilmstrip;
  state.closeFilmstrip = closeFilmstrip;
  state.toggleFilmstrip = toggleFilmstrip;
  state.initReaderFilmstrip = initReaderFilmstrip;
}
if (typeof window !== 'undefined') {
  window.updateFilmstripActiveCard = updateFilmstripActiveCard;
  window.renderThumbnailFilmstrip = renderThumbnailFilmstrip;
  window.isFilmstripOpen = isFilmstripOpen;
  window.openFilmstrip = openFilmstrip;
  window.closeFilmstrip = closeFilmstrip;
  window.toggleFilmstrip = toggleFilmstrip;
  window.initReaderFilmstrip = initReaderFilmstrip;
}

export {
  updateFilmstripActiveCard,
  renderThumbnailFilmstrip,
  isFilmstripOpen,
  openFilmstrip,
  closeFilmstrip,
  toggleFilmstrip,
  setupFilmstripDragScroll,
  initReaderFilmstrip
};
