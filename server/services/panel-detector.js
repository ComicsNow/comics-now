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

/**
 * Adds a percentage-based safety margin.
 */
function applyPadding(boxes, meta, paddingPercent = 0.02) {
  const padW = meta.width * paddingPercent;
  const padH = meta.height * paddingPercent;
  
  return boxes.map(b => ({
    x: Math.max(0, b.x - padW),
    y: Math.max(0, b.y - padH),
    w: Math.min(meta.width - Math.max(0, b.x - padW), b.w + padW * 2),
    h: Math.min(meta.height - Math.max(0, b.y - padH), b.h + padH * 2),
    conf: b.conf
  }));
}

const sessions = {};
const sessionPromises = {};

async function getSession(type) {
  if (sessions[type]) return sessions[type];
  if (sessionPromises[type]) return sessionPromises[type];

  const modelPath = MODEL_PATHS[type];
  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error("Model file missing for type \"" + type + "\": " + modelPath);
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

    if (dims[1] === 300 && dims[2] === 6) {
      for (let i = 0; i < 300; i++) {
        const o = i * 6;
        const conf = data[o + 4];
        const cls = data[o + 5];
        if (conf <= threshold) continue;
        if (filterCls !== null && cls !== filterCls) continue;

        const x1 = (data[o + 0] * scaleX) - padX;
        const y1 = (data[o + 1] * scaleY) - padY;
        const x2 = (data[o + 2] * scaleX) - padX;
        const y2 = (data[o + 3] * scaleY) - padY;
        const w = x2 - x1, h = y2 - y1;
        if (w > 10 && h > 10) boxes.push({ x: x1, y: y1, w, h, conf });
      }
    } else if (dims[1] === 5 && dims[2] === 8400) {
      const N = 8400;
      const xData = data.subarray(0, N), yData = data.subarray(N, 2 * N);
      const wData = data.subarray(2 * N, 3 * N), hData = data.subarray(3 * N, 4 * N);
      const confData = data.subarray(4 * N, 5 * N);
      for (let i = 0; i < N; i++) {
        if (confData[i] <= threshold) continue;
        const w = wData[i] * scaleX, h = hData[i] * scaleY;
        const cx = xData[i] * scaleX - padX, cy = yData[i] * scaleY - padY;
        boxes.push({ x: cx - w/2, y: cy - h/2, w, h, conf: confData[i] });
      }
    }

    boxes = nms(boxes, DEFAULTS.IOU_THRESHOLD);
    if (type === 'manga') await includeBelowText(boxes, buffer, meta);

    const pageArea = meta.width * meta.height;
    if (boxes.length > 1) {
      boxes = boxes.filter(b => (b.w * b.h) / pageArea < 0.98);
    }

    if (boxes.length === 0) return [[0, 0, meta.width, meta.height]];
    return boxes.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]);
  } catch (err) {
    console.error('detectPanels error:', err);
    throw err;
  }
}

function sortReadingOrder(items, type) {
  if (!items || items.length === 0) return items;
  const boxes = items.map(p => Array.isArray(p) ? { x: p[0], y: p[1], w: p[2], h: p[3], raw: p } : { ...p, raw: p });
  
  if (type === 'manga') {
    // v2.1 Weighted Sort logic
    boxes.sort((a, b) => {
      const scoreA = (a.y * 1.5) - (a.x + a.w);
      const scoreB = (b.y * 1.5) - (b.x + b.w);
      return scoreA - scoreB;
    });
  } else {
    // Western Z-pattern
    boxes.sort((a, b) => {
      const scoreA = (a.y * 5.0) + a.x;
      const scoreB = (b.y * 5.0) + b.x;
      return scoreA - scoreB;
    });
  }
  return boxes.map(b => b.raw);
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

function buildMangaSequence(allBoxes) {
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
  if (!panels || panels.length === 0) return sortReadingOrder(bubbles, 'western');
  const assigned = new Set(), objects = [];
  const sortedPanels = sortReadingOrder(panels, 'western');

  for (const panel of sortedPanels) {
    const children = [];
    for (let i = 0; i < bubbles.length; i++) {
      if (!assigned.has(i) && (isBubbleInPanel(bubbles[i], panel) || intersectionOverArea(bubbles[i], panel) >= 0.8)) {
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
      const buffer = await extractPageBuffer(comicPath, pageName);
      const rawPanels = (type === 'manga') ? await detectPanels(buffer, 'manga', 0.1) : await detectPanels(buffer, 'manga', 0.5, 0);
      const panels = sortReadingOrder(rawPanels, type);
      const bubbles = type === 'western' ? await detectBubbles(buffer, type) : [];
      let sequence = (type === 'manga') ? buildMangaSequence(rawPanels) : buildHybridWesternSequence(panels, bubbles);
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

module.exports = { processComic, detectPanels, detectBubbles, sortReadingOrder, extractPageBuffer, listPages, GUIDED_VIEW_DIR, MODEL_PATHS };
