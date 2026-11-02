import { state } from '../globals.js';
import { getThumbnailUrl, goToPage } from './previews/thumbnail-url.js';
import {
  SPEECH_ICON,
  isPagePreviewGridOpen,
  selectPreviewPage,
  buildOverlay,
  openPagePreviewGrid,
  closePagePreviewGrid
} from './previews/grid-overlay.js';
import {
  updateScrubberPreviewThumb,
  initReaderScrubber,
  updateReaderScrubberStatus
} from './previews/scrubber.js';
import {
  updateFilmstripActiveCard,
  renderThumbnailFilmstrip,
  isFilmstripOpen,
  openFilmstrip,
  closeFilmstrip,
  toggleFilmstrip,
  setupFilmstripDragScroll,
  initReaderFilmstrip
} from './previews/filmstrip.js';

let escHandlerBound = false;

function ensureEscHandler() {
  if (escHandlerBound) return;
  escHandlerBound = true;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (isPagePreviewGridOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        closePagePreviewGrid();
      } else if (isFilmstripOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        closeFilmstrip();
      }
    }
  }, true);
}

function initPagePreviews() {
  ensureEscHandler();

  const triggerButtons = [
    document.getElementById('page-grid-btn'),
    document.getElementById('page-grid-btn-bottom'),
    document.getElementById('viewer-page-grid-top-btn'),
    document.getElementById('fullscreen-page-grid-btn')
  ];
  triggerButtons.forEach((btn) => {
    if (btn && !btn._previewTriggerBound) {
      btn._previewTriggerBound = true;
      btn.addEventListener('click', (e) => { e.preventDefault(); openPagePreviewGrid(btn); });
    }
  });

  initReaderScrubber();
  initReaderFilmstrip();
}

const PagePreviews = {
  getThumbnailUrl,
  goToPage,
  isPagePreviewGridOpen,
  selectPreviewPage,
  openPagePreviewGrid,
  closePagePreviewGrid,
  initPagePreviews,
  initReaderScrubber,
  updateReaderScrubberStatus,
  openFilmstrip,
  closeFilmstrip,
  toggleFilmstrip,
  isFilmstripOpen,
  renderThumbnailFilmstrip,
  updateFilmstripActiveCard
};

if (typeof state !== 'undefined') {
  state.ensureEscHandler = ensureEscHandler;
  Object.assign(state, PagePreviews);
}
if (typeof window !== 'undefined') {
  window.ensureEscHandler = ensureEscHandler;
  Object.assign(window, PagePreviews);
}

export {
  getThumbnailUrl,
  goToPage,
  isPagePreviewGridOpen,
  selectPreviewPage,
  openPagePreviewGrid,
  closePagePreviewGrid,
  initPagePreviews,
  initReaderScrubber,
  updateReaderScrubberStatus,
  openFilmstrip,
  closeFilmstrip,
  toggleFilmstrip,
  isFilmstripOpen,
  renderThumbnailFilmstrip,
  updateFilmstripActiveCard,
  PagePreviews
};
