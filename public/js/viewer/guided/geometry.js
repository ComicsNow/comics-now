(function (global) {
  'use strict';

  global.GuidedView = global.GuidedView || {};

  // Fraction of box A's area that lies inside box B.
  function intersectionOverArea(a, b) {
    const [ax, ay, aw, ah] = a;
    const [bx, by, bw, bh] = b;
    const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
    const x2 = Math.min(ax + aw, bx + bw), y2 = Math.min(ay + ah, by + bh);
    const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
    const inter = iw * ih;
    const area = aw * ah;
    return area > 0 ? inter / area : 0;
  }

  // Classify the manga raw boxes into panels with their child bubbles.
  // Returns [{ box, bubbles: [box, ...] }, ...].
  function classifyMangaPage() {
    const boxes = global.GuidedView.currentPageRawBoxes();
    if (boxes.length === 0) return [];
    const isChild = boxes.map((b, i) =>
      boxes.some((other, j) => i !== j && intersectionOverArea(b, other) >= 0.7)
    );
    const panels = [];
    const panelOriginalIdx = [];
    for (let i = 0; i < boxes.length; i++) {
      if (!isChild[i]) {
        panelOriginalIdx.push(i);
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

  global.GuidedView.intersectionOverArea = intersectionOverArea;
  global.GuidedView.classifyMangaPage = classifyMangaPage;

})(typeof window !== 'undefined' ? window : globalThis);
