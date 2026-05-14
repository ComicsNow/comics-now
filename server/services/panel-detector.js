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
const CONF_THRESHOLD = 0.1;
const IOU_THRESHOLD = 0.4;

/**
 * Scans up to 40 pixels below a panel to see if there is any "writing" (dark pixels).
 * If found, expands the panel height to include it. Helps with translations.
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

      // Scan up to 40 pixels below the panel
      const maxScan = Math.min(height, scanY + 40);
      for (let y = scanY; y < maxScan; y++) {
        let rowHasInk = false;
        // Use the horizontal middle of the panel to avoid edge noise
        const xStart = Math.floor(b.x + b.w * 0.1);
        const xEnd = Math.floor(b.x + b.w * 0.9);
        
        for (let x = xStart; x < xEnd; x++) {
          if (data[y * width + x] < 190) { // Threshold for "ink"
            rowHasInk = true;
            break;
          }
        }

        if (rowHasInk) {
          furthestInkY = y + 2; 
          foundAnyInk = true;
        } else {
          // If we were scanning text and hit whitespace, we're done
          if (foundAnyInk && y > furthestInkY + 4) break; 
          // If we checked 5px of pure whitespace and found nothing, stop
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
 * Adds a percentage-based safety margin to the panels.
 */
function applyPadding(boxes, meta) {
  const padW = meta.width * 0.02; // 2% width padding
  const padH = meta.height * 0.02; // 2% height padding
  
  return boxes.map(b => ({
    x: Math.max(0, b.x - padW),
    y: Math.max(0, b.y - padH),
    w: Math.min(meta.width - Math.max(0, b.x - padW), b.w + padW * 2),
    h: Math.min(meta.height - Math.max(0, b.y - padH), b.h + padH * 2),
    conf: b.conf
  }));
}

const sessions = { manga: null, western: null };
const sessionPromises = { manga: null, western: null };

async function getSession(type) {
  if (sessions[type]) return sessions[type];
  if (sessionPromises[type]) return sessionPromises[type];

  const modelPath = MODEL_PATHS[type];
  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error(`Model file missing for type "${type}": ${modelPath}`);
  }

  const sessionOptions = {
    intraOpNumThreads: 2,
    interOpNumThreads: 2
  };

  sessionPromises[type] = ort.InferenceSession.create(modelPath, sessionOptions)
    .then(session => {
      sessions[type] = session;
      sessionPromises[type] = null;
      log('INFO', 'GUIDED', `Loaded ${type} model: ${path.basename(modelPath)}`);
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

async function detectPanels(buffer, typeOrIsManga, confThreshold = CONF_THRESHOLD, filterCls = null) {
  try {
    const type = typeof typeOrIsManga === 'boolean' 
      ? (typeOrIsManga ? 'manga' : 'western') 
      : typeOrIsManga;

    const session = await getSession(type);
    const image = sharp(buffer).removeAlpha(); // Force 3 channels
    const meta = await image.metadata();

    // Reverting to 'fill' (no padding/letterboxing)
    const inputImg = await image.resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' }).raw().toBuffer();

    const px = INPUT_SIZE * INPUT_SIZE;
    if (inputImg.length !== 3 * px) {
        throw new Error(`Unexpected buffer length: ${inputImg.length}, expected ${3 * px}`);
    }

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

    // Original scaling logic
    const scaleX = meta.width / INPUT_SIZE;
    const scaleY = meta.height / INPUT_SIZE;

    let boxes = [];

    if (dims[1] === 300 && dims[2] === 6) {
      for (let i = 0; i < 300; i++) {
        const o = i * 6;
        const conf = data[o + 4];
        const cls = data[o + 5];

        if (conf <= confThreshold) continue;
        if (filterCls !== null && cls !== filterCls) continue;

        const x1 = data[o + 0] * scaleX;
        const y1 = data[o + 1] * scaleY;
        const x2 = data[o + 2] * scaleX;
        const y2 = data[o + 3] * scaleY;
        const w = x2 - x1;
        const h = y2 - y1;
        if (w > 10 && h > 10) boxes.push({ x: x1, y: y1, w, h, conf });
      }
    } else if (dims[1] === 5 && dims[2] === 8400) {
      const N = 8400;
      const confData = data.subarray(4 * N, 5 * N);
      const xData = data.subarray(0, N);
      const yData = data.subarray(N, 2 * N);
      const wData = data.subarray(2 * N, 3 * N);
      const hData = data.subarray(3 * N, 4 * N);

      for (let i = 0; i < N; i++) {
        const conf = confData[i];
        if (conf <= confThreshold) continue;

        const cx = xData[i] * scaleX;
        const cy = yData[i] * scaleY;
        const w = wData[i] * scaleX;
        const h = hData[i] * scaleY;

        boxes.push({ x: cx - w / 2, y: cy - h / 2, w, h, conf });
      }
      boxes = nms(boxes, IOU_THRESHOLD);
    }
 else {
      throw new Error(`Unrecognized model output dims: [${dims.join(',')}]`);
      }

      if (dims[1] === 300) boxes = nms(boxes, IOU_THRESHOLD);

      // Scan for translations below panels (Manga only)
      if (type === 'manga') {
        await includeBelowText(boxes, buffer, meta);
      }

      // Filter out whole-page detections if other panels exist

    const pageArea = meta.width * meta.height;
    if (boxes.length > 1) {
      const beforeCount = boxes.length;
      boxes = boxes.filter(b => {
        const ratio = (b.w * b.h) / pageArea;
        if (ratio >= 0.98) {
          console.log(`      [detect] Filtering out potential whole-page panel (ratio: ${ratio.toFixed(3)})`);
          return false;
        }
        return true;
      });
      if (boxes.length < beforeCount) {
        console.log(`      [detect] Filtered ${beforeCount - boxes.length} large box(es).`);
      }
    }

    if (boxes.length === 0) {
      return [[0, 0, meta.width, meta.height]];
    }

    return boxes.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]);
  } catch (err) {
    console.error('detectPanels error:', err);
    throw err;
  }
}

