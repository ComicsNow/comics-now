const fs = require('fs');
const path = require('path');
const db = require('../../db');
const metadata = require('../metadata');
const { ctLog } = require('../../logger');
const { createId, getMimeFromExt } = require('../../utils');
const config = require('../../config');
const { getComicPages, extractPageBuffer } = require('../library-pages');
const { buildTaggedDbMeta, checkFileSuccess } = require('./persist');
const companionSync = require('./companion-sync');

let pendingMatchState = null;
let userChoiceResolver = null;
let waitingLogSeq = 0;

function getPendingMatch() {
  return pendingMatchState;
}

function setPendingMatch(val) {
  pendingMatchState = val;
}

function getUserChoiceResolver() {
  return userChoiceResolver;
}

function setUserChoiceResolver(fn) {
  userChoiceResolver = fn;
}

function clearReviewState(cancelled) {
  if (cancelled && pendingMatchState) {
    ctLog('⏸ Scan cancelled — pending match retained', { id: pendingMatchState.waitingLogId });
  } else {
    pendingMatchState = null;
  }
  userChoiceResolver = null;
}

function buildReviewState(entryName, filePath, resCandidates, options = {}) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  
  const formattedMatches = (resCandidates || []).map((c, index) => {
    const meta = c.metadata || {};
    const candidateTitle = meta.title || (meta.series ? `${meta.series} #${meta.number || meta.issue || '?'}` : 'Unknown Title');
    return {
      choice: String(index + 1),
      title: candidateTitle,
      year: meta.publish_date ? new Date(meta.publish_date).getFullYear().toString() : (meta.year || 'Unknown Year'),
      issue: meta.issue || meta.number || '?',
      publisher: meta.publisher || 'Unknown Publisher',
      extra: meta.description ? meta.description.substring(0, 150) + '...' : null,
      coverUrl: meta.cover_image_url || null,
      fullMetadata: meta,
      score: c.score,
      source: c.source
    };
  });

  for (const m of formattedMatches) {
    const isBlockedCover = !m.coverUrl || m.coverUrl.includes('comics.org');
    if (isBlockedCover) {
      const partner = formattedMatches.find(other =>
        other !== m &&
        other.coverUrl &&
        !other.coverUrl.includes('comics.org') &&
        other.fullMetadata?.series &&
        m.fullMetadata?.series &&
        other.fullMetadata.series.toLowerCase().trim() === m.fullMetadata.series.toLowerCase().trim()
      );
      if (partner) {
        m.coverUrl = partner.coverUrl;
      }
    }
  }

  const stateObj = {
    fileName: entryName,
    filePath: absolutePath,
    matches: formattedMatches,
    timestamp: new Date().toISOString(),
    waitingForResponse: true,
    isFinal: true,
    previewBuffer: null,
    previewMime: null,
    waitingLogId: `ct-wait-${++waitingLogSeq}`,
    origin: options.source || 'scan',
    comicId: options.comicId || null,
    primaryMetadata: options.primaryMetadata || null
  };

  pendingMatchState = stateObj;

  // Background extract and cache preview image
  (async () => {
    try {
      const pages = await getComicPages(absolutePath);
      if (pages && pages.length > 0) {
        const firstPage = pages[0];
        const buffer = await extractPageBuffer(absolutePath, firstPage);
        if (buffer && pendingMatchState && pendingMatchState.filePath === absolutePath) {
          pendingMatchState.previewBuffer = buffer;
          pendingMatchState.previewMime = getMimeFromExt(firstPage);
          ctLog(`ⓘ Cached preview image for: ${entryName}`);
        }
      }
    } catch (err) {}
  })();

  return stateObj;
}

