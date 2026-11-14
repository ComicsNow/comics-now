/**
 * Comics Now! - Client-Side Archive Extractor
 *
 * Unified browser archive reader supporting CBZ (via JSZip) and native CBR
 * (via node-unrar-js WebAssembly) for offline and local device reading.
 */

import { createExtractorFromData } from 'node-unrar-js';
import { state, global as canonicalGlobal } from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : state;

let wasmBinaryPromise = null;

function getImageMimeType(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

async function getUnrarWasmBinary() {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = fetch('./unrar.wasm')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load unrar.wasm: ${res.status}`);
        }
        return res.arrayBuffer();
      })
      .catch((err) => {
        wasmBinaryPromise = null;
        throw err;
      });
  }
  return wasmBinaryPromise;
}

async function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  if (data && typeof data.arrayBuffer === 'function') {
    return await data.arrayBuffer();
  }
  throw new Error('Unsupported archive data type');
}

/**
 * Detect whether an archive buffer is CBR (RAR) or CBZ (ZIP) by magic bytes,
 * falling back to filename extension.
 */
export function detectArchiveType(arrayBuffer, filename = '') {
  if (arrayBuffer && arrayBuffer.byteLength >= 4) {
    const bytes = new Uint8Array(arrayBuffer.slice(0, 4));
    if (bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) {
      return 'cbr';
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      return 'cbz';
    }
  }
  if (/\.cbr$/i.test(String(filename || ''))) {
    return 'cbr';
  }
  return 'cbz';
}

/**
 * Open a CBZ or CBR archive in memory and expose a uniform entry listing and
 * single-entry Blob extraction API.
 */
export async function openClientArchive(data, filename = '') {
  const arrayBuffer = await toArrayBuffer(data);
  const type = detectArchiveType(arrayBuffer, filename);

  if (type === 'cbr') {
    const createExtractor = typeof createExtractorFromData === 'function'
      ? createExtractorFromData
      : (typeof window !== 'undefined' ? window.createExtractorFromData : null);
    if (typeof createExtractor !== 'function') {
      throw new Error('RAR extractor is not available');
    }

    const wasmBinary = await getUnrarWasmBinary();
    const extractor = await createExtractor({ data: arrayBuffer, wasmBinary });
    const arcList = extractor.getFileList();
    const entryNames = [];
    for (const header of arcList.fileHeaders) {
      if (header && (!header.flags || !header.flags.directory)) {
        entryNames.push(header.name);
      }
    }

    return {
      type: 'cbr',
      extractor,
      listEntries: () => entryNames.slice(),
      extractEntryBlob: async (entryName) => {
        const extracted = extractor.extract({ files: [entryName] });
        const files = extracted && extracted.files ? Array.from(extracted.files) : [];
        const file = files.find((f) => f && f.fileHeader && f.fileHeader.name === entryName) || files[0];
        if (!file || !file.extraction) {
          throw new Error(`Entry not found in CBR: ${entryName}`);
        }
        return new Blob([file.extraction], { type: getImageMimeType(entryName) });
      },
      close: () => {}
    };
  }

  const JSZipCtor = (global && global.JSZip) || (typeof window !== 'undefined' ? window.JSZip : null);
  if (!JSZipCtor) {
    throw new Error('JSZip not found');
  }

  const zip = await new JSZipCtor().loadAsync(arrayBuffer);
  return {
    type: 'cbz',
    zip,
    listEntries: () => Object.keys(zip.files).filter((name) => zip.files[name] && !zip.files[name].dir),
    extractEntryBlob: async (entryName) => {
      const pageFile = zip.file(entryName);
      if (!pageFile) {
        throw new Error(`Entry not found in CBZ: ${entryName}`);
      }
      return await pageFile.async('blob');
    },
    close: () => {}
  };
}

if (typeof state !== 'undefined') {
  state.detectArchiveType = detectArchiveType;
  state.openClientArchive = openClientArchive;
}

if (typeof window !== 'undefined') {
  window.detectArchiveType = detectArchiveType;
  window.openClientArchive = openClientArchive;
}
