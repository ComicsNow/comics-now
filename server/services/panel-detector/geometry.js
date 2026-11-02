const sharp = require('sharp');

const XY_CUT_OVERLAP_RATIO = 0.08;

const DEFAULTS = {
  CONF_THRESHOLD: 0.1,    // Manga Panels
  WESTERN_CONF: 0.15,     // Aggressive Western Detection
  BUBBLE_CONF: 0.1,       // Lowered for fine print / gutter notes
  IOU_THRESHOLD: 0.15,    // Prevent Panel Fusion
  SCAN_BELOW_PX: 80,      // Increased to swallow reference notes into panels
  SCAN_BELOW_THRESHOLD: 190 // More sensitive for fine print
};

/**
 * Scans for ink below a panel to include translation notes or gutter text.
 */
async function includeBelowText(boxes, buffer, meta) {
  try {
    const { data, info } = await sharp(buffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const { width, height } = info;

    for (const b of boxes) {
      let scanY = Math.floor(b.y + b.h);
      let furthestInkY = scanY;
      let foundAnyInk = false;

      const maxScan = Math.min(height, scanY + DEFAULTS.SCAN_BELOW_PX);
      for (let y = scanY; y < maxScan; y++) {
        let rowHasInk = false;
        const xStart = Math.floor(b.x + b.w * 0.1);
        const xEnd = Math.floor(b.x + b.w * 0.9);
        
        for (let x = xStart; x < xEnd; x++) {
          if (data[y * width + x] < DEFAULTS.SCAN_BELOW_THRESHOLD) { 
            rowHasInk = true;
            break;
          }
        }

        if (rowHasInk) {
          furthestInkY = y + 2; 
          foundAnyInk = true;
        } else {
          if (foundAnyInk && y > furthestInkY + 4) break; 
          if (!foundAnyInk && y > scanY + 5) break;
        }
      }
      
      if (foundAnyInk) {
        b.h = Math.min(height - b.y, furthestInkY - b.y);
      }
    }
  } catch (err) {
    console.error('      [includeBelowText] Error:', err.message);
  }
}

function iou(a, b) {
  const xA = Math.max(a.x, b.x);
  const yA = Math.max(a.y, b.y);
  const xB = Math.min(a.x + a.w, b.x + b.w);
  const yB = Math.min(a.y + a.h, b.y + b.h);
  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const union = a.w * a.h + b.w * b.h - interArea;
  return union <= 0 ? 0 : interArea / union;
}

function nms(boxes, iouThresh) {
  boxes.sort((a, b) => b.conf - a.conf);
  const kept = [];
  while (boxes.length > 0) {
    const top = boxes.shift();
    kept.push(top);
    boxes = boxes.filter(b => iou(top, b) < iouThresh);
  }
  return kept;
}

function computePolygonCentroid(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < poly.length; i++) {
    sx += Number(poly[i][0]) || 0;
    sy += Number(poly[i][1]) || 0;
  }
  return { cx: sx / poly.length, cy: sy / poly.length };
}

function normalizeBoxItem(item, index) {
  const poly = (item && Array.isArray(item.polygon) && item.polygon.length >= 3)
    ? item.polygon
    : (item && item.raw && Array.isArray(item.raw.polygon) && item.raw.polygon.length >= 3 ? item.raw.polygon : null);
  const centroid = computePolygonCentroid(poly);

  if (Array.isArray(item)) {
    return {
      x: Number(item[0]) || 0,
      y: Number(item[1]) || 0,
      w: Number(item[2]) || 0,
      h: Number(item[3]) || 0,
      polyX: centroid ? centroid.cx : null,
      polyY: centroid ? centroid.cy : null,
      raw: item,
      index
    };
  }
  if (item && typeof item === 'object') {
    if (typeof item.x === 'number' && typeof item.y === 'number') {
      return {
        x: item.x,
        y: item.y,
        w: Number(item.w) || 0,
        h: Number(item.h) || 0,
        polyX: centroid ? centroid.cx : null,
        polyY: centroid ? centroid.cy : null,
        raw: item,
        index
      };
    }
    if (Array.isArray(item.raw)) {
      return {
        x: Number(item.raw[0]) || 0,
        y: Number(item.raw[1]) || 0,
        w: Number(item.raw[2]) || 0,
        h: Number(item.raw[3]) || 0,
        polyX: centroid ? centroid.cx : null,
        polyY: centroid ? centroid.cy : null,
        raw: item,
        index
      };
    }
    if (item[0] !== undefined && item[1] !== undefined) {
      return {
        x: Number(item[0]) || 0,
        y: Number(item[1]) || 0,
        w: Number(item[2]) || 0,
        h: Number(item[3]) || 0,
        polyX: centroid ? centroid.cx : null,
        polyY: centroid ? centroid.cy : null,
        raw: item,
        index
      };
    }
  }
  return { x: 0, y: 0, w: 0, h: 0, polyX: null, polyY: null, raw: item, index };
}

