const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('../logger');
const { t0, ms } = require('../utils');
const {
  getDeleteCbrAfterConversion,
  getDeletePdfAfterConversion
} = require('../config');

const CONVERSION_TIMEOUT_MS = 30 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 5000;
const PDF_DPI = '300';
const PDF_JPEG_QUALITY = '100';

/**
 * Spawns a conversion binary with timeout, stderr/stdout capture, and periodic progress callbacks.
 */
function runBinary(cmd, args, cwd, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      timeout: CONVERSION_TIMEOUT_MS
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (onProgress) onProgress();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        return reject(new Error(`Required binary '${cmd}' is not installed`));
      }
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        return resolve();
      }
      const errorMsg = stderr.trim() || stdout.trim() || `${cmd} exited with code ${code}`;
      reject(new Error(errorMsg));
    });
  });
}

/**
 * Recursively removes symbolic links inside an extracted directory before repacking.
 */
async function stripSymlinks(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      await fs.promises.unlink(fullPath);
    } else if (entry.isDirectory()) {
      await stripSymlinks(fullPath);
    }
  }
}

function resolveDeleteFlag(override, getter) {
  if (override !== undefined) {
    return Boolean(override);
  }
  return typeof getter === 'function' ? Boolean(getter()) : false;
}

function createProgressReporter(label) {
  let lastLog = Date.now();
  return () => {
    if (Date.now() - lastLog > PROGRESS_INTERVAL_MS) {
      log('INFO', 'CONVERT', `Progress: ${label}`);
      lastLog = Date.now();
    }
  };
}

/**
 * Converts a .cbr archive to a store-only .cbz archive using unrar and zip directly.
 */
async function convertCbrToCbz(cbrPath, options = {}) {
  const start = t0();
  const baseName = path.basename(cbrPath);
  log('INFO', 'CONVERT', `Converting: ${baseName}`);

  const safeCbrPath = path.resolve(cbrPath);
  const safeCbzPath = path.resolve(cbrPath.replace(/\.cbr$/i, '.cbz'));
  const cbrDir = path.dirname(safeCbrPath);
  const shouldDelete = resolveDeleteFlag(options.deleteOriginals, getDeleteCbrAfterConversion);
  const reportProgress = createProgressReporter(baseName);

  let tempDir = null;
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comics-now-cbr-'));

    await runBinary(
      'unrar',
      ['x', '-o+', '-y', '-ol-', '--', safeCbrPath, `${tempDir}${path.sep}`],
      cbrDir,
      reportProgress
    );

    await stripSymlinks(tempDir);

    await runBinary(
      'zip',
      ['-0', '-r', '-q', '-y', safeCbzPath, '--', '.'],
      tempDir,
      reportProgress
    );

    if (!fs.existsSync(safeCbzPath)) {
      log('ERROR', 'CONVERT', `❌ Failed ${baseName}: CBZ file not created after ${ms(start)} ms`);
      return null;
    }

    if (shouldDelete) {
      await fs.promises.unlink(safeCbrPath);
    }

    log('INFO', 'CONVERT', `✅ Created: ${path.basename(safeCbzPath)} in ${ms(start)} ms`);
    return safeCbzPath;
  } catch (err) {
    log('ERROR', 'CONVERT', `❌ Failed ${baseName}: ${err.message} after ${ms(start)} ms`);
    return null;
  } finally {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Converts a .pdf file to a .cbz archive using pdftoppm and zip directly.
 */
async function convertPdfToCbz(pdfPath, options = {}) {
  const start = t0();
  const baseName = path.basename(pdfPath);
  log('INFO', 'CONVERT', `Converting PDF: ${baseName}`);

  const safePdfPath = path.resolve(pdfPath);
  const safeCbzPath = path.resolve(pdfPath.replace(/\.pdf$/i, '.cbz'));
  const pdfDir = path.dirname(safePdfPath);
  const shouldDelete = resolveDeleteFlag(options.deleteOriginals, getDeletePdfAfterConversion);
  const reportProgress = createProgressReporter(baseName);

  let tempDir = null;
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comics-now-pdf-'));

    await runBinary(
      'pdftoppm',
      ['-r', PDF_DPI, '-jpeg', '-jpegopt', `quality=${PDF_JPEG_QUALITY}`, '--', safePdfPath, path.join(tempDir, 'page')],
      pdfDir,
      reportProgress
    );

    const entries = await fs.promises.readdir(tempDir, { withFileTypes: true });
    const pageFiles = entries
      .filter((entry) => entry.isFile() && /^page-.*\.jpg$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    if (pageFiles.length === 0) {
      log('ERROR', 'CONVERT', `❌ Failed ${baseName}: No images were created by pdftoppm after ${ms(start)} ms`);
      return null;
    }

    await runBinary(
      'zip',
      ['-j', '-y', safeCbzPath, '--', ...pageFiles],
      tempDir,
      reportProgress
    );

    if (!fs.existsSync(safeCbzPath)) {
      log('ERROR', 'CONVERT', `❌ Failed ${baseName}: CBZ file not created after ${ms(start)} ms`);
      return null;
    }

    if (shouldDelete) {
      await fs.promises.unlink(safePdfPath);
    }

    log('INFO', 'CONVERT', `✅ Created: ${path.basename(safeCbzPath)} in ${ms(start)} ms`);
    return safeCbzPath;
  } catch (err) {
    log('ERROR', 'CONVERT', `❌ Failed ${baseName}: ${err.message} after ${ms(start)} ms`);
    return null;
  } finally {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  convertCbrToCbz,
  convertPdfToCbz
};
