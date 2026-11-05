const fs = require('fs');
const path = require('path');
const db = require('../../db');
const config = require('../../config');
const { ctLog } = require('../../logger');
const { THUMBNAILS_DIRECTORY } = require('../../constants');
const engineClient = require('./engine-client');
const taggerProcess = require('../tagger-process');
const libraryScan = require('../library-scan');
const libraryPages = require('../library-pages');
const persist = require('./persist');
const review = require('./review');
const companionSync = require('./companion-sync');
const fileRunState = require('./file-run-state');

const SUPPORTED_EXTENSIONS = new Set(['.cbz', '.cbr']);

class TaggerRunError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'TaggerRunError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function resolveThumbnailPath(fileName) {
  return path.isAbsolute(fileName) ? fileName : path.join(THUMBNAILS_DIRECTORY, fileName);
}

/**
 * Resolve a cover image Node can hand to the Python tagger for formats it
 * cannot open itself (CBR/RAR). Reuses the library thumbnail when present.
 */
async function resolveCoverPath({ comic, filePath }) {
  if (comic && comic.thumbnailPath) {
    const cached = resolveThumbnailPath(comic.thumbnailPath);
    if (fs.existsSync(cached)) return cached;
  }

  try {
    const generated = await libraryPages.generateThumbnail(filePath);
    if (generated) {
      const coverPath = resolveThumbnailPath(generated);
      if (fs.existsSync(coverPath)) return coverPath;
    }
  } catch (err) {
    ctLog(`⚠ Could not generate a cover for ${path.basename(filePath)}: ${err.message}`);
  }

  return null;
}

function buildTaggerRequest({ filePath, isCbr, forceReprocess, publisherCodex, coverPath }) {
  const request = {
    path: filePath,
    metadata_storage: isCbr ? 'sidecar' : config.getMetadataStorage(),
    comicvine_api_key: config.getComicVineApiKey(),
    google_books_api_key: config.getGoogleBooksApiKey(),
    metron_user: config.getMetronUser(),
    metron_pass: config.getMetronPassword(),
    gcd_user: typeof config.getGcdUser === 'function' ? config.getGcdUser() : '',
    gcd_pass: typeof config.getGcdPassword === 'function' ? config.getGcdPassword() : '',
    lower_threshold: config.getTaggerLowerThreshold(),
    upper_threshold: config.getTaggerUpperThreshold(),
    enabled_sources: config.getTaggerEnabledSources(),
    force_reprocess: Boolean(forceReprocess),
    publisher_codex: publisherCodex || []
  };

  if (isCbr && coverPath) {
    request.cover_path = coverPath;
  }

  return request;
}

async function loadPublisherCodex() {
  try {
    const rows = await db.dbAll(
      "SELECT DISTINCT publisher FROM comics WHERE publisher IS NOT NULL AND publisher != '' AND publisher != 'Unknown Publisher'"
    );
    return (rows || []).map(row => row.publisher).filter(Boolean);
  } catch (err) {
    return [];
  }
}

function assertCanRun(comic) {
  if (libraryScan.isScanning()) {
    throw new TaggerRunError('A library scan is running. Try again when it finishes.', 'library_scan_running', 409);
  }

  const pending = review.getPendingMatch();
  if (pending && pending.waitingForResponse) {
    throw new TaggerRunError('A tag match is awaiting review. Resolve it first.', 'review_pending', 409);
  }

  if (!fileRunState.beginFileRun({ comicId: comic.id, path: comic.path })) {
    throw new TaggerRunError('A tag search is already running.', 'file_tagger_running', 409);
  }
}

async function ensureWorker(serviceUrl) {
  if (await taggerProcess.isWorkerOnline(serviceUrl)) return;
  await taggerProcess.startTaggerWorker();
  if (!(await taggerProcess.isWorkerOnline(serviceUrl))) {
    throw new TaggerRunError('The tagger engine is offline.', 'tagger_offline', 503);
  }
}

function buildResultStatus(res, comic, publisherCodex, stats) {
  if (res.status === 'tagged') {
    return persist.recordTaggedComic(comic.path, comic.name, res, comic, publisherCodex, stats)
      .then(async ({ isSuccessful }) => {
        const companion = isSuccessful
          ? await companionSync.syncCompanionTag(comic.id)
          : null;
        return {
          status: 'tagged',
          matchedTitle: res.matched_title || null,
          confidence: res.confidence || null,
          isSuccessful,
          companion
        };
      });
  }

  if (res.status === 'review') {
    const reviewObj = review.buildReviewState(comic.name, comic.path, res.candidates, {
      source: 'file',
      comicId: comic.id,
      primaryMetadata: res.metadata || null
    });
    return Promise.resolve({
      status: 'review',
      confidence: res.confidence || null,
      matches: reviewObj.matches
    });
  }

  if (res.status === 'failed') {
    return persist.recordUnmatchedComic(comic.path, comic.name, comic, stats, true)
      .then(() => ({ status: 'failed', reason: res.reason || 'No match above threshold' }));
  }

  return Promise.resolve({ status: 'skipped', reason: res.reason || 'Already tagged' });
}

/**
 * Run an automated tag search for one comic, regardless of whether it lives in
 * the smart folder. Writes metadata and, after a successful tag, mirrors it to
 * the linked converted companion.
 */
async function runSingleFileTagger({ comicId, force = false } = {}) {
  if (!comicId) {
    throw new TaggerRunError('comicId is required.', 'invalid_comic_id', 400);
  }

  const comic = await db.dbGet(
    'SELECT id, path, name, thumbnailPath, originalPath, tagStatus, publisher, series FROM comics WHERE id = ?',
    [comicId]
  );
  if (!comic || !comic.path) {
    throw new TaggerRunError('Comic not found.', 'comic_not_found', 404);
  }

  const isCbr = path.extname(comic.path).toLowerCase() === '.cbr';
  if (!SUPPORTED_EXTENSIONS.has(path.extname(comic.path).toLowerCase())) {
    throw new TaggerRunError('Only CBZ and CBR files support tag search.', 'unsupported_format', 400);
  }

  if (!fs.existsSync(comic.path)) {
    throw new TaggerRunError('Comic file not found on disk.', 'file_not_found', 404);
  }

  assertCanRun(comic);

  try {
    const serviceUrl = config.getTaggerServiceUrl() || 'http://127.0.0.1:5000';
    await ensureWorker(serviceUrl);

    const publisherCodex = await loadPublisherCodex();
    const coverPath = isCbr ? await resolveCoverPath({ comic, filePath: comic.path }) : null;
    const request = buildTaggerRequest({
      filePath: comic.path,
      isCbr,
      forceReprocess: Boolean(force),
      publisherCodex,
      coverPath
    });

    ctLog(`Starting per-comic tag search: ${comic.name}${isCbr ? ' (CBR → sidecar)' : ''}`);

    let res;
    try {
      res = await engineClient.callTaggerEngineWithProgress(
        serviceUrl,
        request,
        undefined,
        (prog) => ctLog(`  ↳ [${prog.source || 'Search'}] ${prog.message || ''}`)
      );
    } catch (err) {
      throw new TaggerRunError(`Tagger engine error: ${err.message}`, 'tagger_engine_error', 502);
    }

    const stats = await fs.promises.stat(comic.path).catch(() => ({ mtimeMs: Date.now() }));
    return await buildResultStatus(res, comic, publisherCodex, stats);
  } finally {
    fileRunState.endFileRun();
  }
}

module.exports = {
  TaggerRunError,
  resolveCoverPath,
  buildTaggerRequest,
  runSingleFileTagger
};