function intersectionOverArea(boxA, boxB) {
  const [ax, ay, aw, ah] = Array.isArray(boxA) ? boxA : [boxA.x, boxA.y, boxA.w, boxA.h];
  const [bx, by, bw, bh] = Array.isArray(boxB) ? boxB : [boxB.x, boxB.y, boxB.w, boxB.h];
  const xI = Math.max(ax, bx), yI = Math.max(ay, by);
  const wI = Math.min(ax + aw, bx + bw) - xI, hI = Math.min(ay + ah, by + bh) - yI;
  if (wI <= 0 || hI <= 0) return 0;
  return (wI * hI) / (aw * ah);
}

async function tightenBubbleToText(fullImageBuffer, box, meta) {
  let [bx, by, bw, bh] = box;
  bx = Math.max(0, Math.min(meta.width - 1, bx));
  by = Math.max(0, Math.min(meta.height - 1, by));
  bw = Math.min(meta.width - bx, bw);
  bh = Math.min(meta.height - by, bh);
  if (bw < 20 || bh < 20) return box;

  try {
    const { data, info } = await sharp(fullImageBuffer)
      .extract({ left: Math.round(bx), top: Math.round(by), width: Math.round(bw), height: Math.round(bh) })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const meanVal = sum / data.length;
    const isLight = meanVal >= 130;
    const thresh = isLight ? (meanVal - 35) : (meanVal + 35);

    const marginX = Math.max(4, Math.floor(width * 0.10));
    const marginY = Math.max(4, Math.floor(height * 0.10));

    const rowCounts = new Int32Array(height);
    const colCounts = new Int32Array(width);

    for (let y = marginY; y < height - marginY; y++) {
      const rowOff = y * width;
      for (let x = marginX; x < width - marginX; x++) {
        const v = data[rowOff + x];
        const isDark = isLight ? (v < thresh) : (v > thresh);
        if (isDark) {
          rowCounts[y]++;
          colCounts[x]++;
        }
      }
    }

    const maxRow = width * 0.45;
    const maxCol = height * 0.45;

    let minX = width, maxX = 0, minY = height, maxY = 0;
    let textPixels = 0;

    for (let y = marginY; y < height - marginY; y++) {
      if (rowCounts[y] > 0 && rowCounts[y] <= maxRow) {
        const rowOff = y * width;
        for (let x = marginX; x < width - marginX; x++) {
          if (colCounts[x] > 0 && colCounts[x] <= maxCol) {
            const v = data[rowOff + x];
            const isDark = isLight ? (v < thresh) : (v > thresh);
            if (isDark) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              textPixels++;
            }
          }
        }
      }
    }

    if (textPixels < 15) {
      const iw = Math.round(bw * 0.80);
      const ih = Math.round(bh * 0.70);
      const ix = bx + Math.round((bw - iw) / 2);
      const iy = by + Math.round((bh - ih) / 2);
      return [ix, iy, iw, ih];
    }

    const padX = 10;
    const padY = 8;
    const resX = Math.max(0, bx + minX - padX);
    const resY = Math.max(0, by + minY - padY);
    const resW = Math.min(meta.width - resX, (maxX - minX) + 2 * padX);
    const resH = Math.min(meta.height - resY, (maxY - minY) + 2 * padY);

    return [Math.round(resX), Math.round(resY), Math.round(resW), Math.round(resH)];
  } catch (err) {
    return box;
  }
}

function isBubbleInPanel(bubble, panel, gutterTolerance = 80) {
  const [bx, by, bw, bh] = Array.isArray(bubble) ? bubble : [bubble.x, bubble.y, bubble.w, bubble.h];
  const [px, py, pw, ph] = Array.isArray(panel) ? panel : [panel.x, panel.y, panel.w, panel.h];
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  // 1. Standard containment
  if (cx >= px && cx <= px + pw && cy >= py && cy <= py + ph) return true;

  // 2. Gutter tolerance above panel (e.g. caption boxes attached to or straddling the top border)
  const inGutterAbove = (by + bh >= py - 10) && (by <= py + 30) && (cx >= px && cx <= px + pw);
  if (inGutterAbove) return true;

  // 3. General expanded Y tolerance within horizontal bounds
  if (cy >= py - gutterTolerance && cy <= py + ph && cx >= px && cx <= px + pw) return true;

  return false;
}

module.exports = {
  XY_CUT_OVERLAP_RATIO,
  DEFAULTS,
  includeBelowText,
  iou,
  nms,
  computePolygonCentroid,
  normalizeBoxItem,
  intersectionOverArea,
  tightenBubbleToText,
  isBubbleInPanel
};
