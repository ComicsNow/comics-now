// ONNX panel detector for Guided Reader.
// Loads YOLOv8 ONNX models lazily, runs inference per page, applies NMS,
// and writes a `guided_view` JSON sidecar matching the historical schema.

const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');
const sharp = require('sharp');
const { listPages, getEntryBuffer } = require('./archive-utils');

const { ROOT_DIR } = require('../constants');
const { guidedLog, guidedLogUpdate, log } = require('../logger');

const MODELS_DIR = path.join(ROOT_DIR, 'models');
const MODEL_PATHS = {
  manga: path.join(MODELS_DIR, 'manga', 'manga.onnx'),
  western: path.join(MODELS_DIR, 'manga', 'manga.onnx'),
  bubble: path.join(MODELS_DIR, 'bubble', 'speech_bubble_detector.onnx')
};

const GUIDED_VIEW_DIR = path.join(ROOT_DIR, 'metadata', 'guided_view');
const INPUT_SIZE = 640;

// Production Defaults from v2.1
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

      // Use v2.1 scan range
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


const sessions = {};
const sessionPromises = {};

async function getSession(type) {
  if (sessions[type]) return sessions[type];
  if (sessionPromises[type]) return sessionPromises[type];

  let modelPath = MODEL_PATHS[type];
  if (!modelPath || !fs.existsSync(modelPath)) {
    if (type === 'western' && fs.existsSync(MODEL_PATHS.manga)) {
      log('WARN', 'GUIDED', `Western model missing at ${modelPath}; falling back to manga model.`);
      modelPath = MODEL_PATHS.manga;
    } else {
      throw new Error("Model file missing for type \"" + type + "\": " + modelPath);
    }
  }

  sessionPromises[type] = ort.InferenceSession.create(modelPath, { intraOpNumThreads: 2, interOpNumThreads: 2 })
    .then(session => {
      sessions[type] = session;
      sessionPromises[type] = null;
      log('INFO', 'GUIDED', "Loaded " + type + " model: " + path.basename(modelPath));
      return session;
    })
    .catch(err => {
      sessionPromises[type] = null;
      throw err;
    });
  return sessionPromises[type];
}