function sortReadingOrder(items, type) {
  if (!items || items.length === 0) return items;
  // Box format is [x, y, w, h] or {x, y, w, h}
  const boxes = items.map(p => Array.isArray(p) ? { x: p[0], y: p[1], w: p[2], h: p[3], raw: p } : { ...p, raw: p });
  
  // Sort primarily by Y (top to bottom)
  boxes.sort((a, b) => a.y - b.y);

  const rows = [];
  if (boxes.length > 0) {
    let currentRow = [boxes[0]];
    let rowBottom = boxes[0].y + boxes[0].h;

    for (let i = 1; i < boxes.length; i++) {
      const b = boxes[i];
      // Tighter row detection for Manga (20% overlap threshold)
      const avgH = currentRow.reduce((s, p) => s + p.h, 0) / currentRow.length;
      if (b.y < rowBottom - avgH * 0.2) {
        currentRow.push(b);
        rowBottom = Math.max(rowBottom, b.y + b.h);
      } else {
        rows.push(currentRow);
        currentRow = [b];
        rowBottom = b.y + b.h;
      }
    }
    rows.push(currentRow);
  }

  const sorted = rows.flatMap(row => {
    if (type === 'manga') {
      // Manga: right-to-left, but stacked panels in the same column must go top-to-bottom
      // within that column before moving left. We cluster by X-overlap, then sort clusters
      // right-to-left and items within each cluster top-to-bottom.
      const assigned = new Set();
      const byRight = [...row].sort((a, b) => (b.x + b.w) - (a.x + a.w));
      const clusters = [];
      for (const item of byRight) {
        if (assigned.has(item)) continue;
        const cluster = [item];
        assigned.add(item);
        for (const other of byRight) {
          if (assigned.has(other)) continue;
          const overlapX = Math.min(item.x + item.w, other.x + other.w) - Math.max(item.x, other.x);
          if (overlapX > 0 && overlapX / Math.min(item.w, other.w) > 0.5) {
            cluster.push(other);
            assigned.add(other);
          }
        }
        cluster.sort((a, b) => a.y - b.y); // top-to-bottom within the same column
        clusters.push(cluster);
      }
      return clusters.flat();
    } else {
      // Western: Left to Right within a row
      return row.sort((a, b) => a.x - b.x);
    }
  });

  return sorted.map(b => Array.isArray(b.raw) ? b.raw : [b.x, b.y, b.w, b.h]);
}

/**
 * Calculates the percentage of box A that is inside box B.
 */
function intersectionOverArea(boxA, boxB) {
  const [ax, ay, aw, ah] = Array.isArray(boxA) ? boxA : [boxA.x, boxA.y, boxA.w, boxA.h];
  const [bx, by, bw, bh] = Array.isArray(boxB) ? boxB : [boxB.x, boxB.y, boxB.w, boxB.h];

  const xI = Math.max(ax, bx);
  const yI = Math.max(ay, by);
  const wI = Math.min(ax + aw, bx + bw) - xI;
  const hI = Math.min(ay + ah, by + bh) - yI;

  if (wI <= 0 || hI <= 0) return 0;
  const areaI = wI * hI;
  const areaA = aw * ah;
  return areaI / areaA;
}

