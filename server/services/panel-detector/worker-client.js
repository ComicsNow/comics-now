const path = require('path');
const { fork } = require('child_process');
const { detectPanels, detectBubbles } = require('./inference');
const {
  sortReadingOrder,
  buildMangaSequence,
  buildHybridWesternSequence
} = require('./ordering');

const WORKER_PATH = path.join(__dirname, 'onnx-worker.js');
const WORKER_TIMEOUT_MS = 120000;

let activeChild = null;
let activeReject = null;
let cpuMutex = Promise.resolve();
let nextReqId = 1;

function createSharpImage(sharpFn, buffer) {
  const img = sharpFn(buffer);
  return typeof img.rotate === 'function' ? img.rotate() : img;
}

async function detectPageInProcess(buffer, type) {
  let rawPanels = (type === 'manga')
    ? await detectPanels(buffer, 'manga', 0.1, 0)
    : await detectPanels(buffer, 'western', 0.5, 0);

  const isFullPageFallback = Array.isArray(rawPanels)
    && rawPanels.length === 1
    && rawPanels[0][0] === 0
    && rawPanels[0][1] === 0;
  if (type !== 'manga' && (!rawPanels || rawPanels.length === 0 || isFullPageFallback)) {
    rawPanels = await detectPanels(buffer, 'western', 0.15, 0);
  }

  const panels = sortReadingOrder(rawPanels, type);
  const bubbles = await detectBubbles(buffer, type);
  const sequence = (type === 'manga')
    ? buildMangaSequence(rawPanels, bubbles)
    : buildHybridWesternSequence(panels, bubbles);

  return {
    rawPanels,
    panels,
    bubbles,
    sequence: sequence.length > 0 ? sequence : panels
  };
}

function withCpuMutex(fn) {
  const run = cpuMutex.then(fn, fn);
  cpuMutex = run.catch(() => {});
  return run;
}

function abortActiveWorker(reason = 'Cancelled') {
  const child = activeChild;
  const reject = activeReject;
  activeChild = null;
  activeReject = null;
  if (child && !child.killed) {
    try { child.kill('SIGKILL'); } catch {}
  }
  if (reject) {
    reject(new Error(reason));
  }
}

function resetWorkerState() {
  abortActiveWorker('Worker reset');
  cpuMutex = Promise.resolve();
  nextReqId = 1;
}

function ensureWorker() {
  if (activeChild && activeChild.connected && !activeChild.killed) {
    return activeChild;
  }
  const child = fork(WORKER_PATH, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  activeChild = child;
  child.once('exit', (code, signal) => {
    if (activeChild === child) {
      activeChild = null;
    }
    if (activeReject) {
      const reject = activeReject;
      activeReject = null;
      reject(new Error(`ONNX worker exited (${signal || code || 'unknown'})`));
    }
  });
  return child;
}

function detectPageInWorker(buffer, comicType, opts = {}) {
  const isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : () => false;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : WORKER_TIMEOUT_MS;

  return withCpuMutex(() => new Promise((resolve, reject) => {
    if (isCancelled()) {
      return reject(new Error('Cancelled'));
    }

    const child = ensureWorker();
    const id = nextReqId++;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(cancelPoll);
      child.removeListener('message', onMessage);
      if (activeReject === fail) activeReject = null;
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    activeReject = fail;

    const onMessage = (msg) => {
      if (!msg || msg.id !== id) return;
      if (msg.type === 'result') {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          rawPanels: msg.rawPanels || [],
          panels: msg.panels || [],
          bubbles: msg.bubbles || [],
          sequence: msg.sequence || []
        });
      } else if (msg.type === 'error') {
        fail(new Error(msg.message || 'ONNX worker failed'));
      }
    };

    const timer = setTimeout(() => {
      abortActiveWorker(`ONNX worker timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    const cancelPoll = setInterval(() => {
      if (isCancelled()) {
        abortActiveWorker('Cancelled');
      }
    }, 100);

    child.on('message', onMessage);
    child.send({
      type: 'detect-page',
      id,
      comicType,
      bufferBase64: buffer.toString('base64')
    });
  }));
}

module.exports = {
  createSharpImage,
  detectPageInProcess,
  detectPageInWorker,
  abortActiveWorker,
  resetWorkerState
};
