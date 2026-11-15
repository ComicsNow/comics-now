const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { convertEpubToCbz } = require('../../../server/services/library-conversion');
const { openArchiveSession } = require('../../../server/services/archive-utils');

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

describe('convertEpubToCbz', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-now-epub-conv-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('converts an image comic EPUB to CBZ and keeps original when deleteOriginals=false', async () => {
    const epubPath = path.join(tmpDir, 'issue-01.epub');
    await createZipFile(epubPath, [
      ['mimetype', 'application/epub+zip'],
      ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>'],
      ['content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Issue 1</dc:title><dc:creator>Writer</dc:creator></metadata><manifest><item id="i1" href="p1.png" media-type="image/png"/><item id="i2" href="p2.png" media-type="image/png"/></manifest><spine><itemref idref="i1"/><itemref idref="i2"/></spine></package>`],
      ['p1.png', TINY_PNG],
      ['p2.png', TINY_PNG]
    ]);

    const cbzPath = await convertEpubToCbz(epubPath, { deleteOriginals: false });
    expect(cbzPath).toBe(path.join(tmpDir, 'issue-01.cbz'));
    expect(fs.existsSync(cbzPath)).toBe(true);
    expect(fs.existsSync(epubPath)).toBe(true);

    const session = await openArchiveSession(cbzPath);
    try {
      expect(session.pages).toHaveLength(2);
    } finally {
      await session.close();
    }
  });

  it('deletes original EPUB when deleteOriginals=true and CBZ creation succeeds', async () => {
    const epubPath = path.join(tmpDir, 'issue-02.epub');
    await createZipFile(epubPath, [
      ['mimetype', 'application/epub+zip'],
      ['p1.png', TINY_PNG]
    ]);

    const cbzPath = await convertEpubToCbz(epubPath, { deleteOriginals: true });
    expect(cbzPath).toBe(path.join(tmpDir, 'issue-02.cbz'));
    expect(fs.existsSync(cbzPath)).toBe(true);
    expect(fs.existsSync(epubPath)).toBe(false);
  });

  it('fails cleanly without deleting original if EPUB has no comic images', async () => {
    const epubPath = path.join(tmpDir, 'prose-only.epub');
    await createZipFile(epubPath, [
      ['mimetype', 'application/epub+zip'],
      ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>'],
      ['content.opf', '<?xml version="1.0"?><package><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'],
      ['c1.xhtml', '<html><body><p>Text only</p></body></html>']
    ]);

    const cbzPath = await convertEpubToCbz(epubPath, { deleteOriginals: true });
    expect(cbzPath).toBeNull();
    expect(fs.existsSync(epubPath)).toBe(true);
  });
});
