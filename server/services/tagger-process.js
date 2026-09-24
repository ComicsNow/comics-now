const { spawn } = require('child_process');
const path = require('path');
const { log, ctLog } = require('../logger');
const { getTaggerServiceUrl } = require('../config');

let taggerChild = null;

async function isWorkerOnline(url) {
  const targetUrl = url || getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  try {
    const res = await fetch(`${targetUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data = await res.json();
      return data.status === 'ok';
    }
    return false;
  } catch {
    return false;
  }
}

async function startTaggerWorker() {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';

  if (await isWorkerOnline(serviceUrl)) {
    log('INFO', 'TAGGER', `Tagger worker already active at ${serviceUrl}`);
    return;
  }

  // Only spawn local daemon if URL is localhost / 127.0.0.1
  const isLocal = serviceUrl.includes('localhost') || serviceUrl.includes('127.0.0.1');
  if (!isLocal) {
    log('INFO', 'TAGGER', `Configured for remote tagger service at ${serviceUrl}`);
    return;
  }

  const pythonBin = process.env.PYTHON_PATH || 'python3';
  const taggerRoot = path.join(__dirname, '..', '..', 'tagger');
  const taggerScript = path.join(taggerRoot, 'app.py');
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

  log('INFO', 'TAGGER', `Starting internal Python tagger worker (${pythonBin} ${taggerScript})...`);

  try {
    taggerChild = spawn(pythonBin, [taggerScript], {
      cwd: taggerRoot,
      env: {
        ...process.env,
        APP_HOST: '127.0.0.1',
        PORT: '5000',
        FLASK_DEBUG: '0',
        DATA_DIR: dataDir,
        TRACKING_DB_PATH: path.join(dataDir, 'enhanced_tracking.db'),
        SCAN_LOGS_DIR: path.join(dataDir, 'scan_logs'),
        SCHEDULER_CONFIG_PATH: path.join(dataDir, 'scheduler_config.json')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    taggerChild.stdout.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) {
        log('DEBUG', 'TAGGER', msg);
      }
    });

    taggerChild.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) {
        log('DEBUG', 'TAGGER', msg);
      }
    });

    taggerChild.on('exit', (code, signal) => {
      log('INFO', 'TAGGER', `Internal tagger worker process exited (code=${code}, signal=${signal})`);
      taggerChild = null;
    });

    // Wait up to 5 seconds for the worker to become ready
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await isWorkerOnline(serviceUrl)) {
        log('INFO', 'TAGGER', 'Internal Python tagger worker is online and ready.');
        return;
      }
    }
    log('WARN', 'TAGGER', 'Tagger worker spawned but health check did not respond in 5s. It may still be starting.');
  } catch (err) {
    log('ERROR', 'TAGGER', `Failed to spawn tagger worker: ${err.message}`);
  }
}

function stopTaggerWorker() {
  if (taggerChild) {
    log('INFO', 'TAGGER', 'Shutting down internal Python tagger worker...');
    try {
      taggerChild.kill('SIGTERM');
    } catch {}
    taggerChild = null;
  }
}

module.exports = {
  startTaggerWorker,
  stopTaggerWorker,
  isWorkerOnline
};
