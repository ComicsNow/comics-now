import * as bundledPdfjs from 'pdfjs-dist';

let workerConfigured = false;

function resolvePdfjs(override) {
  const lib = override || bundledPdfjs || (typeof globalThis !== 'undefined' ? globalThis.pdfjsLib : null);
  if (!lib || typeof lib.getDocument !== 'function') {
    throw new Error('PDF.js library is not available');
  }
  if (!workerConfigured && lib.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs';
    workerConfigured = true;
  }
  return lib;
}

function parsePageIndex(entryName) {
  const match = String(entryName || '').match(/page-(\d+)\./i);
  if (!match) return 1;
  return Math.max(1, parseInt(match[1], 10));
}

async function renderPageToBlob(pdfDoc, pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = 1800;
  const scale = Math.min(2.2, Math.max(1.0, targetWidth / Math.max(1, baseViewport.width)));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable for PDF rendering');
  }

  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to encode rendered PDF page'))),
        'image/jpeg',
        0.88
      );
    });
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    if (typeof page.cleanup === 'function') {
      try { page.cleanup(); } catch (_) {}
    }
  }
}

export async function openPdfClientArchive(arrayBuffer, options = {}) {
  const pdfjs = resolvePdfjs(options.pdfjsLib);
  const data = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const loadingTask = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true
  });
  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages || 0;
  const pages = [];
  for (let i = 1; i <= pageCount; i++) {
    pages.push(`page-${String(i).padStart(4, '0')}.jpg`);
  }

  const extractEntryBlob = async (entryName) => {
    const idx = pages.indexOf(entryName);
    const pageNumber = idx >= 0 ? idx + 1 : parsePageIndex(entryName);
    if (pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`Page not found in PDF: ${entryName}`);
    }
    return renderPageToBlob(pdfDoc, pageNumber);
  };

  return {
    type: 'pdf',
    pdfDoc,
    listEntries: () => pages.slice(),
    getCoverEntryName: () => pages[0] || null,
    extractEntryBlob,
    getPageBlob: extractEntryBlob,
    close: () => {
      try { pdfDoc.destroy(); } catch (_) {}
    }
  };
}
