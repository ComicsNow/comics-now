/**
 * Guided View Speech Bubble Smart Placement Engine
 *
 * Dynamically computes on-screen coordinates (targetX, targetY) for speech bubble
 * zoom callouts so they avoid obscuring the parent panel artwork and never cover
 * the clicked speech bubble.
 */

import { state } from '../../globals.js';
import { intersectionOverArea, classifyMangaBoxes } from './geometry.js';

function boxArea(box) {
  if (!box) return 0;
  const w = box[2] !== undefined ? box[2] : (box.w || 0);
  const h = box[3] !== undefined ? box[3] : (box.h || 0);
  return Math.max(0, w) * Math.max(0, h);
}

function getBoxCoords(box) {
  if (!box) return [0, 0, 0, 0];
  if (Array.isArray(box)) return box;
  return [
    box.x !== undefined ? box.x : (box[0] || 0),
    box.y !== undefined ? box.y : (box[1] || 0),
    box.w !== undefined ? box.w : (box[2] || 0),
    box.h !== undefined ? box.h : (box[3] || 0)
  ];
}

function getIntersectionArea(a, b) {
  const [ax, ay, aw, ah] = getBoxCoords(a);
  const [bx, by, bw, bh] = getBoxCoords(b);
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  return iw * ih;
}

/**
 * Finds the parent panel containing a given speech bubble.
 * Returns null for orphan bubbles (e.g. gutters, full-page captions).
 */
export function findParentPanel(panels, bubble, threshold = 0.5) {
  if (!Array.isArray(panels) || panels.length === 0 || !bubble) return null;
  const bubbleCoords = getBoxCoords(bubble);
  const bArea = boxArea(bubbleCoords);
  if (bArea <= 0) return null;

  let bestParent = null;
  let bestRatio = threshold;

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const pCoords = Array.isArray(p) ? p : (p.box || getBoxCoords(p));
    const inter = getIntersectionArea(bubbleCoords, pCoords);
    const ratio = inter / bArea;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestParent = pCoords;
    }
  }

  return bestParent;
}

/**
 * Safely extracts authoritative panels from page metadata.
 * For Western comics: avoids returning pageData.sequence when sequence holds bubbles.
 * For Manga: classifies mixed raw boxes into true panels.
 */
export function getPagePanels(pageData, isManga) {
  if (!pageData) return [];
  if (Array.isArray(pageData)) return pageData;

  if (isManga) {
    const rawBoxes = Array.isArray(pageData.panels) ? pageData.panels : [];
    const explicitBubbles = Array.isArray(pageData.bubbles) ? pageData.bubbles : [];
    const classified = (typeof classifyMangaBoxes === 'function')
      ? classifyMangaBoxes(rawBoxes, explicitBubbles)
      : [];
    return classified.map((c) => (c && c.box ? c.box : c));
  }

  // Western: prioritize explicit panels array
  if (Array.isArray(pageData.panels) && pageData.panels.length > 0) {
    return pageData.panels;
  }
  if (Array.isArray(pageData.sequence) && pageData.sequence.length > 0) {
    return pageData.sequence;
  }
  return [];
}

/**
 * Computes optimal placement for speech bubble zoom callout.
 */