async function applyUserSelection(selections, onScanComplete) {
  if (!pendingMatchState) {
    ctLog('⚠ ERROR: No tagger run waiting for user selection');
    throw new Error('No tagger run waiting for user selection');
  }

  const resolver = userChoiceResolver;
  const waitingLogId = pendingMatchState.waitingLogId;
  const choiceStr = selections[0] || '1';
  const match = pendingMatchState.matches.find(m => m.choice === choiceStr);
  if (!match) {
    ctLog(`⚠ ERROR: Selection #${choiceStr} not found in candidates list`);
    throw new Error(`Selection #${choiceStr} not found`);
  }

  ctLog(`✓ User selected candidate #${choiceStr}: ${match.title}`, { id: waitingLogId });
  
  const serviceUrl = config.getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  const filePath = pendingMatchState.filePath;
  const fileName = pendingMatchState.fileName;
  const reviewComicId = pendingMatchState.comicId || createId(filePath);
  const isCbr = path.extname(filePath).toLowerCase() === '.cbr';
  const effectiveStorage = isCbr ? 'sidecar' : config.getMetadataStorage();

  try {
    ctLog(`Applying tag via tagger engine...`);
    const fetchRes = await fetch(`${serviceUrl}/api/apply-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: filePath,
        metadata: match.fullMetadata,
        metadata_storage: effectiveStorage
      })
    });
    if (!fetchRes.ok) {
      const errText = await fetchRes.text();
      throw new Error(errText || `Status ${fetchRes.status}`);
    }
    
    // Update DB
    const isSuccessful = await checkFileSuccess(filePath);
    const tagStatus = isSuccessful ? 'successful' : 'failed';
    const newStats = await fs.promises.stat(filePath).catch(() => ({ mtimeMs: Date.now() }));
    
    const id = createId(filePath);
    let publisherCodex = [];
    try {
      const pubRows = await db.dbAll("SELECT DISTINCT publisher FROM comics WHERE publisher IS NOT NULL AND publisher != '' AND publisher != 'Unknown Publisher'");
      publisherCodex = (pubRows || []).map(r => r.publisher).filter(Boolean);
    } catch (e) {}

    let dbMetaStr = null;
    let rawPub = match.publisher || 'Unknown Publisher';
    let pub = metadata.normalizePublisher(rawPub, publisherCodex);
    let ser = match.title || 'Unknown Series';
    try {
      const info = await metadata.getComicInfoFromArchive(filePath);
      pub = metadata.normalizePublisher(info.Publisher || pub, publisherCodex);
      ser = info.Series || ser;
      let title = info.Title || '';
      if (title && (metadata.isTitleSameAsSeries(title, ser) || (!ser && metadata.isTitleSameAsSeries(title, '')))) {
        title = '';
      }
      const dbMeta = buildTaggedDbMeta(info, {
        title,
        series: info.Series || ser,
        number: info.Number || info.Volume || '',
        volume: info.Volume || '',
        publisher: pub
      });
      dbMetaStr = JSON.stringify(dbMeta);
    } catch (e) {}

    await db.dbRun(
      `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tagStatus = excluded.tagStatus,
         publisher = excluded.publisher,
         series = excluded.series,
         updatedAt = excluded.updatedAt,
         metadata = COALESCE(excluded.metadata, comics.metadata)`,
      [id, filePath, fileName, pub, ser, 'metadata', tagStatus, newStats.mtimeMs, dbMetaStr]
    );
    if (isSuccessful) {
      ctLog(`✓ SUCCESS → Tag applied and database updated for ${fileName}`);
      await companionSync.syncCompanionTag(reviewComicId);
    } else {
      ctLog(`⚠ WARNING → Tag applied but missing required tags in final file: ${fileName}`);
    }

    pendingMatchState = null;
    userChoiceResolver = null;

    if (typeof resolver === 'function') resolver('apply');

    if (typeof onScanComplete === 'function') {
      onScanComplete();
    }
  } catch (err) {
    ctLog(`✗ Failed to apply selection via tagger engine: ${err.message}`);
    if (typeof resolver === 'function') resolver('error');
    throw err;
  }
}

function skipCurrentMatch() {
  if (!pendingMatchState) {
    ctLog('⚠ ERROR: No tagger run waiting for user selection');
    throw new Error('No tagger run waiting for user selection');
  }

  const resolver = userChoiceResolver;
  const waitingLogId = pendingMatchState.waitingLogId;
  const filePath = pendingMatchState.filePath;
  const fileName = pendingMatchState.fileName;

  ctLog(`⊘ Skipped — recorded as unmatched: ${fileName}`, { id: waitingLogId });

  pendingMatchState = null;
  userChoiceResolver = null;

  const id = createId(filePath);
  return fs.promises.stat(filePath).catch(() => ({ mtimeMs: Date.now() })).then(currentStats => {
    return db.dbRun(
      `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tagStatus = excluded.tagStatus,
         updatedAt = excluded.updatedAt`,
      [id, filePath, fileName, 'Unknown Publisher', 'Unknown Series', 'metadata', 'failed', currentStats.mtimeMs]
    );
  }).then(() => {
    ctLog(`✓ Skip processed successfully in DB`);
    if (typeof resolver === 'function') resolver('skip');
  }).catch((err) => {
    ctLog(`✗ Failed to record skip in DB: ${err.message}`);
    if (typeof resolver === 'function') resolver('skip');
  });
}

module.exports = {
  getPendingMatch,
  setPendingMatch,
  getUserChoiceResolver,
  setUserChoiceResolver,
  clearReviewState,
  buildReviewState,
  applyUserSelection,
  skipCurrentMatch
};
