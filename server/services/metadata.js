const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const xml2js = require('xml2js');
const archiver = require('archiver');
const { log } = require('../logger');

const COMICINFO_TAGS = {
  Title: 'Title',
  Series: 'Series',
  Number: 'Number',
  Count: 'Count',
  Volume: 'Volume',
  Summary: 'Summary',
  Notes: 'Notes',
  Year: 'Year',
  Month: 'Month',
  Day: 'Day',
  Writer: 'Writer',
  Penciller: 'Penciller',
  Inker: 'Inker',
  Colorist: 'Colorist',
  Letterer: 'Letterer',
  CoverArtist: 'CoverArtist',
  Editor: 'Editor',
  Publisher: 'Publisher',
  Genre: 'Genre',
  Tags: 'Tags',
  Web: 'Web',
  PageCount: 'PageCount',
  LanguageISO: 'LanguageISO',
  Format: 'Format',
  BlackAndWhite: 'BlackAndWhite',
  AgeRating: 'AgeRating',
  Characters: 'Characters',
  Teams: 'Teams',
  Locations: 'Locations',
  ScanInformation: 'ScanInformation',
  SeriesGroup: 'SeriesGroup',
  StoryArc: 'StoryArc',
  'Cover Date': 'CoverDate',
  'Store Date': 'StoreDate',
  StartYear: 'Year'
};

async function getComicInfoFromZip(comicPath) {
  return new Promise((resolve) => {
    yauzl.open(comicPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return resolve({});
      let found = false;
      zipfile.readEntry();
      zipfile.on('entry', entry => {
        if (entry.fileName.toLowerCase() === 'comicinfo.xml') {
          found = true;
          zipfile.openReadStream(entry, (e, rs) => {
            if (e) { zipfile.close(); return resolve({}); }
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', async () => {
              zipfile.close();
              try {
                const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
                const result = await parser.parseStringPromise(Buffer.concat(chunks).toString('utf-8'));
                resolve(result.ComicInfo || {});
              } catch {
                resolve({});
              }
            });
          });
        } else zipfile.readEntry();
      });
      zipfile.on('end', () => { if (!found) resolve({}); });
      zipfile.on('error', () => resolve({}));
    });
  });
}

async function writeComicInfoToCbz(cbzPath, metadataXml) {
  const tempPath = cbzPath + '.tmp';

  await new Promise((resolve, reject) => {
    yauzl.open(cbzPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      const output = fs.createWriteStream(tempPath);
      const archive = archiver('zip', { zlib: { level: 9 }, forceZip64: true });

      let hasComicInfo = false;

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName === 'ComicInfo.xml') {
          hasComicInfo = true;
          archive.append(metadataXml, { name: 'ComicInfo.xml' });
          zipfile.readEntry();
        } else if (entry.fileName.endsWith('/')) {
          archive.append(null, { name: entry.fileName });
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (e, readStream) => {
            if (e) return reject(e);
            archive.append(readStream, { name: entry.fileName });
            readStream.on('end', () => zipfile.readEntry());
          });
        }
      });

      zipfile.on('end', () => {
        if (!hasComicInfo) {
          archive.append(metadataXml, { name: 'ComicInfo.xml' });
        }
        zipfile.close();
        archive.finalize();
      });

      zipfile.on('error', reject);
    });
  });

  await fs.promises.rename(tempPath, cbzPath);
  log('INFO', 'META', `✅ Updated ComicInfo.xml in ${path.basename(cbzPath)}`);
}

async function saveMetadataToComic(cbzPath, metadataObj) {
  try {
    log('INFO', 'META', `Writing ComicInfo.xml for ${path.basename(cbzPath)}`);

    const safeObj = {};

    for (const [key, val] of Object.entries(metadataObj || {})) {
      const tag = COMICINFO_TAGS[key];
      if (!tag) continue;
      if (val == null || val === '') continue;

      safeObj[tag] = val;
    }

    if (Object.keys(safeObj).length === 0) {
      log('INFO', 'META', `No valid metadata for ${path.basename(cbzPath)}; skipping save.`);
      return;
    }

    const builder = new xml2js.Builder({
      rootName: 'ComicInfo',
      xmldec: { version: '1.0', encoding: 'UTF-8' }
    });
    const metadataXml = builder.buildObject(safeObj);

    await writeComicInfoToCbz(cbzPath, metadataXml);

    log('INFO', 'META', `✅ Saved ComicInfo.xml for ${path.basename(cbzPath)}`);
  } catch (err) {
    log('ERROR', 'META', `ComicInfo write-back failed for ${path.basename(cbzPath)}: ${err.message}`);
  }
}

module.exports = {
  COMICINFO_TAGS,
  getComicInfoFromZip,
  saveMetadataToComic,
  writeComicInfoToCbz
};
