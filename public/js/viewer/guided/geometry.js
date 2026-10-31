import { state } from '../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

// Fraction of box A's area that lies inside box B.
export function intersectionOverArea(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw), y2 = Math.min(ay + ah, by + bh);
  const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const area = aw * ah;
  return area > 0 ? inter / area : 0;
}

// Classify manga raw boxes into panels with their child bubbles.
// Returns [{ box, bubbles: [box, ...] }, ...].
//
// Two regimes:
// - Legacy sidecars (explicitBubbles empty): heuristic split of the mixed raw
//   set — a box that lies >= 0.7 inside any other is a child, then attached to
//   the panel it overlaps most (> 0.6).
// - Editor-written sidecars (explicitBubbles non-empty): the raw list is pure
//   panels and the explicit bubble list is authoritative — every raw box stays
//   a panel and each bubble attaches to its best-overlapping panel (> 0.6).
export function classifyMangaBoxes(rawBoxes, explicitBubbles) {
  const boxes = Array.isArray(rawBoxes) ? rawBoxes : [];
  const explicit = Array.isArray(explicitBubbles) ? explicitBubbles : [];

  if (explicit.length > 0) {
    const panels = boxes.map((box) => ({ box, bubbles: [] }));
    for (const bubble of explicit) {
      let bestParent = -1, bestRatio = 0.6;
      for (let p = 0; p < panels.length; p++) {
        const r = intersectionOverArea(bubble, panels[p].box);
        if (r > bestRatio) { bestRatio = r; bestParent = p; }
      }
      if (bestParent >= 0) panels[bestParent].bubbles.push(bubble);
    }
    return panels;
  }

  if (boxes.length === 0) return [];
  const isChild = boxes.map((b, i) =>
    boxes.some((other, j) => i !== j && intersectionOverArea(b, other) >= 0.7)
  );
  const panels = [];
  for (let i = 0; i < boxes.length; i++) {
    if (!isChild[i]) {
      panels.push({ box: boxes[i], bubbles: [] });
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    if (!isChild[i]) continue;
    let bestParent = -1, bestRatio = 0.6;
    for (let p = 0; p < panels.length; p++) {
      const r = intersectionOverArea(boxes[i], panels[p].box);
      if (r > bestRatio) { bestRatio = r; bestParent = p; }
    }
    if (bestParent >= 0) panels[bestParent].bubbles.push(boxes[i]);
  }
  return panels;
}

export function classifyMangaPage() {
  // Only bubbles referenced by the page's sequence count as editor-written
  // (see mangaExplicitBubbles); anything else keeps the legacy heuristic.
  const explicit = state.GuidedView.mangaExplicitBubbles
    ? state.GuidedView.mangaExplicitBubbles()
    : [];
  return classifyMangaBoxes(state.GuidedView.currentPageRawBoxes(), explicit);
}

// Finds the best matching bubble index for a click point (nx, ny) in natural coordinates.
// Expands the clickable hit target around small bubbles so they can be easily tapped.
export function findBubbleAtPoint(bubbles, nx, ny, options = {}) {
  if (!Array.isArray(bubbles) || bubbles.length === 0) return -1;

  const img = (typeof document !== 'undefined') ? document.getElementById('fullscreen-image') : null;
  let scaleX = 1;
  let scaleY = 1;
  if (img && img.naturalWidth && img.clientWidth) {
    scaleX = img.naturalWidth / img.clientWidth;
    scaleY = img.naturalHeight / img.clientHeight;
  }
  
  // Custom or adaptive hit padding: target ~32px screen padding horizontally and ~36px vertically
  const hitPadX = options.hitPadX !== undefined ? options.hitPadX : Math.max(30, Math.round(32 * scaleX));
  const hitPadY = options.hitPadY !== undefined ? options.hitPadY : Math.max(30, Math.round(36 * scaleY));

  let bestExactIdx = -1;
  let minExactArea = Infinity;

  let bestPaddedIdx = -1;
  let minPaddedDist = Infinity;

  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const [bx, by, bw, bh] = Array.isArray(b) ? b : [b.x, b.y, b.w, b.h];

    // 1. Check exact hit inside bubble
    if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
      const area = bw * bh;
      if (area < minExactArea) {
        minExactArea = area;
        bestExactIdx = i;
      }
      continue;
    }

    // 2. Check expanded margin hit
    const dx = Math.max(0, bx - nx, nx - (bx + bw));
    const dy = Math.max(0, by - ny, ny - (by + bh));
    if (dx <= hitPadX && dy <= hitPadY) {
      const dist = Math.hypot(dx / hitPadX, dy / hitPadY);
      if (dist < minPaddedDist) {
        minPaddedDist = dist;
        bestPaddedIdx = i;
      }
    }
  }

  return bestExactIdx !== -1 ? bestExactIdx : bestPaddedIdx;
}

state.GuidedView.intersectionOverArea = intersectionOverArea;
state.GuidedView.classifyMangaBoxes = classifyMangaBoxes;
state.GuidedView.classifyMangaPage = classifyMangaPage;
state.GuidedView.findBubbleAtPoint = findBubbleAtPoint;

if (typeof window !== 'undefined') {
  window.GuidedView.intersectionOverArea = intersectionOverArea;
  window.GuidedView.classifyMangaBoxes = classifyMangaBoxes;
  window.GuidedView.classifyMangaPage = classifyMangaPage;
  window.GuidedView.findBubbleAtPoint = findBubbleAtPoint;
}