async function detectBubbles(buffer, type = 'western') {
  try {
    const session = await getSession('bubble');
    const image = sharp(buffer).removeAlpha();
    const meta = await image.metadata();

    const resized = await image.resize(INPUT_SIZE, INPUT_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0 }
    });
    const inputImg = await resized.raw().toBuffer();

    const px = INPUT_SIZE * INPUT_SIZE;
    if (inputImg.length !== 3 * px) {
      throw new Error(`Unexpected buffer length: ${inputImg.length}, expected ${3 * px}`);
    }

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

    const N = 8400;
    const scale = Math.max(meta.width, meta.height) / INPUT_SIZE;
    const padX = (INPUT_SIZE * scale - meta.width) / 2;
    const padY = (INPUT_SIZE * scale - meta.height) / 2;

    let boxes = [];
    const confData0 = data.subarray(4 * N, 5 * N);
    const confData1 = data.subarray(5 * N, 6 * N);
    const xData = data.subarray(0, N);
    const yData = data.subarray(N, 2 * N);
    const wData = data.subarray(2 * N, 3 * N);
    const hData = data.subarray(3 * N, 4 * N);

    for (let i = 0; i < N; i++) {
      const conf = Math.max(confData0[i], confData1[i]);
      if (conf > 0.05) {
        const cx = xData[i] * scale - padX;
        const cy = yData[i] * scale - padY;
        const w = wData[i] * scale;
        const h = hData[i] * scale;
        
        // Add 10% padding
        const pw = w * 1.1;
        const ph = h * 1.1;
        const px = cx - pw / 2;
        const py = cy - ph / 2;
        
        boxes.push({ x: px, y: py, w: pw, h: ph, conf });
      }
    }
    
    // NMS
    let kept = [];
    boxes.sort((a, b) => b.conf - a.conf);
    while (boxes.length > 0) {
      const top = boxes.shift();
      kept.push(top);
      boxes = boxes.filter(b => iou(top, b) < 0.4);
    }
    
    // Convert to simple [x,y,w,h] array for sorting
    const rawBoxes = kept.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]);
    return sortReadingOrder(rawBoxes, type);
  } catch (err) {
    console.error('detectBubbles error:', err);
    return [];
  }
}



// Builds the per-page navigation sequence for manga guided view.
// The manga model outputs both panels (large boxes) and speech bubbles (small boxes
// nested inside panels) in a single pass. We classify by containment, then interleave:
//   For each panel (right→left, top→bottom):
//     1. Speech bubbles inside it, right→left / top→bottom
//     2. The panel itself
function buildMangaSequence(allBoxes) {
  if (!allBoxes || allBoxes.length === 0) return [];

  // Classify: a box is a speech bubble if ≥70% of its area falls inside another box
  const isChild = new Array(allBoxes.length).fill(false);
  for (let i = 0; i < allBoxes.length; i++) {
    for (let j = 0; j < allBoxes.length; j++) {
      if (i === j) continue;
      if (intersectionOverArea(allBoxes[i], allBoxes[j]) >= 0.7) {
        isChild[i] = true;
        break;
      }
    }
  }

  const panels    = allBoxes.filter((_, i) => !isChild[i]);
  const allBubbles = allBoxes.filter((_, i) => isChild[i]);

  // Fallback: nothing classified as a panel (e.g. splash page with no nesting)
  if (panels.length === 0) return allBoxes;

  const sortedPanels = sortReadingOrder(panels, 'manga');
  const sequence = [];
  const assigned = new Set();

  for (const panel of sortedPanels) {
    // Find bubbles that belong to this panel (≥60% of the bubble inside the panel)
    const panelBubbles = [];
    for (let i = 0; i < allBubbles.length; i++) {
      if (assigned.has(i)) continue;
      if (intersectionOverArea(allBubbles[i], panel) >= 0.6) {
        panelBubbles.push(allBubbles[i]);
        assigned.add(i);
      }
    }

    // Sort this panel's bubbles in manga reading order (right→left, top→bottom)
    const sortedBubbles = sortReadingOrder(panelBubbles, 'manga');
    for (const b of sortedBubbles) sequence.push(b);

    // Panel itself comes after its dialogue — reader sees speech first, then the full panel
    sequence.push(panel);
  }

  return sequence;
}

/**
 * Builds a hierarchical LTR sequence for Western comics.
 * Groups bubbles into panels, sorts panels LTR, then bubbles LTR within them.
 * Interleaves floating bubbles based on their position.
 */
