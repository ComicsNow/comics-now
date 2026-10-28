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
  western: path.join(MODELS_DIR, 'western', 'western.onnx'),
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

function rdpSimplify(points, epsilon) {
  if (!Array.isArray(points) || points.length <= 3) return points;
  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lenSq = dx * dx + dy * dy;

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    let dist;
    if (lenSq === 0) {
      dist = Math.hypot(p[0] - start[0], p[1] - start[1]);
    } else {
      const t = Math.max(0, Math.min(1, ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / lenSq));
      const projX = start[0] + t * dx;
      const projY = start[1] + t * dy;
      dist = Math.hypot(p[0] - projX, p[1] - projY);
    }
    if (dist > maxDist) {
      index = i;
      maxDist = dist;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, index + 1), epsilon);
    const right = rdpSimplify(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

function extractPolygonFromProtoMask(coeffs, protoData, protoDims, box, transform) {
  if (!coeffs || !protoData || !Array.isArray(protoDims) || protoDims.length < 4) return null;
  const numProtos = protoDims[1];
  const protoH = protoDims[2];
  const protoW = protoDims[3];
  const { scaleX, scaleY, padX = 0, padY = 0, width, height } = transform;

  const inX1 = (box.x + padX) / scaleX;
  const inY1 = (box.y + padY) / scaleY;
  const inX2 = (box.x + box.w + padX) / scaleX;
  const inY2 = (box.y + box.h + padY) / scaleY;

  const px1 = Math.max(0, Math.floor(inX1 * (protoW / INPUT_SIZE)));
  const py1 = Math.max(0, Math.floor(inY1 * (protoH / INPUT_SIZE)));
  const px2 = Math.min(protoW - 1, Math.ceil(inX2 * (protoW / INPUT_SIZE)));
  const py2 = Math.min(protoH - 1, Math.ceil(inY2 * (protoH / INPUT_SIZE)));

  if (px2 <= px1 || py2 <= py1) return null;

  const leftEdge = [];
  const rightEdge = [];
  const planeSize = protoH * protoW;

  for (let py = py1; py <= py2; py++) {
    let rowMinX = -1;
    let rowMaxX = -1;
    const rowOffset = py * protoW;
    for (let px = px1; px <= px2; px++) {
      let logit = 0;
      const idx = rowOffset + px;
      for (let c = 0; c < numProtos; c++) {
        logit += coeffs[c] * protoData[c * planeSize + idx];
      }
      if (logit > 0) {
        if (rowMinX === -1) rowMinX = px;
        rowMaxX = px;
      }
    }
    if (rowMinX !== -1) {
      const toOrigX = (px) => Math.max(0, Math.min(width, Math.round(((px + 0.5) * (INPUT_SIZE / protoW)) * scaleX - padX)));
      const toOrigY = (pyVal) => Math.max(0, Math.min(height, Math.round(((pyVal + 0.5) * (INPUT_SIZE / protoH)) * scaleY - padY)));
      const oy = toOrigY(py);
      leftEdge.push([toOrigX(rowMinX), oy]);
      rightEdge.push([toOrigX(rowMaxX), oy]);
    }
  }

  if (leftEdge.length < 2) return null;
  const rawContour = [...leftEdge, ...rightEdge.reverse()];
  const epsilon = Math.max(3, Math.hypot(box.w, box.h) * 0.025);
  const simplified = rdpSimplify(rawContour, epsilon);
  return simplified.length >= 3 ? simplified : rawContour.slice(0, 4);
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
    const protoOutput = results.output1 || null;
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

    if (dims[1] === 300 && (dims[2] === 6 || dims[2] === 38)) {
      const stride = dims[2];
      const hasMask = stride === 38 && protoOutput;
      for (let i = 0; i < 300; i++) {
        const o = i * stride;
        const conf = data[o + 4];
        const cls = data[o + 5];
        if (conf <= threshold) continue;
        if (filterCls !== null && cls !== filterCls) continue;

        const x1 = (data[o + 0] * scaleX) - padX;
        const y1 = (data[o + 1] * scaleY) - padY;
        const x2 = (data[o + 2] * scaleX) - padX;
        const y2 = (data[o + 3] * scaleY) - padY;
        const w = x2 - x1, h = y2 - y1;
        if (w > 10 && h > 10) {
          const coeffs = hasMask ? data.subarray(o + 6, o + 38) : null;
          boxes.push({ x: x1, y: y1, w, h, conf, coeffs });
        }
      }
    } else if ((dims[1] === 5 || dims[1] >= 37) && dims[2] === 8400) {
      const N = 8400;
      const totalCh = dims[1];
      const hasMask = totalCh >= 37 && protoOutput;
      const maskStartCh = totalCh - 32;
      const xData = data.subarray(0, N), yData = data.subarray(N, 2 * N);
      const wData = data.subarray(2 * N, 3 * N), hData = data.subarray(3 * N, 4 * N);
      const confData = data.subarray(4 * N, 5 * N);
      for (let i = 0; i < N; i++) {
        if (confData[i] <= threshold) continue;
        const w = wData[i] * scaleX, h = hData[i] * scaleY;
        const cx = xData[i] * scaleX - padX, cy = yData[i] * scaleY - padY;
        let coeffs = null;
        if (hasMask) {
          coeffs = new Float32Array(32);
          for (let c = 0; c < 32; c++) {
            coeffs[c] = data[(maskStartCh + c) * N + i];
          }
        }
        boxes.push({ x: cx - w/2, y: cy - h/2, w, h, conf: confData[i], coeffs });
      }
    }

    boxes = nms(boxes, DEFAULTS.IOU_THRESHOLD);
    if (type === 'manga') await includeBelowText(boxes, buffer, meta);

    const pageArea = meta.width * meta.height;
    if (boxes.length > 1) {
      boxes = boxes.filter(b => (b.w * b.h) / pageArea < 0.98);
    }

    if (boxes.length === 0) return [[0, 0, meta.width, meta.height]];
    return boxes.map(b => {
      const arr = [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)];
      if (b.coeffs && protoOutput) {
        const poly = extractPolygonFromProtoMask(
          b.coeffs,
          protoOutput.data,
          protoOutput.dims,
          b,
          { scaleX, scaleY, padX, padY, width: meta.width, height: meta.height }
        );
        if (poly && poly.length >= 3) {
          arr.polygon = poly;
        }
      }
      return arr;
    });
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

async function detectBubbles(buffer, type = 'western') {
  try {
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

    let boxes = [];
    const c0 = data.subarray(4 * N, 5 * N), c1 = data.subarray(5 * N, 6 * N);
    const xd = data.subarray(0, N), yd = data.subarray(N, 2 * N), wd = data.subarray(2 * N, 3 * N), hd = data.subarray(3 * N, 4 * N);
    
    for (let i = 0; i < N; i++) {
      const conf = Math.max(c0[i], c1[i]);
      if (conf > DEFAULTS.BUBBLE_CONF) {
        const w = wd[i] * scale, h = hd[i] * scale;
        const cx = xd[i] * scale - padX, cy = yd[i] * scale - padY;
        // 10% padding
        const pw = w * 1.1, ph = h * 1.1;
        boxes.push({ x: cx - pw/2, y: cy - ph/2, w: pw, h: ph, conf });
      }
    }
    
    const kept = nms(boxes, 0.4);
    const rawBoxes = kept.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]);
    return sortReadingOrder(rawBoxes, type);
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
    panelObjects.push({ ...panel, isPanel: true, bubbles: sortedBubbles });
  }

  const orphans = [];
  for (let i = 0; i < allBubbles.length; i++) {
    if (!assigned.has(i)) orphans.push({ ...allBubbles[i], isBubble: true });
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

function isBubbleInPanel(bubble, panel) {
  const [bx, by, bw, bh] = Array.isArray(bubble) ? bubble : [bubble.x, bubble.y, bubble.w, bubble.h];
  const [px, py, pw, ph] = Array.isArray(panel) ? panel : [panel.x, panel.y, panel.w, panel.h];
  const cx = bx + bw/2, cy = by + bh/2;
  return cx >= px && cx <= px + pw && cy >= py && cy <= py + ph;
}

function buildHybridWesternSequence(panels, bubbles) {
  if (!bubbles || bubbles.length === 0) return [];
  // For Western comics, dialogue guided-view follows speech bubbles directly in their
  // natural reading order without routing or scrambling through panels.
  return sortReadingOrder(bubbles, 'western');
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
      const rawPanels = (type === 'manga') ? await detectPanels(buffer, 'manga', 0.1) : await detectPanels(buffer, 'manga', 0.5, 0);
      const panels = sortReadingOrder(rawPanels, type);
      const bubbles = await detectBubbles(buffer, type);
      let sequence = (type === 'manga') ? buildMangaSequence(rawPanels, bubbles) : buildHybridWesternSequence(panels, bubbles);
      const polygons = {};
      for (const p of panels) {
        if (Array.isArray(p.polygon) && p.polygon.length >= 3) {
          polygons[`${p[0]},${p[1]},${p[2]},${p[3]}`] = p.polygon;
        }
      }
      const pageEntry = { panels, bubbles, sequence: sequence.length > 0 ? sequence : panels };
      if (Object.keys(polygons).length > 0) {
        pageEntry.polygons = polygons;
      }
      result.pages[pageName] = pageEntry;
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
  GUIDED_VIEW_DIR,
  sortReadingOrder,
  buildMangaSequence,
  buildHybridWesternSequence,
  extractPolygonFromProtoMask
};