export function computeSmartBubblePlacement(options = {}) {
  const {
    bubble,
    parentPanel,
    stageW = 1000,
    stageH = 1500,
    overlayW = 400,
    overlayH = 200,
    imgLayout = {},
    lastPlacement = null,
    margins = { top: 60, bottom: 80, left: 12, right: 12 }
  } = options;

  const natW = imgLayout.naturalWidth || stageW;
  const natH = imgLayout.naturalHeight || stageH;
  const scale = imgLayout.scale || Math.min(stageW / natW, stageH / natH);
  const imgLeft = imgLayout.imgLeft !== undefined ? imgLayout.imgLeft : (stageW - natW * scale) / 2;
  const imgTop = imgLayout.imgTop !== undefined ? imgLayout.imgTop : (stageH - natH * scale) / 2;

  const [bx, by, bw, bh] = getBoxCoords(bubble);
  const bStageX = imgLeft + bx * scale;
  const bStageY = imgTop + by * scale;
  const bStageW = bw * scale;
  const bStageH = bh * scale;
  const bCenterY = bStageY + bStageH / 2;
  const bCenterX = bStageX + bStageW / 2;

  const minX = margins.left !== undefined ? margins.left : 12;
  const maxX = Math.max(minX, stageW - overlayW - (margins.right !== undefined ? margins.right : 12));
  const minY = margins.top !== undefined ? margins.top : 60;
  const maxY = Math.max(minY, stageH - overlayH - (margins.bottom !== undefined ? margins.bottom : 80));

  // Fallback for orphan bubbles (no parent panel detected)
  if (!parentPanel) {
    const targetX = Math.max(minX, Math.min(maxX, (stageW - overlayW) / 2));
    const targetY = bCenterY < stageH / 2 ? maxY : minY;
    return { targetX: Math.round(targetX), targetY: Math.round(targetY), panelKey: null };
  }

  const [px, py, pw, ph] = getBoxCoords(parentPanel);
  const panelKey = `${Math.round(px)},${Math.round(py)},${Math.round(pw)},${Math.round(ph)}`;
  const pStageX = imgLeft + px * scale;
  const pStageY = imgTop + py * scale;
  const pStageW = pw * scale;
  const pStageH = ph * scale;

  const panelBoxOnStage = [pStageX, pStageY, pStageW, pStageH];
  const bubbleBoxOnStage = [bStageX, bStageY, bStageW, bStageH];

  const centerX = (stageW - overlayW) / 2;

  // Candidates for collision evasion
  const candidates = [];

  // 1. Below panel
  candidates.push({
    name: 'below',
    x: centerX,
    y: pStageY + pStageH + 12
  });

  // 2. Above panel
  candidates.push({
    name: 'above',
    x: centerX,
    y: pStageY - overlayH - 12
  });

  // 3. Right of panel (side escape for tall panels)
  candidates.push({
    name: 'right',
    x: pStageX + pStageW + 16,
    y: pStageY + (pStageH - overlayH) / 2
  });

  // 4. Left of panel (side escape for tall panels)
  candidates.push({
    name: 'left',
    x: pStageX - overlayW - 16,
    y: pStageY + (pStageH - overlayH) / 2
  });

  // 5. Opposite quadrant (for full-page splash panels)
  const oppX = bCenterX < stageW / 2 ? maxX : minX;
  const oppY = bCenterY < stageH / 2 ? maxY : minY;
  candidates.push({
    name: 'opposite-corner',
    x: oppX,
    y: oppY
  });

  let best = null;
  let minCost = Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const cx = Math.max(minX, Math.min(maxX, cand.x));
    const cy = Math.max(minY, Math.min(maxY, cand.y));
    const candBox = [cx, cy, overlayW, overlayH];

    // Penalty 1: Bubble overlap — NEVER cover the clicked bubble!
    const bubbleOverlap = getIntersectionArea(candBox, bubbleBoxOnStage);
    const bubblePenalty = bubbleOverlap > 0 ? 10000000 + bubbleOverlap * 1000 : 0;

    // Penalty 2: Panel overlap
    const panelOverlap = getIntersectionArea(candBox, panelBoxOnStage);
    const panelPenalty = panelOverlap;

    const candCenterX = cx + overlayW / 2;
    const candCenterY = cy + overlayH / 2;
    const distFromBubble = Math.hypot(candCenterX - bCenterX, candCenterY - bCenterY);

    // Penalty 3: Stability preference if last placement was in same panel
    let stabilityBonus = 0;
    if (lastPlacement && lastPlacement.panelKey === panelKey) {
      const dist = Math.hypot(cx - lastPlacement.targetX, cy - lastPlacement.targetY);
      if (dist < 30) {
        stabilityBonus = -8000;
      }
    }

    let totalCost = bubblePenalty + panelPenalty + stabilityBonus;

    if (panelOverlap === 0 && bubbleOverlap === 0) {
      // Clean clearance outside panel: prefer proximity to the panel and screen center
      const pCenterY = pStageY + pStageH / 2;
      const distToPanel = Math.abs(candCenterY - pCenterY);
      const centerDist = Math.abs(cx - centerX);
      totalCost += (distToPanel * 0.2) + (centerDist * 0.1);
    } else {
      // Overlap is unavoidable (e.g. giant splash panel): maximize distance from bubble
      totalCost -= (distFromBubble * 0.5);
    }

    if (totalCost < minCost) {
      minCost = totalCost;
      best = { targetX: Math.round(cx), targetY: Math.round(cy), panelKey };
    }
  }

  return best || {
    targetX: Math.round(Math.max(minX, Math.min(maxX, centerX))),
    targetY: Math.round(bCenterY < stageH / 2 ? maxY : minY),
    panelKey
  };
}

// Attach to state.GuidedView and window.GuidedView
state.GuidedView = state.GuidedView || {};
Object.assign(state.GuidedView, {
  findParentPanel,
  getPagePanels,
  computeSmartBubblePlacement
});

if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
  Object.assign(window.GuidedView, {
    findParentPanel,
    getPagePanels,
    computeSmartBubblePlacement
  });
}
