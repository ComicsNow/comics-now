const fs = require('fs');
const path = require('path');
const { dbGet, dbRun } = require('../../db');
const { log } = require('../../logger');
const { getConfig, getAutoConvertEnabled, getAutoConvertFormats } = require('../../config');
const { getComicInfoFromArchive } = require('../metadata');
const { createId } = require('../../utils');
const { THUMBNAILS_DIRECTORY } = require('../../constants');
const { convertCbrToCbz, convertPdfToCbz, convertEpubToCbz } = require('../library-conversion');
const { getComicPages, generateThumbnail } = require('../library-pages');
const { generateVirtualMetadata } = require('../library-metadata');
const { isComicFormatAllowed } = require('../comic-formats');
const { resolveLiveLinkedCbz, resolveOriginalLink } = require('./original-links');
const { reconcileGuidedView } = require('./guided-reconcile');

const CONVERTERS = {
  '.cbr': convertCbrToCbz,
  '.pdf': convertPdfToCbz,
  '.epub': convertEpubToCbz
};

async function maybeConvertFile(filePath, ext, ctx) {
  const converter = CONVERTERS[ext];
  if (!converter) return { filePath, wasConverted: false, originalSourcePath: null, skip: false };

  const autoEnabled = ctx.autoConvertEnabled !== undefined
    ? Boolean(ctx.autoConvertEnabled)
    : (typeof getAutoConvertEnabled === 'function' ? getAutoConvertEnabled() : false);
  const autoFormats = Array.isArray(ctx.autoConvertFormats)
    ? ctx.autoConvertFormats
    : (typeof getAutoConvertFormats === 'function' ? getAutoConvertFormats() : []);
  const fmt = ext.slice(1);

  if (!autoEnabled || !autoFormats.includes(fmt)) {
    return { filePath, wasConverted: false, originalSourcePath: null, skip: false };
  }

  if (!ctx.conversionRoot || !path.resolve(filePath).startsWith(ctx.conversionRoot)) {
    return { filePath, wasConverted: false, originalSourcePath: null, skip: false };
  }

  if (resolveLiveLinkedCbz(ctx.originalLinks, filePath)) {
    log('INFO', 'SCAN', `Skipping conversion (linked CBZ exists): ${path.basename(filePath)}`);
    return { filePath, wasConverted: false, originalSourcePath: null, skip: true };
  }

  const siblingCbz = filePath.replace(/\.(cbr|pdf|epub)$/i, '.cbz');
  if (fs.existsSync(siblingCbz)) {
    return { filePath, wasConverted: false, originalSourcePath: null, skip: true };
  }

  log('INFO', 'SCAN', `Auto-convert needed (${fmt.toUpperCase()} -> CBZ): ${path.basename(filePath)}`);
  const newCbz = await converter(filePath);
  if (newCbz) {
    ctx.stats.totalConverted++;
    return { filePath: newCbz, wasConverted: true, originalSourcePath: filePath, skip: false };
  }

  ctx.stats.errors++;
  return { filePath, wasConverted: false, originalSourcePath: null, skip: true };
}

