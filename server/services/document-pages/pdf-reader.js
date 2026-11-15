const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DOC_WORKER_PATH = path.resolve(__dirname, '../../../scripts/doc_worker.py');
const VENV_PYTHON = path.resolve(__dirname, '../../../.venv/bin/python3');

function resolvePythonBin() {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return 'python3';
}

function runCommand(bin, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
      reject(new Error(`${path.basename(bin)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `Exited with code ${code}`).trim()));
      }
    });
  });
}

function parsePageIndex(entryName) {
  const m = String(entryName || '').match(/page-(\d+)\./i);
  if (!m) return 0;
  return Math.max(0, parseInt(m[1], 10) - 1);
}

async function getPdfInfo(filePath) {
  const py = resolvePythonBin();
  try {
    const { stdout } = await runCommand(py, [DOC_WORKER_PATH, '--mode', 'info', '--path', filePath]);
    return JSON.parse(stdout);
  } catch (err) {
    // CLI fallback using pdfinfo
    const { stdout } = await runCommand('pdfinfo', [filePath]);
    const match = stdout.match(/^Pages:\s+(\d+)/m);
    const count = match ? parseInt(match[1], 10) : 0;
    const pages = [];
    for (let i = 1; i <= count; i++) {
      pages.push(`page-${String(i).padStart(4, '0')}.jpg`);
    }
    if (count > 0) return { pageCount: count, pages };
    throw err;
  }
}

async function renderPdfPageBuffer(filePath, pageIndex, dpi = 180) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comics-now-pdf-'));
  const outPrefix = path.join(tmpDir, 'page');
  const outJpg = `${outPrefix}.jpg`;
  const py = resolvePythonBin();
  try {
    try {
      await runCommand(py, [
        DOC_WORKER_PATH,
        '--mode', 'page',
        '--path', filePath,
        '--page', String(pageIndex),
        '--dpi', String(dpi),
        '--out', outJpg
      ]);
      return await fs.promises.readFile(outJpg);
    } catch {
      const pageNum = pageIndex + 1;
      await runCommand('pdftoppm', [
        '-jpeg', '-r', String(dpi),
        '-f', String(pageNum), '-l', String(pageNum),
        '-singlefile', filePath, outPrefix
      ]);
      return await fs.promises.readFile(outJpg);
    }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readPdfMetadata(filePath) {
  const py = resolvePythonBin();
  try {
    const { stdout } = await runCommand(py, [DOC_WORKER_PATH, '--mode', 'metadata', '--path', filePath]);
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function createPdfReader(filePath) {
  const info = await getPdfInfo(filePath);
  const pages = Array.isArray(info.pages) ? info.pages : [];
  return {
    filePath,
    orderedPages: pages,
    listEntries() {
      return [...pages];
    },
    async readBuffer(entryName) {
      const idx = pages.indexOf(entryName);
      const pageIndex = idx >= 0 ? idx : parsePageIndex(entryName);
      return renderPdfPageBuffer(filePath, pageIndex);
    },
    close() {}
  };
}

async function openPdfSession(filePath) {
  const reader = await createPdfReader(filePath);
  return {
    pages: [...reader.orderedPages],
    readBuffer: (name) => reader.readBuffer(name),
    close: async () => reader.close()
  };
}

module.exports = {
  createPdfReader,
  openPdfSession,
  readPdfMetadata,
  renderPdfPageBuffer
};