function buildHybridWesternSequence(panels, bubbles) {
  if (!bubbles || bubbles.length === 0) return [];
  if (!panels || panels.length === 0) return sortReadingOrder(bubbles, 'western');

  const assigned = new Set();
  const objects = [];

  // 1. Create Panel Group objects (as arrays to preserve reference through sortReadingOrder)
  for (const panel of panels) {
    const children = [];
    for (let i = 0; i < bubbles.length; i++) {
      if (assigned.has(i)) continue;
      if (intersectionOverArea(bubbles[i], panel) >= 0.7) {
        children.push(bubbles[i]);
        assigned.add(i);
      }
    }
    const arr = [...panel];
    arr.isPanel = true;
    arr.bubbles = sortReadingOrder(children, 'western');
    objects.push(arr);
  }

  // 2. Create Floating Bubble objects
  for (let i = 0; i < bubbles.length; i++) {
    if (!assigned.has(i)) {
      const b = bubbles[i];
      const arr = [...b];
      arr.isBubble = true;
      objects.push(arr);
    }
  }

  // 3. Sort all Objects globally (Western LTR)
  const sortedObjects = sortReadingOrder(objects, 'western');

  // 4. Flatten into a sequence of bubbles ONLY
  const sequence = [];
  for (const obj of sortedObjects) {
    if (obj.isPanel) {
      sequence.push(...obj.bubbles);
    } else {
      // Reconstruct clean array without the attached property
      sequence.push([obj[0], obj[1], obj[2], obj[3]]);
    }
  }

  return sequence;
}


async function processComic(id, comicPath, type, opts = {}) {
  if (type !== 'manga' && type !== 'western') {
    throw new Error(`Unknown comic type: ${type}`);
  }
  const isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : () => false;
  const maxPages = Number.isFinite(opts.maxPages) && opts.maxPages > 0 ? Math.floor(opts.maxPages) : null;

  let pages = await listPages(comicPath);
  if (!pages || pages.length === 0) throw new Error('No image pages found in archive');
  const totalPagesInArchive = pages.length;
  if (maxPages && pages.length > maxPages) pages = pages.slice(0, maxPages);

  await fs.promises.mkdir(GUIDED_VIEW_DIR, { recursive: true });
  const outputPath = path.join(GUIDED_VIEW_DIR, `${id}.json`);

  const result = { comicId: id, type, pages: {} };
  let totalPanels = 0;
  let pagesProcessed = 0;
  let pageFailures = 0;

  for (const pageName of pages) {
    if (isCancelled()) throw new Error('Cancelled mid-comic');
    try {
      // Single in-place line that updates every 10 pages instead of spamming.
      // Scoped per comic so each new comic gets its own progress line.
      if (pagesProcessed === 0 || pagesProcessed % 10 === 0) {
        const msg = `   ... processing page ${pagesProcessed}/${pages.length}`;
        guidedLogUpdate(`processing-pages:${id}`, 'INFO', msg);
        console.log(msg);
      }
      const buffer = await extractPageBuffer(comicPath, pageName);
      
      // Detect Panels
      // Manga mode: standard 0.1 pass
      // Western mode: hybrid pass using manga model @ 0.5 confidence, filtering for Class 0 (Panels)
      const rawPanels = (type === 'manga') 
        ? await detectPanels(buffer, 'manga', 0.1)
        : await detectPanels(buffer, 'manga', 0.5, 0);

      const panels = sortReadingOrder(rawPanels, type);
      
      // Detect Bubbles
      // Manga: model already includes them
      // Western: use dedicated bubble model
      const bubbles = type === 'western' ? await detectBubbles(buffer, type) : [];
      
      // Create Granular Sequence
      let sequence = [];
      if (type === 'manga') {
        sequence = buildMangaSequence(panels);
      } else {
        sequence = buildHybridWesternSequence(panels, bubbles);
      }

      result.pages[pageName] = { 
        panels, 
        bubbles,
        sequence: sequence.length > 0 ? sequence : panels 
      };
      totalPanels += panels.length;
      pagesProcessed++;
      } catch (err) {
      pageFailures++;
      result.pages[pageName] = { panels: [], bubbles: [], sequence: [] };
      guidedLog('WARN', `   page failed: ${pageName} — ${err.message || err}`);
      }
      }

      await fs.promises.writeFile(outputPath, JSON.stringify(result, null, 2));

      return {
      panels: totalPanels,
      pagesProcessed,
      pageFailures,
      pageCount: pages.length,
      archivePageCount: totalPagesInArchive,
      outputPath
      };
      }

      module.exports = {
      processComic,
      detectPanels,
      detectBubbles,
      sortReadingOrder,
      extractPageBuffer,
      listPages,
      GUIDED_VIEW_DIR,
      MODEL_PATHS
      };