/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createArchiveExtractorSandbox(overrides = {}) {
  const state = {};
  const mockZipFiles = {
    'page01.jpg': { dir: false, async: jest.fn().mockResolvedValue(new Blob(['zip-p1'])) },
    'dir/': { dir: true }
  };

  const mockRarExtractor = {
    getFileList: jest.fn(() => ({
      fileHeaders: [
        { name: 'page01.jpg', flags: { directory: false } },
        { name: 'folder/', flags: { directory: true } },
        { name: 'page02.png', flags: { directory: false } }
      ]
    })),
    extract: jest.fn(({ files }) => ({
      files: files.map(name => ({
        fileHeader: { name },
        extraction: new Uint8Array([1, 2, 3])
      }))
    }))
  };

  const createExtractorFromData = overrides.createExtractorFromData || jest.fn().mockResolvedValue(mockRarExtractor);

  const sandbox = {
    window: {},
    state,
    console,
    Blob,
    Uint8Array,
    ArrayBuffer,
    fetch: overrides.fetch || jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0, 97, 115, 109]).buffer
    }),
    JSZip: overrides.JSZip || class {
      async loadAsync() {
        return {
          files: mockZipFiles,
          file: (name) => mockZipFiles[name] || null
        };
      }
    },
    createExtractorFromData
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const fullPath = path.resolve(__dirname, '../../../../public/js/core/archive-extractor.js');
  const code = fs.readFileSync(fullPath, 'utf8')
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '');

  vm.runInContext(code, sandbox);
  return { sandbox, state, mockZipFiles, mockRarExtractor, createExtractorFromData };
}

describe('public/js/core/archive-extractor.js', () => {
  test('detectArchiveType identifies RAR and ZIP magic bytes and falls back to filename', () => {
    const { sandbox } = createArchiveExtractorSandbox();

    const rarBuf = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]).buffer;
    const zipBuf = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const unknownBuf = new Uint8Array([0x00, 0x00, 0x00, 0x00]).buffer;

    expect(sandbox.detectArchiveType(rarBuf, 'comic.cbz')).toBe('cbr');
    expect(sandbox.detectArchiveType(zipBuf, 'comic.cbr')).toBe('cbz');
    expect(sandbox.detectArchiveType(unknownBuf, 'issue.CBR')).toBe('cbr');
    expect(sandbox.detectArchiveType(unknownBuf, 'issue.cbz')).toBe('cbz');
  });

  test('openClientArchive extracts entries from CBZ using JSZip', async () => {
    const { sandbox } = createArchiveExtractorSandbox();
    const zipBuf = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;

    const archive = await sandbox.openClientArchive(zipBuf, 'test.cbz');
    expect(archive.type).toBe('cbz');
    expect(archive.listEntries()).toEqual(['page01.jpg']);

    const blob = await archive.extractEntryBlob('page01.jpg');
    expect(blob).toBeInstanceOf(Blob);
    await expect(archive.extractEntryBlob('missing.jpg')).rejects.toThrow('Entry not found in CBZ');
  });

  test('openClientArchive extracts entries from CBR using node-unrar-js and caches wasm binary', async () => {
    const { sandbox, createExtractorFromData } = createArchiveExtractorSandbox();
    const rarBuf = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]).buffer;

    const archive = await sandbox.openClientArchive(rarBuf, 'test.cbr');
    expect(archive.type).toBe('cbr');
    expect(sandbox.fetch).toHaveBeenCalledTimes(1);
    expect(sandbox.fetch).toHaveBeenCalledWith('./unrar.wasm');
    expect(createExtractorFromData).toHaveBeenCalledTimes(1);
    expect(archive.listEntries()).toEqual(['page01.jpg', 'page02.png']);

    const blob = await archive.extractEntryBlob('page02.png');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');

    // Second CBR open should reuse cached wasmBinary promise (fetch still called once)
    await sandbox.openClientArchive(rarBuf, 'test2.cbr');
    expect(sandbox.fetch).toHaveBeenCalledTimes(1);
  });
});
