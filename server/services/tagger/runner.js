const fs = require('fs');
const path = require('path');
const db = require('../../db');
const config = require('../../config');
const { ctLog } = require('../../logger');
const { createId } = require('../../utils');
const taggerProcess = require('../tagger-process');
const { scanLibrary } = require('../library-scan');
const persist = require('./persist');
const engineClient = require('./engine-client');
const { resolveScanMode, evaluateFileGates } = require('./gates');
const review = require('./review');
const companionSync = require('./companion-sync');
const fileRunState = require('./file-run-state');
const { resolveCoverPath, buildTaggerRequest } = require('./single-file');

let ctInterval = null;
let ctRunning = false;
let ctCancelled = false;
let ctAbortController = null;

function isTaggerRunning() {
  return ctRunning;
}

function cancelComicTagger() {
  if (!ctRunning) return false;
  ctCancelled = true;
  if (ctAbortController) {
    try { ctAbortController.abort(); } catch (e) {}
  }
  const resolver = review.getUserChoiceResolver();
  if (resolver) {
    resolver('scan_cancelled');
  }
  ctLog('🛑 Scan cancellation requested by user...');
  return true;
}

function scheduleCtRun() {
  if (ctInterval) clearInterval(ctInterval);
  const minutes = config.getConfig().ctScheduleMinutes;
  if (minutes > 0) {
    ctInterval = setInterval(() => {
      runComicTagger();
    }, minutes * 60 * 1000);
  }
}

