const fs = require('fs');
const path = require('path');
const { openArchive } = require('./archive-utils');
const yauzl = require('yauzl'); // yauzl still needed for writeComicInfoToCbz repacking logic
const xml2js = require('xml2js');
const archiver = require('archiver');
const crypto = require('crypto');
const { log } = require('../logger');
const { getMetadataStorage } = require('../config');
const { trimObjectStrings } = require('../utils');

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

async function getComicInfoFromArchive(comicPath) {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
  let archive;
  try {
    archive = await openArchive(comicPath);
    const entries = archive.listEntries();
    const infoEntry = entries.find(name => name.toLowerCase() === 'comicinfo.xml') ||
                      entries.find(name => path.basename(name).toLowerCase() === 'comicinfo.xml');
    
    if (infoEntry) {
      const buffer = await archive.readBuffer(infoEntry);
      const xml = buffer.toString('utf-8');
      try {
        const result = await parser.parseStringPromise(xml);
        return trimObjectStrings(result.ComicInfo || {});
      } catch {
        return {};
      }
    }
  } catch (err) {
    log('ERROR', 'META', `Failed to read ComicInfo.xml from ${path.basename(comicPath)}: ${err.message}`);
  } finally {
    if (archive) archive.close();
  }
  return {};
}

/**
 * Builds a ComicInfo.xml string from a metadata object
 * @param {object} metadataObj 
 * @returns {string|null} XML string or null if no valid metadata
 */
function buildComicInfoXml(metadataObj) {
  const safeObj = {};

  for (const [key, val] of Object.entries(metadataObj || {})) {
    const tag = COMICINFO_TAGS[key];
    if (!tag) continue;
    if (val == null || val === '') continue;

    safeObj[tag] = val;
  }

  if (Object.keys(safeObj).length === 0) {
    return null;
  }

  const builder = new xml2js.Builder({
    rootName: 'ComicInfo',
    xmldec: { version: '1.0', encoding: 'UTF-8' }
  });
  return builder.buildObject(safeObj);
}

async function getExistingComicInfoPath(cbzPath) {
  let archive;
  try {
    archive = await openArchive(cbzPath);
    const entries = archive.listEntries();
    const infoEntry = entries.find(name => name.toLowerCase() === 'comicinfo.xml') ||
                      entries.find(name => path.basename(name).toLowerCase() === 'comicinfo.xml');
    if (infoEntry) {
      return infoEntry;
    }
  } catch (err) {
    // ignore
  } finally {
    if (archive) archive.close();
  }
  return null;
}

function writeComicInfoNative(cbzPath, metadataXml) {
  const os = require('os');
  const { execFile } = require('child_process');

  return new Promise(async (resolve, reject) => {
    // Find if there is an existing ComicInfo.xml path (case-insensitive) in the ZIP
    const existingPath = await getExistingComicInfoPath(cbzPath);

    const tempDir = os.tmpdir();
    const uniqueSubDir = path.join(tempDir, `comicinfo-${crypto.randomBytes(8).toString('hex')}`);

    fs.mkdir(uniqueSubDir, { recursive: true }, (dirErr) => {
      if (dirErr) return reject(dirErr);

      const tempXmlPath = path.join(uniqueSubDir, 'ComicInfo.xml');

      fs.writeFile(tempXmlPath, metadataXml, 'utf8', (err) => {
        if (err) {
          fs.rm(uniqueSubDir, { recursive: true, force: true }, () => {});
          return reject(err);
        }

        const runZipAdd = () => {
          // -j ignores directory paths, storing ComicInfo.xml at the root
          execFile('zip', ['-j', cbzPath, tempXmlPath], (zipErr, stdout, stderr) => {
            // Clean up temp folder recursively
            fs.rm(uniqueSubDir, { recursive: true, force: true }, () => {});

            if (zipErr) {
              return reject(zipErr);
            }
            resolve();
          });
        };

        if (existingPath) {
          // Delete the existing entry first to prevent duplicate files with different casing/paths
          execFile('zip', ['-d', cbzPath, existingPath], (delErr) => {
            // Even if delete fails, try to add
            runZipAdd();
          });
        } else {
          runZipAdd();
        }
      });
    });
  });
}

async function writeComicInfoToCbz(cbzPath, metadataXml) {
  // Try native zip utility first for blistering speed (copies compressed streams in C)
  try {
    await writeComicInfoNative(cbzPath, metadataXml);
    log('INFO', 'META', `✅ Updated ComicInfo.xml in ${path.basename(cbzPath)} using native zip`);
    return;
  } catch (nativeErr) {
    log('INFO', 'META', `Native zip update failed/unavailable; falling back to JS repacking: ${nativeErr.message}`);
  }

  // Use a unique temporary filename to prevent race conditions and collisions
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const tempPath = cbzPath + '.tmp.' + randomSuffix;

  try {
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
          // Case-insensitive check for ComicInfo.xml anywhere in the path
          if (path.basename(entry.fileName).toLowerCase() === 'comicinfo.xml') {
            hasComicInfo = true;
            archive.append(metadataXml, { name: entry.fileName });
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
  } catch (err) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      await fs.promises.unlink(tempPath).catch(() => {});
    }
    throw err;
  }
}

async function saveMetadataToComic(comicPath, metadataObj) {
  const storageMode = getMetadataStorage();
  const ext = path.extname(comicPath).toLowerCase();

  if (storageMode === 'db' || ext === '.cbr') {
    log('INFO', 'META', `Metadata storage mode is DB-only or file is CBR; skipping disk write for ${path.basename(comicPath)}`);
    return;
  }

  try {
    log('INFO', 'META', `Writing ComicInfo.xml for ${path.basename(comicPath)}`);

    const metadataXml = buildComicInfoXml(trimObjectStrings(metadataObj));
    if (!metadataXml) {
      log('INFO', 'META', `No valid metadata for ${path.basename(comicPath)}; skipping save.`);
      return;
    }

    await writeComicInfoToCbz(comicPath, metadataXml);
    log('INFO', 'META', `✅ Saved ComicInfo.xml for ${path.basename(comicPath)}`);
  } catch (err) {
    log('ERROR', 'META', `ComicInfo write-back failed for ${path.basename(comicPath)}: ${err.message}`);
  }
}

module.exports = {
  COMICINFO_TAGS,
  getComicInfoFromArchive,
  saveMetadataToComic,
  writeComicInfoToCbz,
  buildComicInfoXml
};

