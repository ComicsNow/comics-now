const {
  normalizeBoxItem,
  isBubbleInPanel,
  intersectionOverArea,
  XY_CUT_OVERLAP_RATIO
} = require('./geometry');

function findBestAxisCut(boxes, axis, overlapRatio = 0) {
  const n = boxes.length;
  if (n <= 1) return null;

  const isY = axis === 'y';
  const sorted = [...boxes].sort((a, b) => {
    const startDiff = isY ? (a.y - b.y) : (a.x - b.x);
    if (startDiff !== 0) return startDiff;
    const endDiff = isY ? ((a.y + a.h) - (b.y + b.h)) : ((a.x + a.w) - (b.x + b.w));
    if (endDiff !== 0) return endDiff;
    return a.index - b.index;
  });

  const prefixMaxEnd = new Array(n);
  let maxEnd = -Infinity;
  for (let i = 0; i < n; i++) {
    const end = isY ? (sorted[i].y + sorted[i].h) : (sorted[i].x + sorted[i].w);
    if (end > maxEnd) maxEnd = end;
    prefixMaxEnd[i] = maxEnd;
  }

  const minCoord = isY ? sorted[0].y : sorted[0].x;
  const maxCoord = prefixMaxEnd[n - 1];

  let bestIdx = -1;
  let bestGap = -Infinity;

  for (let i = 0; i < n - 1; i++) {
    const nextStart = isY ? sorted[i + 1].y : sorted[i + 1].x;
    const prevEnd = prefixMaxEnd[i];
    const gap = nextStart - prevEnd;

    let minAllowedGap = 0;
    if (overlapRatio > 0) {
      const firstSpan = Math.max(1, prevEnd - minCoord);
      const secondSpan = Math.max(1, maxCoord - nextStart);
      minAllowedGap = -Math.min(firstSpan, secondSpan) * overlapRatio;
    }

    if (gap >= minAllowedGap && gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) return null;
  return {
    first: sorted.slice(0, bestIdx + 1),
    second: sorted.slice(bestIdx + 1)
  };
}

function fallbackLinearSort(boxes, type) {
  const copy = [...boxes];
  if (type === 'manga') {
    copy.sort((a, b) => {
      const ay = a.polyY !== null ? a.polyY : a.y;
      const by = b.polyY !== null ? b.polyY : b.y;
      const axRight = a.polyX !== null ? a.polyX : (a.x + a.w);
      const bxRight = b.polyX !== null ? b.polyX : (b.x + b.w);
      const scoreA = (ay * 1.5) - axRight;
      const scoreB = (by * 1.5) - bxRight;
      return scoreA !== scoreB ? scoreA - scoreB : a.index - b.index;
    });
  } else {
    copy.sort((a, b) => {
      const ay = a.polyY !== null ? a.polyY : a.y;
      const by = b.polyY !== null ? b.polyY : b.y;
      const ax = a.polyX !== null ? a.polyX : a.x;
      const bx = b.polyX !== null ? b.polyX : b.x;
      const scoreA = (ay * 5.0) + ax;
      const scoreB = (by * 5.0) + bx;
      return scoreA !== scoreB ? scoreA - scoreB : a.index - b.index;
    });
  }
  return copy;
}

function xyCutPartition(boxes, type) {
  if (boxes.length <= 1) return boxes;

  // 1. Clean Horizontal Cut (top-to-bottom tier separation)
  const cleanY = findBestAxisCut(boxes, 'y', 0);
  if (cleanY) {
    return [
      ...xyCutPartition(cleanY.first, type),
      ...xyCutPartition(cleanY.second, type)
    ];
  }

  // 2. Clean Vertical Cut (column separation: LTR for western, RTL for manga)
  const cleanX = findBestAxisCut(boxes, 'x', 0);
  if (cleanX) {
    return type === 'manga'
      ? [...xyCutPartition(cleanX.second, type), ...xyCutPartition(cleanX.first, type)]
      : [...xyCutPartition(cleanX.first, type), ...xyCutPartition(cleanX.second, type)];
  }

  // 3. Overlap-tolerant Horizontal Cut (handles slight YOLO bounding-box bleed)
  const tolY = findBestAxisCut(boxes, 'y', XY_CUT_OVERLAP_RATIO);
  if (tolY) {
    return [
      ...xyCutPartition(tolY.first, type),
      ...xyCutPartition(tolY.second, type)
    ];
  }

  // 4. Overlap-tolerant Vertical Cut
  const tolX = findBestAxisCut(boxes, 'x', XY_CUT_OVERLAP_RATIO);
  if (tolX) {
    return type === 'manga'
      ? [...xyCutPartition(tolX.second, type), ...xyCutPartition(tolX.first, type)]
      : [...xyCutPartition(tolX.first, type), ...xyCutPartition(tolX.second, type)];
  }

  // 5. Fallback for non-separable overlapping/inset clusters
  return fallbackLinearSort(boxes, type);
}

function sortReadingOrder(items, type) {
  if (!items || items.length <= 1) return items;
  const boxes = items.map((p, i) => normalizeBoxItem(p, i));
  return xyCutPartition(boxes, type).map(b => b.raw);
}

function buildMangaSequence(allBoxes, explicitBubbles = []) {
  if (Array.isArray(explicitBubbles) && explicitBubbles.length > 0) {
    const panels = sortReadingOrder(allBoxes, 'manga');
    const sequence = [];
    const assigned = new Set();
    const panelObjects = [];

    for (const panel of panels) {
      const pBubbles = [];
      for (let i = 0; i < explicitBubbles.length; i++) {
        if (!assigned.has(i) && (isBubbleInPanel(explicitBubbles[i], panel) || intersectionOverArea(explicitBubbles[i], panel) >= 0.6)) {
          pBubbles.push(explicitBubbles[i]);
          assigned.add(i);
        }
      }
      const sortedBubbles = sortReadingOrder(pBubbles, 'manga');
      panelObjects.push({ ...panel, isPanel: true, bubbles: sortedBubbles, raw: panel });
    }

    const orphans = [];
    for (let i = 0; i < explicitBubbles.length; i++) {
      if (!assigned.has(i)) orphans.push({ ...explicitBubbles[i], isBubble: true, raw: explicitBubbles[i] });
    }

    const allFlowItems = [...panelObjects, ...orphans];
    const sortedFlow = sortReadingOrder(allFlowItems, 'manga');

    for (const item of sortedFlow) {
      if (item.isPanel) {
        sequence.push(...item.bubbles.map(b => b.raw || b));
        sequence.push(item.raw || item);
      } else {
        sequence.push(item.raw || item);
      }
    }
    return sequence;
  }

  if (!allBoxes || allBoxes.length === 0) return [];
  const isChild = new Array(allBoxes.length).fill(false);
  for (let i = 0; i < allBoxes.length; i++) {
    for (let j = 0; j < allBoxes.length; j++) {
      if (i !== j && intersectionOverArea(allBoxes[i], allBoxes[j]) >= 0.7) { isChild[i] = true; break; }
    }
  }

  const panels = allBoxes.filter((_, i) => !isChild[i]);
  const allBubbles = allBoxes.filter((_, i) => isChild[i]);
  if (panels.length === 0) return allBoxes;

  const sortedPanels = sortReadingOrder(panels, 'manga');
  const sequence = [];
  const assigned = new Set();
  const panelObjects = [];

  for (const panel of sortedPanels) {
    const pBubbles = [];
    for (let i = 0; i < allBubbles.length; i++) {
      if (!assigned.has(i) && intersectionOverArea(allBubbles[i], panel) >= 0.6) {
        pBubbles.push(allBubbles[i]);
        assigned.add(i);
      }
    }
    const sortedBubbles = sortReadingOrder(pBubbles, 'manga');
    panelObjects.push({ ...panel, isPanel: true, bubbles: sortedBubbles, raw: panel });
  }

  const orphans = [];
  for (let i = 0; i < allBubbles.length; i++) {
    if (!assigned.has(i)) orphans.push({ ...allBubbles[i], isBubble: true, raw: allBubbles[i] });
  }

  const allFlowItems = [...panelObjects, ...orphans];
  const sortedFlow = sortReadingOrder(allFlowItems, 'manga');

  for (const item of sortedFlow) {
    if (item.isPanel) {
      sequence.push(...item.bubbles.map(b => b.raw || b));
      sequence.push(item.raw || item);
    } else {
      sequence.push(item.raw || item);
    }
  }
  return sequence;
}

function buildHybridWesternSequence(panels, bubbles) {
  if (!bubbles || bubbles.length === 0) return [];
  if (!panels || panels.length === 0) return sortReadingOrder(bubbles, 'western');
  const assigned = new Set(), objects = [];
  const sortedPanels = sortReadingOrder(panels, 'western');

  for (const panel of sortedPanels) {
    const children = [];
    for (let i = 0; i < bubbles.length; i++) {
      if (!assigned.has(i) && (isBubbleInPanel(bubbles[i], panel) || intersectionOverArea(bubbles[i], panel) >= 0.35)) {
        children.push(bubbles[i]);
        assigned.add(i);
      }
    }
    objects.push({ ...panel, isPanel: true, bubbles: sortReadingOrder(children, 'western'), raw: panel });
  }

  const orphans = [];
  for (let i = 0; i < bubbles.length; i++) {
    if (!assigned.has(i)) orphans.push({ ...bubbles[i], isBubble: true, raw: bubbles[i] });
  }
  
  const finalSorted = sortReadingOrder([...objects, ...orphans], 'western');
  const seq = [];
  for (const obj of finalSorted) {
    if (obj.isPanel) seq.push(...obj.bubbles);
    else seq.push(obj.raw || obj);
  }
  return seq;
}

module.exports = {
  findBestAxisCut,
  fallbackLinearSort,
  xyCutPartition,
  sortReadingOrder,
  buildMangaSequence,
  buildHybridWesternSequence
};
