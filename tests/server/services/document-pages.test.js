const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { spawnSync } = require('child_process');

const { openEpubSession, getEpubCoverEntry, parseEpubOpfMetadata } = require('../../../server/services/document-pages/epub-reader');
const { openPdfSession } = require('../../../server/services/document-pages/pdf-reader');
const { listPages, getEntryBuffer, openArchiveSession } = require('../../../server/services/archive-utils');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function createZipFile(destPath, entries) {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 0 } });
    out.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(out);
    for (const [name, content] of entries) {
      archive.append(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), { name });
    }
    archive.finalize();
  });
}

function createMinimalPdf(destPath) {
  const py = path.join('/opt/comics-now/.venv/bin/python3');
  const script = `
import fitz, sys
doc = fitz.open()
for i in range(2):
    page = doc.new_page(width=200, height=300)
    page.insert_text((20, 40), f"Page {i+1}")
doc.set_metadata({"title": "Sample PDF Comic", "author": "Jane Writer", "subject": "Action"})
doc.save(sys.argv[1])
doc.close()
`;
  const res = spawnSync(py, ['-c', script, destPath], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`Failed to create test PDF: ${res.stderr}`);
  }
}

describe('document-pages (PDF & Comic EPUB)', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-now-docpages-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('epub-reader', () => {
    it('extracts ordered comic pages from OPF spine XHTML and reads cover + Dublin Core metadata', async () => {
      const epubPath = path.join(tmpDir, 'comic-spine.epub');
      await createZipFile(epubPath, [
        ['mimetype', 'application/epub+zip'],
        ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
        ['OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Cosmic Issue 1</dc:title>
    <dc:creator>Alex Artist</dc:creator>
    <dc:publisher>Indie Press</dc:publisher>
    <dc:date>2025-04-01</dc:date>
    <dc:description>First issue summary</dc:description>
    <dc:subject>Sci-Fi</dc:subject>
    <meta name="cover" content="cover-img"/>
    <meta name="calibre:series" content="Cosmic"/>
    <meta name="calibre:series_index" content="1"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="p1" href="text/p1.xhtml" media-type="application/xhtml+xml"/>
    <item id="p2" href="text/p2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img2" href="images/02.png" media-type="image/png"/>
    <item id="img1" href="images/01.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="p1"/>
    <itemref idref="p2"/>
  </spine>
</package>`],
        ['OEBPS/text/p1.xhtml', '<html><body><img src="../images/01.png"/></body></html>'],
        ['OEBPS/text/p2.xhtml', '<html><body><svg><image href="../images/02.png"/></svg></body></html>'],
        ['OEBPS/images/cover.png', TINY_PNG],
        ['OEBPS/images/01.png', TINY_PNG],
        ['OEBPS/images/02.png', TINY_PNG]
      ]);

      const session = await openEpubSession(epubPath);
      try {
        expect(session.pages).toEqual([
          'OEBPS/images/cover.png',
          'OEBPS/images/01.png',
          'OEBPS/images/02.png'
        ]);
        const buf = await session.readBuffer('OEBPS/images/01.png');
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.equals(TINY_PNG)).toBe(true);
      } finally {
        await session.close();
      }

      const cover = await getEpubCoverEntry(epubPath);
      expect(cover).toBe('OEBPS/images/cover.png');

      const meta = await parseEpubOpfMetadata(epubPath);
      expect(meta).toEqual(expect.objectContaining({
        title: 'Cosmic Issue 1',
        writer: 'Alex Artist',
        publisher: 'Indie Press',
        series: 'Cosmic',
        number: '1',
        year: 2025,
        month: 4
      }));
    });

    it('rejects pure-prose EPUB with no comic images', async () => {
      const prosePath = path.join(tmpDir, 'prose.epub');
      await createZipFile(prosePath, [
        ['mimetype', 'application/epub+zip'],
        ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>'],
        ['content.opf', '<?xml version="1.0"?><package><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>'],
        ['ch1.xhtml', '<html><body><p>Just prose text.</p></body></html>']
      ]);

      await expect(openEpubSession(prosePath)).rejects.toThrow(/No comic images found in EPUB/i);
    });
  });

  describe('pdf-reader & archive-utils integration', () => {
    it('lists virtual pages, renders page buffers, and reads metadata for .pdf', async () => {
      const pdfPath = path.join(tmpDir, 'sample-comic.pdf');
      createMinimalPdf(pdfPath);

      const session = await openPdfSession(pdfPath);
      try {
        expect(session.pages).toEqual(['page-0001.jpg', 'page-0002.jpg']);
        const buf = await session.readBuffer('page-0001.jpg');
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(100);
        expect(buf[0]).toBe(0xff);
        expect(buf[1]).toBe(0xd8);
      } finally {
        await session.close();
      }

      const pages = await listPages(pdfPath);
      expect(pages).toEqual(['page-0001.jpg', 'page-0002.jpg']);

      const page2 = await getEntryBuffer(pdfPath, 'page-0002.jpg');
      expect(page2[0]).toBe(0xff);
      expect(page2[1]).toBe(0xd8);

      const genericSession = await openArchiveSession(pdfPath);
      try {
        expect(genericSession.pages).toHaveLength(2);
      } finally {
        await genericSession.close();
      }
    });
  });
});
