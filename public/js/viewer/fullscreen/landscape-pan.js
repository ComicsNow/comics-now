import { state, global as canonicalGlobal } from '../../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

let landscapePanTx = 0;
let landscapePanTy = 0;
let isLandscapePanning = false;
let landscapePanPointerId = null;
let landscapePanStartX = 0;
let landscapePanStartY = 0;
let landscapePanStartTx = 0;
let landscapePanStartTy = 0;

export function isLandscapePanActive(overrideGlobal) {
  const g = overrideGlobal || global;
  if (!g.isLandscapeOrientation) return false;
  if (g.isFullImageMode) return false;
  const gv = g.GuidedView;
  if (gv && (gv.isActive?.() || gv.isBubbleActive?.() || gv.isWesternSpeechZoomActive?.() || gv.isMangaPanelZoomActive?.() || gv.isMangaSpeechZoomActive?.())) {
    return false;
  }
  return true;
}

export function applyLandscapeTransform() {
  const image = global.fullscreenImage;
  if (!image) return;
  if (global.isLandscapeOrientation) {
    image.style.transform = `translate(${landscapePanTx}px, ${landscapePanTy}px) rotate(90deg)`;
    image.style.transformOrigin = 'center center';
  }
}

export function resetLandscapePan() {
  landscapePanTx = 0;
  landscapePanTy = 0;
  const image = global.fullscreenImage;
  if (image) {
    image.style.transform = '';
    image.style.transformOrigin = '';
  }
}

export function beginLandscapePan(pointerId, clientX, clientY) {
  isLandscapePanning = true;
  landscapePanPointerId = pointerId;
  landscapePanStartX = clientX;
  landscapePanStartY = clientY;
  landscapePanStartTx = landscapePanTx;
  landscapePanStartTy = landscapePanTy;
  const image = global.fullscreenImage;
  if (image) {
    image.style.cursor = 'grabbing';
    image.style.touchAction = 'none';
  }
}

export function updateLandscapePan(clientX, clientY) {
  if (!isLandscapePanning) return;
  landscapePanTx = landscapePanStartTx + (clientX - landscapePanStartX);
  landscapePanTy = landscapePanStartTy + (clientY - landscapePanStartY);
  applyLandscapeTransform();
}

export function endLandscapePan() {
  if (!isLandscapePanning) return;
  isLandscapePanning = false;
  landscapePanPointerId = null;
  const image = global.fullscreenImage;
  if (image) {
    image.style.cursor = global.isLandscapeOrientation ? 'grab' : '';
  }
}

export function getLandscapePanState() {
  return {
    get isLandscapePanning() { return isLandscapePanning; },
    get landscapePanPointerId() { return landscapePanPointerId; },
    get landscapePanTx() { return landscapePanTx; },
    get landscapePanTy() { return landscapePanTy; }
  };
}

global.applyLandscapeTransform = applyLandscapeTransform;
global.resetLandscapePan = resetLandscapePan;
