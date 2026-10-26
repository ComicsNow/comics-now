const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { GUIDED_VIEW_DIR } = require('./panel-detector');

const SCRIPT_PATH = path.join(__dirname, '../../scripts/modal_guided_detect.py');

function getPythonBin() {
  if (process.env.MODAL_PYTHON_PATH && fs.existsSync(process.env.MODAL_PYTHON_PATH)) {
    return process.env.MODAL_PYTHON_PATH;
  }
  const localCandidates = [
    path.join(__dirname, '../../.venv/bin/python3'),
    path.join(__dirname, '../../tagger/venv/bin/python3')
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  if (process.env.MODAL_VENV_PATH) {
    const venvBin = path.join(process.env.MODAL_VENV_PATH, 'bin/python3');
    if (fs.existsSync(venvBin)) {
      return venvBin;
    }
  }
  return 'python3';
}

function buildEnv(credentials = {}) {
  const env = { ...process.env };
  if (credentials.modalTokenId) {
    env.MODAL_TOKEN_ID = credentials.modalTokenId;
  }
  if (credentials.modalTokenSecret) {
    env.MODAL_TOKEN_SECRET = credentials.modalTokenSecret;
  }
  if (credentials.modalEnvironment) {
    env.MODAL_ENVIRONMENT = credentials.modalEnvironment;
  }
  return env;
}

let _readyWorkspaceCache = new Set();

function runScriptJson(args, credentials = {}) {
  const pythonBin = getPythonBin();
  const useNice = fs.existsSync('/usr/bin/nice');
  const spawnBin = useNice ? '/usr/bin/nice' : pythonBin;
  const spawnArgs = useNice ? ['-n', '15', pythonBin, ...args] : args;
  return new Promise((resolve) => {
    const child = spawn(spawnBin, spawnArgs, {
      env: buildEnv(credentials)
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      resolve({ ok: false, error: `Failed to spawn Modal process: ${err.message}` });
    });

    child.on('close', (code) => {
      try {
        const trimmed = stdout.trim();
        if (trimmed) {
          const parsed = JSON.parse(trimmed);
          resolve(parsed);
          return;
        }
      } catch (_) {}

      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr.trim() || `Modal process exited with code ${code}`
        });
      } else {
        resolve({
          ok: false,
          error: stderr.trim() || 'No output received from Modal command'
        });
      }
    });
  });
}

async function checkCredits(credentials = {}) {
  return runScriptJson([SCRIPT_PATH, '--check-credits'], credentials);
}

async function checkEnvironment(credentials = {}) {
  const res = await runScriptJson([SCRIPT_PATH, '--check-environment'], credentials);
  if (res.ok && res.ready && credentials.modalTokenId) {
    _readyWorkspaceCache.add(credentials.modalTokenId);
  }
  return res;
}

async function setupEnvironment(credentials = {}) {
  const res = await runScriptJson([SCRIPT_PATH, '--setup-environment'], credentials);
  if (res.ok && credentials.modalTokenId) {
    _readyWorkspaceCache.add(credentials.modalTokenId);
  }
  return res;
}

async function ensureEnvironmentReady(credentials = {}, logger = null) {
  const tokenId = credentials.modalTokenId || 'default';
  if (_readyWorkspaceCache.has(tokenId)) {
    return { ok: true, ready: true };
  }

  const env = await checkEnvironment(credentials);
  if (env.ok && env.ready) {
    _readyWorkspaceCache.add(tokenId);
    return env;
  }

  if (logger) {
    logger('INFO', '   [Modal] First-time setup detected. Initializing Modal workspace and uploading models...');
  }

  const setupRes = await setupEnvironment(credentials);
  if (setupRes.ok) {
    _readyWorkspaceCache.add(tokenId);
    if (logger) {
      logger('INFO', '   ✓ [Modal] Workspace initialized and deployed successfully.');
    }
  } else if (logger) {
    logger('WARN', `   ⚠ [Modal] Automatic environment setup warning: ${setupRes.error}`);
  }
  return setupRes;
}

async function processComic(id, comicPath, type, opts = {}) {
  const isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : () => false;
  if (isCancelled()) throw new Error('Cancelled');

  const pythonBin = getPythonBin();
  const outputDir = opts.outputDir || GUIDED_VIEW_DIR;

  return new Promise((resolve, reject) => {
    const args = [
      SCRIPT_PATH,
      '--process-comic',
      '--comic-id', id,
      '--comic-path', comicPath,
      '--type', type || 'western',
      '--output-dir', outputDir
    ];

    const useNice = fs.existsSync('/usr/bin/nice');
    const spawnBin = useNice ? '/usr/bin/nice' : pythonBin;
    const spawnArgs = useNice ? ['-n', '15', pythonBin, ...args] : args;

    const child = spawn(spawnBin, spawnArgs, {
      env: buildEnv(opts)
    });

    let stdout = '';
    let stderr = '';

    const cancelChecker = setInterval(() => {
      if (isCancelled()) {
        clearInterval(cancelChecker);
        try { child.kill('SIGTERM'); } catch (_) {}
        reject(new Error('Cancelled'));
      }
    }, 500);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      clearInterval(cancelChecker);
      reject(new Error(`Failed to spawn Modal process: ${err.message}`));
    });

    child.on('close', (code) => {
      clearInterval(cancelChecker);
      if (isCancelled()) {
        reject(new Error('Cancelled'));
        return;
      }

      try {
        const trimmed = stdout.trim();
        if (trimmed) {
          const parsed = JSON.parse(trimmed);
          if (parsed.ok) {
            resolve({
              panels: parsed.panels,
              pagesProcessed: parsed.pagesProcessed,
              pageCount: parsed.pageCount,
              outputPath: parsed.outputPath
            });
            return;
          } else {
            reject(new Error(parsed.error || 'Modal detection failed'));
            return;
          }
        }
      } catch (_) {}

      const errMsg = stderr.trim() || `Modal process exited with code ${code}`;
      reject(new Error(errMsg));
    });
  });
}

module.exports = {
  checkCredits,
  checkEnvironment,
  setupEnvironment,
  ensureEnvironmentReady,
  processComic,
  getPythonBin
};
