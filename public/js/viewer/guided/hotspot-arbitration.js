// Edge hotspot arbitration: decides whether a tap/hover on the fullscreen
// left/right page-turn hotspots should instead target a speech bubble.
// Speech bubbles only — manga panels never steal edge taps.
import { state } from '../../globals.js';

state.GuidedView = state.GuidedView || {};

// Screen-pixel tolerance around a bubble for edge hits (kept tight so page
// turns stay easy near the screen edge).
export const EDGE_BUBBLE_HIT_PAD_PX = 6;

const EDGE_BUBBLE_MODES = ['western-speech-zoom', 'manga-speech-zoom', 'manga-panel-zoom', 'bubble'];

// Rect of the image content as drawn with `object-fit: contain`.
export function getRenderedImageRect(img) {
  const rect = img.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  let width = rect.width;
  let height = rect.height;
  if (img.naturalWidth > 0 && img.naturalHeight > 0 && rect.width > 0 && rect.height > 0) {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = rect.width / rect.height;
    if (boxRatio > imgRatio + 0.01) {
      width = rect.height * imgRatio;
      left = rect.left + (rect.width - width) / 2;
    } else if (boxRatio < imgRatio - 0.01) {
      height = rect.width / imgRatio;
      top = rect.top + (rect.height - height) / 2;
    }
  }
  return { left, top, width, height };
}

// Maps a client point to natural image coordinates; null when outside the drawn image.
export function clientPointToNatural(img, clientX, clientY) {
  const drawn = getRenderedImageRect(img);
  if (!drawn.width || !drawn.height) return null;
  const inside = clientX >= drawn.left && clientX <= drawn.left + drawn.width
    && clientY >= drawn.top && clientY <= drawn.top + drawn.height;
  if (!inside) return null;
  const scaleX = img.naturalWidth / drawn.width;
  const scaleY = img.naturalHeight / drawn.height;
  return { nx: (clientX - drawn.left) * scaleX, ny: (clientY - drawn.top) * scaleY, scaleX, scaleY };
}

// Per-mode bubble source and hit padding; null for modes that never use edge bubbles.
export function getEdgeBubbleConfig(modeName, scaleX, scaleY) {
  const view = state.GuidedView;
  const padded = {
    hitPadX: Math.max(1, Math.round(EDGE_BUBBLE_HIT_PAD_PX * scaleX)),
    hitPadY: Math.max(1, Math.round(EDGE_BUBBLE_HIT_PAD_PX * scaleY))
  };
  const exact = { hitPadX: 0, hitPadY: 0 };
  switch (modeName) {
    case 'western-speech-zoom': return { getBubbles: view.currentPageBubbles, hitOptions: padded };
    case 'manga-speech-zoom': return { getBubbles: view.mangaPageBubbles, hitOptions: padded };
    case 'manga-panel-zoom': return { getBubbles: view.mangaPageBubbles, hitOptions: exact };
    case 'bubble': return { getBubbles: view.currentPageBubbles, hitOptions: exact };
    default: return null;
  }
}

function isElementVisible(el) {
  return !!el && el.style.display !== 'none' && !el.classList.contains('hidden');
}

function isEdgeArbitrationSuspended() {
  const controls = document.getElementById('fullscreen-controls') || state.fullscreenControls;
  if (controls && !controls.classList.contains('hidden')) return true;
  return !!(state.isFullscreenZoomed || state.isContinuousMode || state.isFullImageMode);
}

function isCoveredByMagnifier(clientX, clientY) {
  const overlay = document.getElementById('bubble-magnifier-overlay');
  if (!isElementVisible(overlay)) return false;
  const r = overlay.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

// Returns { nx, ny, index, hitOptions } for a speech bubble under the client point, else null.
export function findEdgeBubbleAtClient(clientX, clientY) {
  if (isEdgeArbitrationSuspended()) return null;
  const registry = state.GuidedView.ModeRegistry;
  const modeName = registry?.getActiveModeName();
  if (!modeName || !EDGE_BUBBLE_MODES.includes(modeName)) return null;
  if (registry.getManualOverrideBox()) return null;
  if (isCoveredByMagnifier(clientX, clientY)) return null;

  const img = document.getElementById('fullscreen-image');
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const point = clientPointToNatural(img, clientX, clientY);
  if (!point) return null;

  const config = getEdgeBubbleConfig(modeName, point.scaleX, point.scaleY);
  if (!config || typeof config.getBubbles !== 'function') return null;
  const bubbles = config.getBubbles();
  const findBubble = state.GuidedView.findBubbleAtPoint;
  if (typeof findBubble !== 'function') return null;
  const index = findBubble(bubbles, point.nx, point.ny, config.hitOptions);
  if (index === -1) return null;
  return { nx: point.nx, ny: point.ny, index, hitOptions: config.hitOptions };
}

export function hasEdgeBubbleAtClient(clientX, clientY) {
  return !!findEdgeBubbleAtClient(clientX, clientY);
}

const api = {
  EDGE_BUBBLE_HIT_PAD_PX, getRenderedImageRect, clientPointToNatural,
  getEdgeBubbleConfig, findEdgeBubbleAtClient, hasEdgeBubbleAtClient
};
Object.assign(state.GuidedView, api);
if (typeof window !== 'undefined' && window.GuidedView && window.GuidedView !== state.GuidedView) {
  Object.assign(window.GuidedView, api);
}
