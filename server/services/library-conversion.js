const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('../logger');
const { t0, ms } = require('../utils');

async function convertCbrToCbz(cbrPath) {
  return new Promise((resolve) => {
    const start = t0();
    log('INFO', 'CONVERT', `Converting: ${path.basename(cbrPath)}`);
    const cbzPath = cbrPath.replace(/\.cbr$/i, '.cbz');
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'convert_cbr_to_cbz.sh');
    const cbrDir = path.dirname(cbrPath);

    // Run the bash script from the directory containing the CBR file
    const conversionProcess = spawn(scriptPath, [cbrPath], {
      cwd: cbrDir,
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      timeout: 30 * 60 * 1000 // 30 minute timeout
    });

    let stdout = '';
    let stderr = '';
    let lastLog = Date.now();

    conversionProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;

      // Log progress every 5 seconds
      if (Date.now() - lastLog > 5000) {
        log('INFO', 'CONVERT', `Progress: ${path.basename(cbrPath)}`);
        lastLog = Date.now();
      }
    });

    conversionProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    conversionProcess.on('error', (err) => {
      if (err.code === 'ENOENT') {
        log('ERROR', 'CONVERT', `Conversion script not found: ${scriptPath}`);
        return resolve(null);
      }
      log('ERROR', 'CONVERT', `❌ Failed ${path.basename(cbrPath)}: ${err.message} after ${ms(start)} ms`);
      resolve(null);
    });

    conversionProcess.on('close', (code) => {
      if (code === 0) {
        // Check if CBZ file was created
        if (fs.existsSync(cbzPath)) {
          log('INFO', 'CONVERT', `✅ Created: ${path.basename(cbzPath)} in ${ms(start)} ms`);
          resolve(cbzPath);
        } else {
          log('ERROR', 'CONVERT', `❌ Failed ${path.basename(cbrPath)}: CBZ file not created after ${ms(start)} ms`);
          resolve(null);
        }
      } else {
        const errorMsg = stderr.trim() || stdout.trim() || `Script exited with code ${code}`;
        log('ERROR', 'CONVERT', `❌ Failed ${path.basename(cbrPath)}: ${errorMsg} after ${ms(start)} ms`);
        resolve(null);
      }
    });
  });
}

async function convertPdfToCbz(pdfPath) {
  return new Promise((resolve) => {
    const start = t0();
    log('INFO', 'CONVERT', `Converting PDF: ${path.basename(pdfPath)}`);
    const cbzPath = pdfPath.replace(/\.pdf$/i, '.cbz');
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'pdf2cbz.sh');
    const pdfDir = path.dirname(pdfPath);

    // Run the bash script from the directory containing the PDF file
    const conversionProcess = spawn(scriptPath, [pdfPath], {
      cwd: pdfDir,
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      timeout: 30 * 60 * 1000 // 30 minute timeout
    });

    let stdout = '';
    let stderr = '';
    let lastLog = Date.now();

    conversionProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;

      // Log progress every 5 seconds
      if (Date.now() - lastLog > 5000) {
        log('INFO', 'CONVERT', `Progress: ${path.basename(pdfPath)}`);
        lastLog = Date.now();
      }
    });

    conversionProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    conversionProcess.on('error', (err) => {
      if (err.code === 'ENOENT') {
        log('ERROR', 'CONVERT', `Conversion script not found: ${scriptPath}`);
        return resolve(null);
      }
      log('ERROR', 'CONVERT', `❌ Failed ${path.basename(pdfPath)}: ${err.message} after ${ms(start)} ms`);
      resolve(null);
    });

    conversionProcess.on('close', (code) => {
      if (code === 0) {
        // Check if CBZ file was created
        if (fs.existsSync(cbzPath)) {
          log('INFO', 'CONVERT', `✅ Created: ${path.basename(cbzPath)} in ${ms(start)} ms`);
          resolve(cbzPath);
        } else {
          log('ERROR', 'CONVERT', `❌ Failed ${path.basename(pdfPath)}: CBZ file not created after ${ms(start)} ms`);
          resolve(null);
        }
      } else {
        const errorMsg = stderr.trim() || stdout.trim() || `Script exited with code ${code}`;
        log('ERROR', 'CONVERT', `❌ Failed ${path.basename(pdfPath)}: ${errorMsg} after ${ms(start)} ms`);
        resolve(null);
      }
    });
  });
}

module.exports = {
  convertCbrToCbz,
  convertPdfToCbz
};
