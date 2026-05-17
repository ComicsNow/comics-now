const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { listPages, getEntryBuffer } = require('./archive-utils');
const { log } = require('../logger');
const { createId, t0, ms } = require('../utils');
const { THUMBNAILS_DIRECTORY } = require('../constants');

async function extractPageBuffer(comicPath, pageName) {
  try {
    return await getEntryBuffer(comicPath, pageName);
  } catch (err) {
    log('ERROR', 'LIBRARY', `Failed to extract page ${pageName}: ${err.message}`);
    return null;
  }
}

async function getComicPages(comicPath) {
  try {
    return await listPages(comicPath);
  } catch (err) {
    log('ERROR', 'LIBRARY', `Failed to list pages for ${path.basename(comicPath)}: ${err.message}`);
    return [];
  }
}

async function generateThumbnail(comicPath) {
  const id = createId(comicPath);
  const filename = `${id}.jpg`;
  const full = path.join(THUMBNAILS_DIRECTORY, filename);
  if (fs.existsSync(full)) {
    log('INFO', 'THUMBNAIL', `Skip (exists): ${filename}`);
    return filename;
  }

  const start = t0();
  let pages;
  try {
    pages = await getComicPages(comicPath);
  } catch (error) {
    log('ERROR', 'THUMBNAIL', `Failed to read pages from ${path.basename(comicPath)}: ${error.message}`);
    return null;
  }
  if (!pages || pages.length === 0) {
    log('ERROR', 'THUMBNAIL', `No images found in ${path.basename(comicPath)}`);
    return null;
  }

  const firstPage = pages[0];
  const buffer = await extractPageBuffer(comicPath, firstPage);

  if (!buffer) {
    log('ERROR', 'THUMBNAIL', `Failed to extract first page ${firstPage} from ${path.basename(comicPath)}`);
    return null;
  }

  try {
    log('INFO', 'THUMBNAIL', `Create → ${filename} (first page: ${firstPage})`);
    await sharp(buffer)
      .resize({ height: 300, withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toFile(full);

    log('INFO', 'THUMBNAIL', `✅ Generated: ${filename} in ${ms(start)} ms`);
    return filename;
  } catch (err) {
    log('ERROR', 'THUMBNAIL', `❌ Sharp fail (${path.basename(comicPath)}): ${err.message} after ${ms(start)} ms`);
    return null;
  }
}

module.exports = {
  extractPageBuffer,
  getComicPages,
  generateThumbnail
};
