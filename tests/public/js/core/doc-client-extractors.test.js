/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClientModule(relPath, extraSandbox = {}) {
  const fullPath = path.resolve(__dirname, '../../../../', relPath);
  const code = fs.readFileSync(fullPath, 'utf8')
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');

  const sandbox = {
    console,
    Blob,
    Uint8Array,
    ArrayBuffer,
    DOMParser,
    document,
    globalThis: {},
    ...extraSandbox
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

describe('Client PDF & EPUB Extractors', () => {
  test('openEpubClientArchive extracts ordered spine images and rejects pure-prose EPUBs', async () => {
    const { openEpubClientArchive } = loadClientModule('public/js/core/epub-client-extractor.js');

    const files = {
      'META-INF/container.xml': {
        dir: false,
        async: async () => '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
      },
      'OEBPS/content.opf': {
        dir: false,
        async: async () => `<?xml version="1.0"?>
<package>
  <metadata><meta name="cover" content="cov"/></metadata>
  <manifest>
    <item id="cov" href="img/cover.jpg" media-type="image/jpeg"/>
    <item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="p1"/></spine>
</package>`
      },
      'OEBPS/p1.xhtml': {
        dir: false,
        async: async () => '<html><body><img src="img/page1.png"/></body></html>'
      },
      'OEBPS/img/cover.jpg': { dir: false, async: async () => new Blob(['cov']) },
      'OEBPS/img/page1.png': { dir: false, async: async () => new Blob(['p1']) }
    };

    class MockJSZip {
      async loadAsync() {
        return { files, file: (n) => files[n] || null };
      }
    }

    const archive = await openEpubClientArchive(new ArrayBuffer(8), MockJSZip);
    expect(archive.type).toBe('epub');
    expect(archive.listEntries()).toEqual(['OEBPS/img/cover.jpg', 'OEBPS/img/page1.png']);
    expect(archive.getCoverEntryName()).toBe('OEBPS/img/cover.jpg');
    expect(await archive.getPageBlob('OEBPS/img/page1.png')).toBeInstanceOf(Blob);

    const proseFiles = {
      'OEBPS/ch1.xhtml': { dir: false, async: async () => '<html><body>Text</body></html>' }
    };
    class ProseJSZip {
      async loadAsync() {
        return { files: proseFiles, file: (n) => proseFiles[n] || null };
      }
    }
    await expect(openEpubClientArchive(new ArrayBuffer(8), ProseJSZip)).rejects.toThrow(/No comic images found in EPUB/i);
  });

  test('openPdfClientArchive lists virtual pages, renders canvas blob, and destroys document on close', async () => {
    const destroyMock = jest.fn();
    const cleanupMock = jest.fn();
    const mockPdfjs = {
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: jest.fn(() => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: jest.fn(async () => ({
            getViewport: ({ scale }) => ({ width: 200 * scale, height: 300 * scale }),
            render: () => ({ promise: Promise.resolve() }),
            cleanup: cleanupMock
          })),
          destroy: destroyMock
        })
      }))
    };

    const origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({}),
          toBlob: (cb) => cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }))
        };
      }
      return origCreateElement(tag);
    });

    try {
      const { openPdfClientArchive } = loadClientModule('public/js/core/pdf-client-extractor.js', {
        bundledPdfjs: mockPdfjs
      });

      const archive = await openPdfClientArchive(new ArrayBuffer(8));
      expect(mockPdfjs.GlobalWorkerOptions.workerSrc).toBe('./vendor/pdfjs/pdf.worker.mjs');
      expect(archive.listEntries()).toEqual(['page-0001.jpg', 'page-0002.jpg']);
      expect(archive.getCoverEntryName()).toBe('page-0001.jpg');

      const blob = await archive.getPageBlob('page-0002.jpg');
      expect(blob).toBeInstanceOf(Blob);
      expect(cleanupMock).toHaveBeenCalled();

      await expect(archive.getPageBlob('page-0009.jpg')).rejects.toThrow(/Page not found in PDF/i);
      archive.close();
      expect(destroyMock).toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });
});
