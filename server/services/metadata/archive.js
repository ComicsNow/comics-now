const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const yauzl = require('yauzl');
const xml2js = require('xml2js');
const archiver = require('archiver');
const crypto = require('crypto');
const { openArchive } = require('../archive-utils');
const { log } = require('../../logger');
const { getMetadataStorage } = require('../../config');
const { trimObjectStrings } = require('../../utils');
const { cleanGenreAndTags, isTitleSameAsSeries } = require('./sanitizer');
const { buildComicInfoXml } = require('./enricher');

async function getComicInfoFromArchive(comicPath) {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

  // 1. Check for adjacent sidecar ComicInfo.xml first
  const ext = path.extname(comicPath);
  const sidecarPath = path.join(path.dirname(comicPath), path.basename(comicPath, ext) + '.ComicInfo.xml');

  if (fs.existsSync(sidecarPath)) {
    try {
      const xml = await fs.promises.readFile(sidecarPath, 'utf-8');
      const result = await parser.parseStringPromise(xml);
      log('INFO', 'META', `📄 Read ComicInfo.xml metadata from sidecar for ${path.basename(comicPath)}`);
      const info = trimObjectStrings(result.ComicInfo || {});
      if (info.Title && (isTitleSameAsSeries(info.Title, info.Series) || (!info.Series && isTitleSameAsSeries(info.Title, '')))) {
        info.Title = '';
      }
      if (info.Genre) {
        const cg = cleanGenreAndTags(info.Genre);
        if (cg) info.Genre = cg;
        else delete info.Genre;
      }
      if (info.Tags) {
        const ct = cleanGenreAndTags(info.Tags);
        if (ct) info.Tags = ct;
        else delete info.Tags;
      }
      return info;
    } catch (err) {
      log('ERROR', 'META', `Failed to read ComicInfo.xml sidecar from ${path.basename(sidecarPath)}: ${err.message}`);
    }
  }

  // 2. Fallback to reading from Zip archive
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
        const info = trimObjectStrings(result.ComicInfo || {});
        if (info.Title && (isTitleSameAsSeries(info.Title, info.Series) || (!info.Series && isTitleSameAsSeries(info.Title, '')))) {
          info.Title = '';
        }
        if (info.Genre) {
          const cg = cleanGenreAndTags(info.Genre);
          if (cg) info.Genre = cg;
          else delete info.Genre;
        }
        if (info.Tags) {
          const ct = cleanGenreAndTags(info.Tags);
          if (ct) info.Tags = ct;
          else delete info.Tags;
        }
        return info;
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
  } catch {
    // ignore
  } finally {
    if (archive) archive.close();
  }
  return null;
}

function writeComicInfoNative(cbzPath, metadataXml) {
  return new Promise(async (resolve, reject) => {
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
          execFile('zip', ['-j', '--', cbzPath, tempXmlPath], (zipErr) => {
            fs.rm(uniqueSubDir, { recursive: true, force: true }, () => {});

            if (zipErr) {
              return reject(zipErr);
            }
            resolve();
          });
        };

        if (existingPath) {
          execFile('zip', ['-d', '--', cbzPath, existingPath], () => {
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
  try {
    await writeComicInfoNative(cbzPath, metadataXml);
    log('INFO', 'META', `✅ Updated ComicInfo.xml in ${path.basename(cbzPath)} using native zip`);
    return;
  } catch (nativeErr) {
    log('INFO', 'META', `Native zip update failed/unavailable; falling back to JS repacking: ${nativeErr.message}`);
  }

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
    if (fs.existsSync(tempPath)) {
      await fs.promises.unlink(tempPath).catch(() => {});
    }
    throw err;
  }
}

function createSaveMetadataToComic(getWriter) {
  return async function saveMetadataToComic(comicPath, metadataObj, options = {}) {
    const storageMode = getMetadataStorage();
    const ext = path.extname(comicPath).toLowerCase();

    if (storageMode === 'db') {
      log('INFO', 'META', `Metadata storage mode is DB-only; skipping disk write for ${path.basename(comicPath)}`);
      return;
    }

    try {
      log('INFO', 'META', `Writing ComicInfo.xml for ${path.basename(comicPath)}`);

      const metadataXml = buildComicInfoXml(trimObjectStrings(metadataObj), options);
      if (!metadataXml) {
        log('INFO', 'META', `No valid metadata for ${path.basename(comicPath)}; skipping save.`);
        return;
      }

      if (storageMode === 'sidecar') {
        const sidecarPath = path.join(path.dirname(comicPath), path.basename(comicPath, ext) + '.ComicInfo.xml');
        await fs.promises.writeFile(sidecarPath, metadataXml, 'utf-8');
        log('INFO', 'META', `✅ Saved ComicInfo.xml sidecar for ${path.basename(comicPath)}`);
      } else {
        if (ext === '.cbr') {
          log('INFO', 'META', `File is CBR; skipping internal ZIP write and fallback to DB-only for ${path.basename(comicPath)}`);
          return;
        }
        const writer = typeof getWriter === 'function' ? getWriter() : writeComicInfoToCbz;
        await writer(comicPath, metadataXml);
        log('INFO', 'META', `✅ Saved ComicInfo.xml internally in ${path.basename(comicPath)}`);
      }
    } catch (err) {
      log('ERROR', 'META', `ComicInfo write-back failed for ${path.basename(comicPath)}: ${err.message}`);
    }
  };
}

module.exports = {
  getComicInfoFromArchive,
  writeComicInfoToCbz,
  createSaveMetadataToComic
};
