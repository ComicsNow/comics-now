const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const FIXTURES_DIR = __dirname;
const LIBRARY_DIR = path.join(FIXTURES_DIR, 'library');
const SCANNER_DIR = path.join(FIXTURES_DIR, 'scanner');

function createZip(filePath, xmlContent) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    if (xmlContent) {
      archive.append(xmlContent, { name: 'ComicInfo.xml' });
    }
    // Add two dummy image files for pages
    archive.append('dummy-image-data-1', { name: '001.jpg' });
    archive.append('dummy-image-data-2', { name: '002.jpg' });

    archive.finalize();
  });
}

const buildXml = (data) => {
  let xml = '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n';
  for (const [key, value] of Object.entries(data)) {
    xml += `  <${key}>${value}</${key}>\n`;
  }
  xml += '</ComicInfo>';
  return xml;
};

async function main() {
  console.log('Building test fixtures...');

  // Ensure directories exist
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  fs.mkdirSync(SCANNER_DIR, { recursive: true });
  fs.mkdirSync(path.join(FIXTURES_DIR, 'data', 'thumbnails'), { recursive: true });

  // 1. Create comics in library
  const batmanXml = buildXml({
    Title: 'Batman #1',
    Series: 'Batman',
    Number: '1',
    Publisher: 'DC Comics',
    Year: '1940',
    PageCount: '2'
  });
  await createZip(path.join(LIBRARY_DIR, 'batman_1.cbz'), batmanXml);

  const spidermanXml = buildXml({
    Title: 'Amazing Spider-Man #1',
    Series: 'Amazing Spider-Man',
    Number: '1',
    Publisher: 'Marvel Comics',
    Year: '1963',
    PageCount: '2'
  });
  await createZip(path.join(LIBRARY_DIR, 'spiderman_1.cbz'), spidermanXml);

  // 2. Create comics in scanner
  const successXml = buildXml({
    Title: 'Success Comic #1',
    Series: 'Success Series',
    Number: '1',
    Publisher: 'Success Publisher',
    Year: '2020',
    PageCount: '2'
  });
  await createZip(path.join(SCANNER_DIR, 'success_comic.cbz'), successXml);

  const failureXml = buildXml({
    Title: 'Failure Comic #1',
    Number: '1'
    // Missing Publisher and Series -> TagStatus will fail
  });
  await createZip(path.join(SCANNER_DIR, 'failure_comic.cbz'), failureXml);

  // No XML -> TagStatus will be pending
  await createZip(path.join(SCANNER_DIR, 'pending_comic.cbz'), null);

  console.log('Test fixtures created successfully!');
}

main().catch(err => {
  console.error('Failed to create fixtures:', err);
  process.exit(1);
});
