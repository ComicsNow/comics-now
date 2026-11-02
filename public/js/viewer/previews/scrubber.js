import { state } from '../../globals.js';
import { getThumbnailUrl, goToPage } from './thumbnail-url.js';

let scrubberBound = false;
let isScrubbing = false;
let scrubberHideTimeout = null;
let scrubberThumbRequestSeq = 0;

async function updateScrubberPreviewThumb(pageIndex) {
  const currentSeq = ++scrubberThumbRequestSeq;
  const global = state;
  const pages = global.getViewerPages?.() || [];
  if (pageIndex < 0 || pageIndex >= pages.length) return;
  const pageName = pages[pageIndex];
  const comic = global.currentComic;

  const previewSpread = document.getElementById('reader-scrubber-preview-spread');
  if (previewSpread) {
    const isSpread = global.isSpreadPage?.(pageIndex) || (global.spreadPages && global.spreadPages.has?.(pageIndex));
    if (isSpread) {
      previewSpread.classList.remove('hidden');
    } else {
      previewSpread.classList.add('hidden');
    }
  }

  const previewImg = document.getElementById('reader-scrubber-preview-img');
  try {
    const url = await getThumbnailUrl(comic, pageName, global);
    if (currentSeq === scrubberThumbRequestSeq && previewImg && url) {
      previewImg.src = url;
    }
  } catch (e) {}
}

function initReaderScrubber() {
  const slider = document.getElementById('fullscreen-scrubber-slider');
  const trackFill = document.getElementById('fullscreen-scrubber-track-fill');
  const currentNum = document.getElementById('fullscreen-scrubber-current-page');
  const preview = document.getElementById('reader-scrubber-preview');
  const previewPageText = document.getElementById('reader-scrubber-preview-page-text');

  if (!slider || scrubberBound) return;
  scrubberBound = true;

  function updatePreviewPosition(targetPage, pct, clientX = null) {
    if (!preview) return;
    const rect = (typeof slider.getBoundingClientRect === 'function')
      ? slider.getBoundingClientRect()
      : { left: 0, right: 300, width: 300 };
    const sliderWidth = rect.width > 0 ? rect.width : 300;
    const thumbX = (clientX !== null)
      ? clientX
      : (rect.left + pct * sliderWidth);

    preview.style.left = `${thumbX}px`;
    preview.classList.remove('hidden');

    if (previewPageText) {
      previewPageText.textContent = `Page ${targetPage}`;
    }

    updateScrubberPreviewThumb(targetPage - 1);
  }

  slider.addEventListener('input', () => {
    isScrubbing = true;
    clearTimeout(scrubberHideTimeout);
    const val = parseInt(slider.value, 10) || 1;
    const max = parseInt(slider.max, 10) || 1;
    const pct = max > 1 ? (val - 1) / (max - 1) : 0;

    if (currentNum) currentNum.textContent = String(val);
    if (trackFill) trackFill.style.width = `${pct * 100}%`;

    updatePreviewPosition(val, pct);
  });

  slider.addEventListener('change', async () => {
    isScrubbing = false;
    const val = parseInt(slider.value, 10) || 1;
    await goToPage(val - 1);
    scrubberHideTimeout = setTimeout(() => {
      if (!isScrubbing && preview) preview.classList.add('hidden');
    }, 350);
  });

  slider.addEventListener('pointerdown', () => {
    isScrubbing = true;
    clearTimeout(scrubberHideTimeout);
  });

  slider.addEventListener('pointerup', () => {
    isScrubbing = false;
    scrubberHideTimeout = setTimeout(() => {
      if (!isScrubbing && preview) preview.classList.add('hidden');
    }, 400);
  });

  slider.addEventListener('pointercancel', () => {
    isScrubbing = false;
    if (preview) preview.classList.add('hidden');
  });

  slider.addEventListener('pointermove', (e) => {
    if (isScrubbing) return;
    const rect = (typeof slider.getBoundingClientRect === 'function')
      ? slider.getBoundingClientRect()
      : { left: 0, right: 300, width: 300 };
    const sliderWidth = rect.width > 0 ? rect.width : 300;
    const max = parseInt(slider.max, 10) || 1;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / sliderWidth));
    const targetPage = Math.round(ratio * (max - 1)) + 1;
    const targetPct = max > 1 ? (targetPage - 1) / (max - 1) : 0;

    clearTimeout(scrubberHideTimeout);
    updatePreviewPosition(targetPage, targetPct, e.clientX);
  });

  slider.addEventListener('pointerleave', () => {
    if (!isScrubbing && preview) {
      preview.classList.add('hidden');
    }
  });
}

function updateReaderScrubberStatus(currentPage, totalPages) {
  const slider = document.getElementById('fullscreen-scrubber-slider');
  const trackFill = document.getElementById('fullscreen-scrubber-track-fill');
  const currentNum = document.getElementById('fullscreen-scrubber-current-page');
  const totalNum = document.getElementById('fullscreen-scrubber-total-pages');

  const cur = Math.max(1, currentPage || 1);
  const tot = Math.max(1, totalPages || 1);

  if (slider) {
    slider.min = '1';
    slider.max = String(tot);
    slider.value = String(cur);
  }
  if (currentNum) currentNum.textContent = String(cur);
  if (totalNum) totalNum.textContent = String(tot);
  if (trackFill) {
    const pct = tot > 1 ? ((cur - 1) / (tot - 1)) * 100 : 0;
    trackFill.style.width = `${pct}%`;
  }

  const fn = state?.updateFilmstripActiveCard || (typeof window !== 'undefined' ? window.updateFilmstripActiveCard : null);
  if (typeof fn === 'function') {
    fn(cur - 1, tot);
  }
}

export {
  updateScrubberPreviewThumb,
  initReaderScrubber,
  updateReaderScrubberStatus
};