async function extractPageBuffer(comicPath, pageName) {
  return await getEntryBuffer(comicPath, pageName);
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

async function detectPanels(buffer, typeOrIsManga, confThreshold = null, filterCls = null) {
  try {
    const type = typeof typeOrIsManga === 'boolean' ? (typeOrIsManga ? 'manga' : 'western') : typeOrIsManga;
    const session = await getSession(type);
    const image = sharp(buffer).removeAlpha();
    const meta = await image.metadata();

    // v2.1 uses 'contain' for panels to preserve aspect ratio
    const fit = type === 'manga' ? 'contain' : 'fill';
    const resizeOptions = { fit };
    if (fit === 'contain') resizeOptions.background = { r: 0, g: 0, b: 0 };
    
    const inputImg = await image.resize(INPUT_SIZE, INPUT_SIZE, resizeOptions).raw().toBuffer();
    const px = INPUT_SIZE * INPUT_SIZE;
    const float32Data = new Float32Array(3 * px);
    for (let i = 0; i < px; i++) {
      float32Data[i] = inputImg[i * 3] / 255.0;
      float32Data[px + i] = inputImg[i * 3 + 1] / 255.0;
      float32Data[2 * px + i] = inputImg[i * 3 + 2] / 255.0;
    }

    const tensor = new ort.Tensor('float32', float32Data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const results = await session.run({ images: tensor });
    const output = results.output0;
    const data = output.data;
    const dims = output.dims;

    let scaleX, scaleY, padX = 0, padY = 0;
    if (fit === 'fill') {
      scaleX = meta.width / INPUT_SIZE; scaleY = meta.height / INPUT_SIZE;
    } else {
      const scale = Math.max(meta.width, meta.height) / INPUT_SIZE;
      scaleX = scale; scaleY = scale;
      padX = (INPUT_SIZE * scale - meta.width) / 2; padY = (INPUT_SIZE * scale - meta.height) / 2;
    }

    let boxes = [];
    const threshold = confThreshold || (type === 'western' ? DEFAULTS.WESTERN_CONF : DEFAULTS.CONF_THRESHOLD);

    if (dims[2] === 6) {
      const numBoxes = dims[1];
      for (let i = 0; i < numBoxes; i++) {
        const o = i * 6;
        const conf = data[o + 4];
        const cls = Math.round(data[o + 5]);
        if (conf <= threshold) continue;
        if (filterCls !== null && filterCls !== undefined && cls !== filterCls) continue;

        const x1 = (data[o + 0] * scaleX) - padX;
        const y1 = (data[o + 1] * scaleY) - padY;
        const x2 = (data[o + 2] * scaleX) - padX;
        const y2 = (data[o + 3] * scaleY) - padY;
        const w = x2 - x1, h = y2 - y1;
        if (w > 10 && h > 10) boxes.push({ x: x1, y: y1, w, h, conf });
      }
    } else if (dims[1] >= 5 && dims[2] === 8400) {
      const N = 8400;
      const xData = data.subarray(0, N), yData = data.subarray(N, 2 * N);
      const wData = data.subarray(2 * N, 3 * N), hData = data.subarray(3 * N, 4 * N);
      const confData = data.subarray(4 * N, 5 * N);
      const clsData = dims[1] >= 6 ? data.subarray(5 * N, 6 * N) : null;
      for (let i = 0; i < N; i++) {
        if (clsData && filterCls !== null && filterCls !== undefined) {
          const c0 = confData[i], c1 = clsData[i];
          const cls = c0 >= c1 ? 0 : 1;
          if (cls !== filterCls) continue;
          const conf = Math.max(c0, c1);
          if (conf <= threshold) continue;
          const w = wData[i] * scaleX, h = hData[i] * scaleY;
          const cx = xData[i] * scaleX - padX, cy = yData[i] * scaleY - padY;
          boxes.push({ x: cx - w/2, y: cy - h/2, w, h, conf });
          continue;
        }
        if (confData[i] <= threshold) continue;
        const w = wData[i] * scaleX, h = hData[i] * scaleY;
        const cx = xData[i] * scaleX - padX, cy = yData[i] * scaleY - padY;
        boxes.push({ x: cx - w/2, y: cy - h/2, w, h, conf: confData[i] });
      }
    }

    boxes = nms(boxes, DEFAULTS.IOU_THRESHOLD);
    if (type === 'manga' && filterCls !== 1) await includeBelowText(boxes, buffer, meta);

    const pageArea = meta.width * meta.height;
    if (boxes.length > 1) {
      boxes = boxes.filter(b => (b.w * b.h) / pageArea < 0.98);
    }

    if (boxes.length === 0) return filterCls === 1 ? [] : [[0, 0, meta.width, meta.height]];
    return boxes.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]);
  } catch (err) {
    console.error('detectPanels error:', err);
    throw err;
  }
}

const XY_CUT_OVERLAP_RATIO = 0.08;

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

