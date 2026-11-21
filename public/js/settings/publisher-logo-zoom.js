const TRIGGER_SELECTOR = [
  '[data-publisher-logo-zoom]',
  '[data-logo-zoom]',
  '[data-logo-zoom-src]',
].join(', ');
const ATTR_SETS = {
  src: ['data-logo-zoom-src', 'data-logo-src', 'data-zoom-image', 'data-zoom-src', 'data-src'],
  format: ['data-logo-zoom-format', 'data-logo-format', 'data-zoom-format'],
  width: ['data-logo-zoom-width', 'data-logo-width', 'data-zoom-width'],
  height: ['data-logo-zoom-height', 'data-logo-height', 'data-zoom-height'],
  alt: ['data-logo-zoom-alt', 'data-logo-alt', 'data-zoom-alt', 'alt'],
  needsLightBackground: [
    'data-logo-zoom-needs-light-background',
    'data-logo-needs-light-background',
    'data-zoom-needs-light',
  ],
  needsDarkBackground: [
    'data-logo-zoom-needs-dark-background',
    'data-logo-needs-dark-background',
    'data-zoom-needs-dark',
  ],
};
let modalElement = null;
let modalImage = null;
let modalResolution = null;
let currentTrigger = null;
let previousBodyOverflow = '';
let keydownHandler = null;
let modalClickHandler = null;
let initialized = false;
function firstDefined(element, keys) {
  for (const key of keys) {
    if (element && element.hasAttribute && element.hasAttribute(key)) {
      const value = element.getAttribute(key);
      if (value !== null && value !== '') return value;
    }
  }
  return null;
}
function parseBoolean(value) {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return !['false', '0', 'no', 'off', ''].includes(normalized);
}
function normalizeFormat(format) {
  if (!format) return null;
  const clean = format.trim().toLowerCase();
  if (clean.startsWith('image/')) return clean.split('/')[1].toUpperCase();
  return clean.toUpperCase();
}
function inferFormatFromSrc(src) {
  const clean = (src || '').split('?')[0];
  const match = clean.match(/\.([a-z0-9]+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  if (ext === 'jpg') return 'JPEG';
  return ext.toUpperCase();
}
function resolveSrc(trigger) {
  const src = firstDefined(trigger, ATTR_SETS.src);
  if (src) return src;
  if (trigger.tagName === 'IMG' && (trigger.currentSrc || trigger.src)) {
    return trigger.currentSrc || trigger.src;
  }
  const img = trigger.querySelector('img');
  if (img && (img.currentSrc || img.src)) {
    return img.currentSrc || img.src;
  }
  if (trigger.hasAttribute('href')) return trigger.getAttribute('href');
  return '';
}
function extractImageData(trigger) {
  const src = resolveSrc(trigger);
  const rawFormat = firstDefined(trigger, ATTR_SETS.format);
  const format =
    normalizeFormat(rawFormat) ||
    inferFormatFromSrc(src) ||
    'IMG';
  const widthValue = firstDefined(trigger, ATTR_SETS.width);
  const heightValue = firstDefined(trigger, ATTR_SETS.height);
  return {
    src,
    format,
    width: widthValue ? Number.parseInt(widthValue, 10) : null,
    height: heightValue ? Number.parseInt(heightValue, 10) : null,
    alt: firstDefined(trigger, ATTR_SETS.alt) || 'Publisher logo preview',
    needsLightBackground: parseBoolean(
      firstDefined(trigger, ATTR_SETS.needsLightBackground)
    ),
    needsDarkBackground: parseBoolean(
      firstDefined(trigger, ATTR_SETS.needsDarkBackground)
    ),
  };
}
function createElement(tag, className, parent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (parent) parent.append(el);
  return el;
}
function createCloseIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('class', 'w-5 h-5');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', 'M6 18L18 6M6 6l12 12');
  svg.append(path);
  return svg;
}
function buildModal(imageData) {
  const root = createElement(
    'div',
    'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs'
  );
  root.id = 'publisher-logo-zoom-modal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Publisher logo preview');
  const container = createElement(
    'div',
    'relative max-w-2xl w-full max-h-[90vh] bg-gray-900 border border-gray-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    root
  );
  const header = createElement(
    'div',
    'flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800',
    container
  );
  const titleGroup = createElement(
    'div',
    'flex items-center gap-2 min-w-0',
    header
  );
  const title = createElement(
    'span',
    'text-base font-bold text-white truncate',
    titleGroup
  );
  title.textContent = 'Publisher Logo';
  const formatBadge = createElement(
    'span',
    'px-2 py-0.5 rounded text-xs font-semibold uppercase bg-red-900/40 text-red-300 border border-red-700/50',
    titleGroup
  );
  formatBadge.textContent = imageData.format || 'IMG';
  const closeButton = createElement(
    'button',
    'text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors shrink-0',
    header
  );
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close preview');
  closeButton.append(createCloseIcon());
  const viewport = createElement(
    'div',
    'flex-1 min-h-0 overflow-auto p-6 flex items-center justify-center',
    container
  );
  viewport.style.backgroundImage =
    'repeating-conic-gradient(#374151 0% 25%, #1f2937 0% 50%)';
  viewport.style.backgroundSize = '16px 16px';
  const image = document.createElement('img');
  image.className = 'max-w-full max-h-[60vh] object-contain rounded shadow-lg';
  image.src = imageData.src;
  image.alt = imageData.alt || 'Publisher logo preview';
  image.decoding = 'async';
  if (imageData.width) image.width = imageData.width;
  if (imageData.height) image.height = imageData.height;
  viewport.append(image);
  const footer = createElement(
    'div',
    'px-4 py-3 border-t border-gray-800 flex flex-wrap items-center gap-2',
    container
  );
  const resolution = createElement(
    'span',
    'text-xs text-gray-400 font-mono',
    footer
  );
  resolution.textContent =
    imageData.width && imageData.height
      ? `${imageData.width} × ${imageData.height}px`
      : 'Dimensions unavailable';
  let advisory = null;
  if (imageData.needsLightBackground || imageData.needsDarkBackground) {
    advisory = createElement(
      'span',
      'px-2 py-0.5 rounded text-xs border',
      footer
    );
    if (imageData.needsLightBackground && imageData.needsDarkBackground) {
      advisory.classList.add(
        'bg-purple-400/10',
        'text-purple-300',
        'border-purple-500/30'
      );
      advisory.textContent = 'Check on both light and dark backgrounds';
    } else if (imageData.needsLightBackground) {
      advisory.classList.add(
        'bg-amber-400/10',
        'text-amber-300',
        'border-amber-500/30'
      );
      advisory.textContent = 'Best on light backgrounds';
    } else if (imageData.needsDarkBackground) {
      advisory.classList.add(
        'bg-sky-400/10',
        'text-sky-300',
        'border-sky-500/30'
      );
      advisory.textContent = 'Best on dark backgrounds';
    }
  }
  return { root, closeButton, image, resolution };
}
function closeModal(restoreFocus = true) {
  if (!modalElement) return;
  if (modalClickHandler) {
    modalElement.removeEventListener('click', modalClickHandler);
    modalClickHandler = null;
  }
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler, true);
    keydownHandler = null;
  }
  if (currentTrigger && restoreFocus && document.body.contains(currentTrigger)) {
    currentTrigger.focus({ preventScroll: true });
  }
  modalElement.remove();
  modalElement = null;
  modalImage = null;
  modalResolution = null;
  document.body.style.overflow = previousBodyOverflow;
  currentTrigger = null;
}
function openModal(imageData, trigger = null) {
  if (!imageData.src) return;
  if (modalElement) closeModal(false);
  const { root, closeButton, image, resolution } = buildModal(imageData);
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  currentTrigger = trigger;
  modalElement = root;
  modalImage = image;
  modalResolution = resolution;
  closeButton.addEventListener('click', () => closeModal());
  document.body.append(root);
  modalClickHandler = (event) => {
    if (event.target === root) closeModal();
  };
  keydownHandler = (event) => {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeModal();
    }
  };
  root.addEventListener('click', modalClickHandler);
  document.addEventListener('keydown', keydownHandler, true);
  root.addEventListener('click', modalClickHandler);
  document.addEventListener('keydown', keydownHandler);
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    closeModal();
  });
  if (!imageData.width || !imageData.height) {
    const updateResolution = () => {
      if (!modalImage || !modalResolution) return;
      const width = modalImage.naturalWidth;
      const height = modalImage.naturalHeight;
      if (width && height) {
        modalResolution.textContent = `${width} × ${height}px`;
      }
    };
    if (image.complete) {
      updateResolution();
    } else {
      image.addEventListener('load', updateResolution, { once: true });
    }
  }
  closeButton.focus();
}
function handleDocumentClick(event) {
  const trigger = event.target.closest(TRIGGER_SELECTOR);
  if (!trigger) return;
  event.preventDefault();
  openModal(extractImageData(trigger), trigger);
}
export function openPublisherLogoZoom({ url, title, format, width, height } = {}) {
  if (!url) return;
  const ext = format || (url.split('.').pop() || '').toLowerCase();
  openModal({
    src: url,
    title: title || 'Publisher Logo',
    format: ext,
    width: width || null,
    height: height || null
  });
}
export function initPublisherLogoZoom() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('click', handleDocumentClick);
}
initPublisherLogoZoom();