async function processScannedFile({
  filePath: initialPath,
  stats,
  dirModified,
  libraryMode,
  libraryRootPath,
  ctx,
  normalizeComicMetadata
}) {
  let filePath = initialPath;
  const ext = path.extname(filePath).toLowerCase();

  if (!dirModified) {
    if (['.cbz', '.cbr', '.pdf', '.epub'].includes(ext) && isComicFormatAllowed(filePath, ctx.allowedFormats)) {
      ctx.fileSystemComics.add(filePath);
    }
    return;
  }

  if (!['.cbz', '.cbr', '.pdf', '.epub'].includes(ext)) return;

  try {
    const conv = await maybeConvertFile(filePath, ext, ctx);
    if (conv.skip) return;
    filePath = conv.filePath;
    const wasConverted = conv.wasConverted;
    const originalSourcePath = conv.originalSourcePath;

    if (!isComicFormatAllowed(filePath, ctx.allowedFormats)) {
      return;
    }

    ctx.fileSystemComics.add(filePath);
    const id = createId(filePath);
    const existing = await dbGet(
      'SELECT updatedAt, thumbnailPath, metadata, lastReadPage, totalPages, convertedAt, originalPath, guidedViewStatus, guidedViewPath, guidedViewError, tagStatus FROM comics WHERE id = ?',
      [id]
    );
    const hasValidThumbnail = Boolean(
      existing?.thumbnailPath && fs.existsSync(path.join(THUMBNAILS_DIRECTORY, existing.thumbnailPath))
    );

    if (!ctx.force && !wasConverted && existing && existing.updatedAt === stats.mtimeMs && hasValidThumbnail) {
      return;
    }

    ctx.stats.totalSeen++;
    log('INFO', 'SCAN', `📄 Processing: ${path.basename(filePath)} (${libraryMode} mode)`);
    const lastReadPage = existing?.lastReadPage || 0;
    let totalPages = existing?.totalPages || 0;
    const convertedAt = wasConverted ? Date.now() : (existing?.convertedAt || null);
    const originalPath = resolveOriginalLink({
      wasConverted,
      sourcePath: originalSourcePath,
      existingOriginalPath: existing?.originalPath || null
    });

    const { guidedViewStatus, guidedViewPath, guidedViewError } = await reconcileGuidedView(
      id,
      filePath,
      existing,
      ctx.dbComicsMap
    );

    let thumbnailPath;
    try {
      thumbnailPath = await generateThumbnail(filePath);
      if (thumbnailPath) ctx.stats.thumbOk++;
      else ctx.stats.thumbFail++;
    } catch (e) {
      ctx.stats.thumbFail++;
      throw e;
    }

    const configObj = getConfig();
    const comicsLocation = configObj.comicsLocation;
    const isInboxFile = comicsLocation && filePath.startsWith(comicsLocation);
    const effectiveLibraryMode = isInboxFile ? 'metadata' : libraryMode;

    let info;
    if (effectiveLibraryMode === 'folder') {
      info = generateVirtualMetadata(filePath, libraryRootPath);
    } else {
      info = await getComicInfoFromArchive(filePath);
      const storageMode = configObj.metadata_storage || 'sidecar';
      const finalExt = path.extname(filePath).toLowerCase();
      if ((storageMode === 'db' || storageMode === 'sidecar' || finalExt !== '.cbz') && (!info || Object.keys(info).length === 0)) {
        if (existing?.metadata) {
          try {
            info = JSON.parse(existing.metadata);
            log('INFO', 'SCAN', `Preserving DB-only metadata for ${finalExt.toUpperCase()}: ${path.basename(filePath)}`);
          } catch {
            info = {};
          }
        }
      }
    }

    const { info: cleanInfo, series, publisher } = normalizeComicMetadata(info);
    const fileStats = wasConverted ? await fs.promises.stat(filePath) : stats;

    try {
      const pages = await getComicPages(filePath);
      if (pages.length > 0) totalPages = pages.length;
    } catch {}

    let tagStatus = wasConverted ? 'pending' : (existing?.tagStatus || 'pending');
    if (effectiveLibraryMode !== 'folder') {
      const hasSeries = ((cleanInfo.Series || '').toString().trim().length > 0) || ((cleanInfo.Title || '').toString().trim().length > 0);
      const hasPublisher = (cleanInfo.Publisher || '').toString().trim().length > 0;
      const hasDate = (cleanInfo.Year || cleanInfo.CoverDate || cleanInfo.StoreDate || cleanInfo['Cover Date'] || cleanInfo['Store Date'] || '').toString().trim().length > 0;
      const hasNumber = (cleanInfo.Number || cleanInfo.Volume || '').toString().trim().length > 0;

      if (hasSeries && hasPublisher && hasDate && hasNumber) {
        tagStatus = 'successful';
      } else {
        tagStatus = wasConverted ? 'pending' : (existing?.tagStatus || 'pending');
      }
    }

    await dbRun(
      `INSERT OR REPLACE INTO comics (id, path, thumbnailPath, updatedAt, name, series, publisher, metadata, lastReadPage, totalPages, convertedAt, originalPath, guidedViewStatus, guidedViewPath, guidedViewError, libraryMode, tagStatus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        filePath,
        thumbnailPath,
        fileStats.mtimeMs,
        path.basename(filePath),
        series,
        publisher,
        JSON.stringify(cleanInfo),
        lastReadPage,
        totalPages,
        convertedAt,
        originalPath,
        guidedViewStatus,
        guidedViewPath,
        guidedViewError,
        effectiveLibraryMode,
        tagStatus
      ]
    );
    ctx.stats.totalInsertedOrUpdated++;
    if (!existing && guidedViewStatus === 'pending') {
      ctx.newComicIds.push(id);
    }
  } catch (e) {
    ctx.stats.errors++;
    log('ERROR', 'SCAN', `Failed to process ${path.basename(filePath)}: ${e.message}`);
  }
}

module.exports = {
  maybeConvertFile,
  processScannedFile
};