async function detectBubbles(buffer, type = 'western', confThreshold = null) {
  try {
    if (type === 'manga') {
      const threshold = confThreshold !== null && confThreshold !== undefined ? confThreshold : 0.1;
      const rawBoxes = await detectPanels(buffer, 'manga', threshold, 1);
      return sortReadingOrder(rawBoxes, 'manga');
    }

    const session = await getSession('bubble');
    const image = sharp(buffer).removeAlpha();
    const meta = await image.metadata();
    const inputImg = await image.resize(INPUT_SIZE, INPUT_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0 } }).raw().toBuffer();

    const px = INPUT_SIZE * INPUT_SIZE;
    const float32Data = new Float32Array(3 * px);
    for (let i = 0; i < px; i++) {
      float32Data[i] = inputImg[i * 3] / 255.0;
      float32Data[px + i] = inputImg[i * 3 + 1] / 255.0;
      float32Data[2 * px + i] = inputImg[i * 3 + 2] / 255.0;
    }

    const tensor = new ort.Tensor('float32', float32Data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const results = await session.run({ images: tensor });
    const data = results.output0.data, N = 8400;
    const scale = Math.max(meta.width, meta.height) / INPUT_SIZE;
    const padX = (INPUT_SIZE * scale - meta.width) / 2, padY = (INPUT_SIZE * scale - meta.height) / 2;

    const threshold = confThreshold !== null && confThreshold !== undefined ? confThreshold : 0.25;
    let boxes = [];
    const c0 = data.subarray(4 * N, 5 * N);
    const xd = data.subarray(0, N), yd = data.subarray(N, 2 * N), wd = data.subarray(2 * N, 3 * N), hd = data.subarray(3 * N, 4 * N);

    for (let i = 0; i < N; i++) {
      const conf = c0[i];
      if (conf > threshold) {
        const w = wd[i] * scale, h = hd[i] * scale;
        const cx = xd[i] * scale - padX, cy = yd[i] * scale - padY;
        boxes.push({ x: cx - w/2, y: cy - h/2, w, h, conf });
      }
    }

    const kept = nms(boxes, 0.4);
    const tightened = [];
    for (const b of kept) {
      const rawBox = [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)];
      tightened.push(await tightenBubbleToText(buffer, rawBox, meta));
    }
    return sortReadingOrder(tightened, 'western');
  } catch (err) {
    console.error('detectBubbles error:', err);
    return [];
  }
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

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

async function processComic(id, comicPath, type, opts = {}) {
  const isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : () => false;
  let pages = await listPages(comicPath);
  if (!pages || pages.length === 0) throw new Error('No pages found');
  if (opts.maxPages && pages.length > opts.maxPages) pages = pages.slice(0, opts.maxPages);

  await fs.promises.mkdir(GUIDED_VIEW_DIR, { recursive: true });
  const result = { comicId: id, type, pages: {} };
  let totalPanels = 0, pagesProcessed = 0;

  for (const pageName of pages) {
    if (isCancelled()) throw new Error('Cancelled');
    try {
      if (pagesProcessed % 10 === 0) guidedLogUpdate('processing-pages:' + id, 'INFO', '   ... processing page ' + pagesProcessed + '/' + pages.length);
      const buffer = await withTimeout(
        extractPageBuffer(comicPath, pageName),
        30000,
        `Page extraction timed out for ${pageName}`
      );
      const rawPanels = (type === 'manga') ? await detectPanels(buffer, 'manga', 0.1, 0) : await detectPanels(buffer, 'western', 0.5, 0);
      const panels = sortReadingOrder(rawPanels, type);
      const bubbles = await detectBubbles(buffer, type);
      let sequence = (type === 'manga') ? buildMangaSequence(rawPanels, bubbles) : buildHybridWesternSequence(panels, bubbles);
      result.pages[pageName] = { panels, bubbles, sequence: sequence.length > 0 ? sequence : panels };
      totalPanels += panels.length;
      pagesProcessed++;
    } catch (err) {
      result.pages[pageName] = { panels: [], bubbles: [], sequence: [] };
      guidedLog('WARN', '   page failed: ' + pageName + ' — ' + err.message);
    }
  }
  await fs.promises.writeFile(path.join(GUIDED_VIEW_DIR, id + '.json'), JSON.stringify(result, null, 2));
  return { panels: totalPanels, pagesProcessed, pageCount: pages.length, outputPath: path.join(GUIDED_VIEW_DIR, id + '.json') };
}

module.exports = {
  processComic,
  extractPageBuffer,
  listPages,
  detectPanels,
  detectBubbles,
  sortReadingOrder,
  buildMangaSequence,
  buildHybridWesternSequence,
  GUIDED_VIEW_DIR
};
