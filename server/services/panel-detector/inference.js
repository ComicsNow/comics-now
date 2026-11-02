const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');
const sharp = require('sharp');

const { ROOT_DIR } = require('../../constants');
const { log } = require('../../logger');
const {
  DEFAULTS,
  nms,
  includeBelowText,
  tightenBubbleToText
} = require('./geometry');
const { sortReadingOrder } = require('./ordering');

const MODELS_DIR = path.join(ROOT_DIR, 'models');
const MODEL_PATHS = {
  manga: path.join(MODELS_DIR, 'manga', 'manga.onnx'),
  western: path.join(MODELS_DIR, 'manga', 'manga.onnx'),
  bubble: path.join(MODELS_DIR, 'bubble', 'speech_bubble_detector.onnx')
};

const INPUT_SIZE = 640;

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
      throw new Error('Model file missing for type "' + type + '": ' + modelPath);
    }
  }

  sessionPromises[type] = ort.InferenceSession.create(modelPath, { intraOpNumThreads: 2, interOpNumThreads: 2 })
    .then(session => {
      sessions[type] = session;
      sessionPromises[type] = null;
      log('INFO', 'GUIDED', 'Loaded ' + type + ' model: ' + path.basename(modelPath));
      return session;
    })
    .catch(err => {
      sessionPromises[type] = null;
      throw err;
    });
  return sessionPromises[type];
}

async function detectPanels(buffer, typeOrIsManga, confThreshold = null, filterCls = null) {
  try {
    const type = typeof typeOrIsManga === 'boolean' ? (typeOrIsManga ? 'manga' : 'western') : typeOrIsManga;
    const session = await getSession(type);
    const image = sharp(buffer).removeAlpha();
    const meta = await image.metadata();

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

module.exports = {
  INPUT_SIZE,
  MODEL_PATHS,
  getSession,
  detectPanels,
  detectBubbles
};
