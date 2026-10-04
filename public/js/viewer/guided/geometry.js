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

state.GuidedView.intersectionOverArea = intersectionOverArea;
state.GuidedView.classifyMangaBoxes = classifyMangaBoxes;
state.GuidedView.classifyMangaPage = classifyMangaPage;

if (typeof window !== 'undefined') {
  window.GuidedView.intersectionOverArea = intersectionOverArea;
  window.GuidedView.classifyMangaBoxes = classifyMangaBoxes;
  window.GuidedView.classifyMangaPage = classifyMangaPage;
}