async function runComicTagger(options = {}) {
  if (ctRunning) {
    ctLog('Tagger already running.');
    return;
  }
  const pendingReview = review.getPendingMatch();
  if (fileRunState.isFileTaggerRunning() || (pendingReview && pendingReview.waitingForResponse)) {
    ctLog('Tagger already running.');
    return;
  }
  ctRunning = true;
  ctCancelled = false;
  ctAbortController = new AbortController();
  const mode = resolveScanMode(options);
  const forceReprocess = (mode !== 'default');
  const scanStartTime = Date.now();

  try {
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const headerSuffix = mode === 'unmatched'
      ? ' (🔁 Rescan Unmatched — comics previously marked no-match)'
      : (mode === 'existing-xml'
        ? ' (⚡ Force Re-Scan — comics with existing ComicInfo.xml)'
        : (mode === 'force' ? ' (⚡ Force Re-Scan: Existing ComicInfo.xml will be re-scanned)' : ''));
    ctLog(`Starting Tag Comics Now library scan...${headerSuffix}`);
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const serviceUrl = config.getTaggerServiceUrl() || 'http://127.0.0.1:5000';

    if (!(await taggerProcess.isWorkerOnline(serviceUrl))) {
      ctLog(`Internal tagger worker is offline, attempting start...`);
      await taggerProcess.startTaggerWorker();
    }

    try {
      const healthRes = await fetch(`${serviceUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (!healthRes.ok) throw new Error(`Status ${healthRes.status}`);
      const health = await healthRes.json();
      ctLog(`✓ Tagger engine is online. Version: ${health.version || '1.0'}`);
    } catch (err) {
      ctLog(`✗ ERROR: Tagger engine is offline or unreachable: ${err.message}`);
      return;
    }

    const appConfig = config.getConfig();
    const dir = appConfig.comicsLocation;
    if (!dir || !fs.existsSync(dir)) {
      ctLog(`✗ Comics directory does not exist: ${dir}`);
      return;
    }

    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const allowedFormats = appConfig.allowed_formats || 'cbz';
    const comicFiles = entries.filter(e => {
      if (!e.isFile()) return false;
      const ext = path.extname(e.name).toLowerCase();
      if (ext === '.cbz') return allowedFormats === 'cbz' || allowedFormats === 'both';
      if (ext === '.cbr') return allowedFormats === 'cbr' || allowedFormats === 'both';
      return false;
    });

    if (comicFiles.length === 0) {
      ctLog(`ⓘ No supported comic files found to process (Allowed: ${allowedFormats})`);
      return;
    }

    const totalFiles = comicFiles.length;
    ctLog(`ⓘ Found ${totalFiles} comic file(s) in smart folder`);
    ctLog('');

    let hasChanges = false;
    let fileIndex = 0;
    let taggedCount = 0;
    let reviewCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const itemDurations = [];
    const failedDbUpdates = [];

    let publisherCodex = [];
    try {
      const pubRows = await db.dbAll("SELECT DISTINCT publisher FROM comics WHERE publisher IS NOT NULL AND publisher != '' AND publisher != 'Unknown Publisher'");
      publisherCodex = (pubRows || []).map(r => r.publisher).filter(Boolean);
    } catch (e) {}

    for (const entry of comicFiles) {
      if (ctCancelled) {
        ctLog('🛑 Scan cancelled by user.');
        break;
      }
      fileIndex++;
      const itemStart = Date.now();
      const filePath = path.join(dir, entry.name);
      const isCbr = path.extname(entry.name).toLowerCase() === '.cbr';
      const id = createId(filePath);

      let stats;
      try {
        stats = await fs.promises.stat(filePath);
      } catch (e) {
        continue;
      }

      const existing = await db.dbGet(
        'SELECT id, updatedAt, tagStatus, metadata, series, publisher, thumbnailPath, originalPath FROM comics WHERE id = ?',
        [id]
      );
      const comicId = existing?.id || id;

      const gateResult = await evaluateFileGates(filePath, entry.name, stats, existing, mode, publisherCodex);
      if (gateResult.skip) {
        skippedCount++;
        itemDurations.push(Date.now() - itemStart);
        if (gateResult.reason) ctLog(gateResult.reason);
        continue;
      }

      const percent = Math.round(((fileIndex - 1) / totalFiles) * 100);
      let etaStr = '';
      if (itemDurations.length > 0) {
        const avgItemMs = itemDurations.reduce((a, b) => a + b, 0) / itemDurations.length;
        const remainingItems = totalFiles - (fileIndex - 1);
        etaStr = ` | Est. remaining: ~${formatDuration(remainingItems * avgItemMs)}`;
      }

      ctLog(`─────────────────────────────────────────`);
      ctLog(`[${fileIndex}/${totalFiles}] Processing: ${entry.name} (${percent}% complete${etaStr})`);
      
      const coverPath = isCbr ? await resolveCoverPath({ comic: existing, filePath }) : null;
      const request = buildTaggerRequest({
        filePath,
        isCbr,
        forceReprocess,
        publisherCodex,
        coverPath
      });

      let res;
      try {
        res = await engineClient.callTaggerEngineWithProgress(
          serviceUrl,
          request,
          ctAbortController ? ctAbortController.signal : undefined,
          (prog) => {
            const srcLabel = prog.source || 'Search';
            const msg = prog.message || '';
            ctLog(`  ↳ [${srcLabel}] ${msg}`);
          }
        );
      } catch (err) {
        if (ctCancelled || err.name === 'AbortError') {
          ctLog(`🛑 Processing aborted for ${entry.name}`);
          break;
        }
        ctLog(`✗ Error calling tagger engine for ${entry.name}: ${err.message}`);
        failedCount++;
        failedDbUpdates.push([id, filePath, entry.name, existing?.publisher || 'Unknown Publisher', existing?.series || 'Unknown Series', 'metadata', 'failed', null]);
        itemDurations.push(Date.now() - itemStart);
        continue;
      }

      if (res.status === 'tagged') {
        try {
          const newStats = await fs.promises.stat(filePath).catch(() => stats);
          const { isSuccessful } = await persist.recordTaggedComic(filePath, entry.name, res, existing, publisherCodex, newStats);
          if (isSuccessful) {
            taggedCount++;
            ctLog(`✓ SUCCESS → Auto-tagged: ${res.matched_title || entry.name} (${res.confidence || 100}% confidence)`);
            await companionSync.syncCompanionTag(comicId);
          } else {
            failedCount++;
            ctLog(`⚠ WARNING → Auto-tagged file but missing required fields in final file (marked failed): ${entry.name}`);
          }
          hasChanges = true;
        } catch (err) {
          ctLog(`✗ Failed to update database status: ${err.message}`);
        }
      } else if (res.status === 'review') {
        reviewCount++;
        ctLog(`ⓘ Review required for: ${entry.name} (Confidence: ${res.confidence}%)`);
        
        const reviewObj = review.buildReviewState(entry.name, filePath, res.candidates, {
          source: 'scan',
          comicId
        });

        const choicePromise = new Promise((resolveChoice) => {
          review.setUserChoiceResolver(resolveChoice);
        });

        ctLog(`>>> WAITING FOR USER SELECTION (Found ${reviewObj.matches.length} candidates)`, { id: reviewObj.waitingLogId });
        
        await new Promise((resolveLoop) => {
          choicePromise.then(async (action) => {
            if (action === 'apply') {
              hasChanges = true;
            }
            resolveLoop();
          }).catch((err) => {
            ctLog(`✗ Error in selection promise: ${err.message}`);
            resolveLoop();
          });
        });
      } else {
        if (res.status === 'failed') {
          failedCount++;
        } else {
          skippedCount++;
        }
        try {
          await persist.recordUnmatchedComic(filePath, entry.name, existing, stats, res.status === 'failed');
        } catch (err) {}
        ctLog(`➜ SKIPPED: ${res.reason || 'No match above threshold'} (${entry.name})`);
      }
      itemDurations.push(Date.now() - itemStart);
      ctLog('');
    }

    if (failedDbUpdates.length > 0) {
      persist.batchUpdateFailedComics(failedDbUpdates);
    }

    if (hasChanges) {
      ctLog('ⓘ Triggering library scan due to updated metadata');
      if (typeof scanLibrary === 'function') scanLibrary();
    }

    const totalDuration = Date.now() - scanStartTime;
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    ctLog(`✓ Tag Comics Now scan completed in ${formatDuration(totalDuration)}`);
    ctLog(`📊 Results: ${taggedCount} tagged, ${reviewCount} review required, ${skippedCount} skipped, ${failedCount} failed (${totalFiles} total)`);
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (err) {
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    ctLog(`✗ Tag Comics Now error: ${err.message}`);
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } finally {
    ctRunning = false;
    review.clearReviewState(ctCancelled);
  }
}

module.exports = {
  isTaggerRunning,
  cancelComicTagger,
  scheduleCtRun,
  runComicTagger
};
