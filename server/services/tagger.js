const fs = require('fs');
const path = require('path');
const { ctLog, log } = require('../logger');
const {
  getConfig,
  getTaggerServiceUrl,
  getMetadataStorage,
  getTaggerLowerThreshold,
  getTaggerUpperThreshold,
  getTaggerEnabledSources,
  getMetronUser,
  getMetronPassword,
  getComicVineApiKey,
  getGoogleBooksApiKey,
  getTaggerForceReprocess
} = require('../config');
const db = require('../db');
const { startTaggerWorker, isWorkerOnline } = require('./tagger-process');

function getScanLibrary() {
  return require('./library').scanLibrary;
}

async function checkFileSuccess(filePath) {
  try {
    const { getComicInfoFromArchive } = require('./metadata');
    const info = await getComicInfoFromArchive(filePath);
    const hasSeries = ((info.Series && info.Series.trim().length > 0) || (info.Title && info.Title.trim().length > 0));
    const hasPublisher = info.Publisher && info.Publisher.trim().length > 0;
    const hasDate = (info.Year || info.CoverDate || info.StoreDate || info['Cover Date'] || info['Store Date'] || '').toString().trim().length > 0;
    const hasNumber = info.Number !== undefined && info.Number !== null && info.Number.toString().trim().length > 0;

    return (hasSeries && hasPublisher && hasDate && hasNumber);
  } catch (err) {
    return false;
  }
}

function formatDuration(msVal) {
  if (!msVal || msVal <= 0 || !isFinite(msVal)) return '< 1s';
  const totalSeconds = Math.round(msVal / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

async function callTaggerEngineWithProgress(serviceUrl, reqBody, abortSignal, onProgress) {
  try {
    const fetchRes = await fetch(`${serviceUrl}/api/tag-file-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortSignal,
      body: JSON.stringify(reqBody)
    });

    if (fetchRes.ok && fetchRes.body) {
      const reader = fetchRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.type === 'progress' && onProgress) {
                onProgress(data);
              } else if (data.type === 'result') {
                finalResult = data.data;
              } else if (data.type === 'error') {
                throw new Error(data.error || 'Tagger engine error');
              }
            } catch (pe) {
              if (pe.message && !pe.message.includes('JSON')) throw pe;
            }
          }
        }
      }

      if (finalResult) return finalResult;
    }
  } catch (streamErr) {
    if (abortSignal && abortSignal.aborted) throw streamErr;
  }

  // Fallback to non-streaming POST
  const fallbackRes = await fetch(`${serviceUrl}/api/tag-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: abortSignal,
    body: JSON.stringify(reqBody)
  });
  if (!fallbackRes.ok) {
    const errText = await fallbackRes.text();
    throw new Error(errText || `Status ${fallbackRes.status}`);
  }
  return await fallbackRes.json();
}

let ctInterval = null;
let ctRunning = false;
let ctCancelled = false;
let ctAbortController = null;
let pendingUserChoice = null;
let userChoiceResolver = null;
let pendingMatchState = null;

async function runComicTagger(options = {}) {
  if (ctRunning) {
    ctLog('Tagger already running.');
    return;
  }
  ctRunning = true;
  ctCancelled = false;
  ctAbortController = new AbortController();
  const force = options && options.force !== undefined ? !!options.force : (getTaggerForceReprocess ? getTaggerForceReprocess() : false);
  const scanStartTime = Date.now();
  try {
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    ctLog(`Starting Tag Comics Now library scan...${force ? ' (⚡ Force Re-Scan: Existing ComicInfo.xml will be re-scanned)' : ''}`);
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
    
    // Ensure worker is alive
    if (!(await isWorkerOnline(serviceUrl))) {
      ctLog(`Internal tagger worker is offline, attempting start...`);
      await startTaggerWorker();
    }

    // Health check
    try {
      const healthRes = await fetch(`${serviceUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (!healthRes.ok) throw new Error(`Status ${healthRes.status}`);
      const health = await healthRes.json();
      ctLog(`✓ Tagger engine is online. Version: ${health.version || '1.0'}`);
    } catch (err) {
      ctLog(`✗ ERROR: Tagger engine is offline or unreachable: ${err.message}`);
      return;
    }

    const config = getConfig();
    const dir = config.comicsLocation;
    if (!dir || !fs.existsSync(dir)) {
      ctLog(`✗ Comics directory does not exist: ${dir}`);
      return;
    }

    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const allowedFormats = config.allowed_formats || 'cbz';
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

    const metadataStorage = getMetadataStorage();
    const lowerThreshold = getTaggerLowerThreshold();
    const upperThreshold = getTaggerUpperThreshold();
    const enabledSources = getTaggerEnabledSources();
    const comicvineApiKey = getComicVineApiKey();
    const googleBooksApiKey = getGoogleBooksApiKey();
    const metronUser = getMetronUser();
    const metronPass = getMetronPassword();

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
      const id = require('../utils').createId(filePath);

      let stats;
      try {
        stats = await fs.promises.stat(filePath);
      } catch (e) {
        continue;
      }

      // Check if comic was already scanned into the database
      const existing = await db.dbGet(
        'SELECT id, updatedAt, tagStatus, metadata, series, publisher FROM comics WHERE id = ?',
        [id]
      );

      const isModified = !existing || !existing.updatedAt || Math.abs(stats.mtimeMs - existing.updatedAt) > 1000;

      // 1. If already scanned and tagged successfully, and file is not modified -> SKIP (unless force is requested)
      if (!force && existing && !isModified && existing.tagStatus === 'successful') {
        skippedCount++;
        itemDurations.push(Date.now() - itemStart);
        ctLog(`➜ SKIPPED: Already scanned and tagged (${entry.name})`);
        continue;
      }

      // 2. If the file on disk already contains complete metadata (Series, Publisher, Date, Number) -> ONLY skip if NOT forced
      const isAlreadyComplete = await checkFileSuccess(filePath);
      if (!force && isAlreadyComplete) {
        try {
          const { getComicInfoFromArchive, normalizePublisher, cleanDescription, splitVolumeSeriesAndTitle } = require('./metadata');
          const info = await getComicInfoFromArchive(filePath);
          const rawPub = info.Publisher || existing?.publisher || 'Unknown Publisher';
          const pub = normalizePublisher(rawPub, publisherCodex);
          let ser = info.Series || existing?.series || 'Unknown Series';
          let title = info.Title || '';
          let num = info.Number || '';
          let vol = info.Volume || '';
          const volSplit = splitVolumeSeriesAndTitle(ser, title);
          if (volSplit.series && volSplit.number) {
            ser = volSplit.series;
            title = volSplit.title;
            if (!num || num === '1' || num === '01') {
              num = volSplit.number;
            }
            if (!vol) {
              vol = volSplit.volume;
            }
          }
          const dbMeta = {
            Title: title,
            Series: ser,
            Number: num,
            Volume: vol,
            Publisher: pub,
            Writer: info.Writer || '',
            Penciller: info.Penciller || '',
            Inker: info.Inker || '',
            Colorist: info.Colorist || '',
            Letterer: info.Letterer || '',
            CoverArtist: info.CoverArtist || '',
            Summary: cleanDescription(info.Summary || ''),
            'Cover Date': info.CoverDate || info.Year || ''
          };

          await db.dbRun(
            `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               tagStatus = excluded.tagStatus,
               publisher = excluded.publisher,
               series = excluded.series,
               updatedAt = excluded.updatedAt,
               metadata = COALESCE(excluded.metadata, comics.metadata)`,
            [id, filePath, entry.name, pub, ser, 'metadata', 'successful', stats.mtimeMs, JSON.stringify(dbMeta)]
          );

          skippedCount++;
          itemDurations.push(Date.now() - itemStart);
          ctLog(`✓ SUCCESS → Already contains complete metadata: ${entry.name}`);
          continue;
        } catch (err) {}
      }

      // 3. If previously scanned with no match and file has not been modified -> SKIP (unless force is requested)
      if (!force && existing && !isModified && existing.tagStatus === 'failed') {
        skippedCount++;
        itemDurations.push(Date.now() - itemStart);
        ctLog(`➜ SKIPPED: Previously scanned with no match (file unmodified) (${entry.name})`);
        continue;
      }

      // Compute moving average ETA for files requiring online search
      const percent = Math.round(((fileIndex - 1) / totalFiles) * 100);
      let etaStr = '';
      if (itemDurations.length > 0) {
        const avgItemMs = itemDurations.reduce((a, b) => a + b, 0) / itemDurations.length;
        const remainingItems = totalFiles - (fileIndex - 1);
        etaStr = ` | Est. remaining: ~${formatDuration(remainingItems * avgItemMs)}`;
      }

      ctLog(`─────────────────────────────────────────`);
      ctLog(`[${fileIndex}/${totalFiles}] Processing: ${entry.name} (${percent}% complete${etaStr})`);
      
      // Determine storage mode: CBR files always use sidecar
      const effectiveStorage = isCbr ? 'sidecar' : metadataStorage;

      let res;
      try {
        res = await callTaggerEngineWithProgress(
          serviceUrl,
          {
            path: filePath,
            metadata_storage: effectiveStorage,
            comicvine_api_key: comicvineApiKey,
            google_books_api_key: googleBooksApiKey,
            metron_user: metronUser,
            metron_pass: metronPass,
            lower_threshold: lowerThreshold,
            upper_threshold: upperThreshold,
            enabled_sources: enabledSources,
            force_reprocess: force,
            publisher_codex: publisherCodex
          },
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
        try {
          await db.dbRun(
            `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               tagStatus = excluded.tagStatus,
               updatedAt = excluded.updatedAt`,
            [id, filePath, entry.name, existing?.publisher || 'Unknown Publisher', existing?.series || 'Unknown Series', 'metadata', 'failed', null]
          );
        } catch (dbErr) {}
        itemDurations.push(Date.now() - itemStart);
        continue;
      }

      if (res.status === 'tagged') {
        try {
          const isSuccessful = await checkFileSuccess(filePath);
          const tagStatus = isSuccessful ? 'successful' : 'failed';
          const newStats = await fs.promises.stat(filePath).catch(() => stats);
          
          const { getComicInfoFromArchive, normalizePublisher, cleanDescription, splitVolumeSeriesAndTitle } = require('./metadata');
          let dbMetaStr = null;
          let rawPub = res.metadata?.publisher || existing?.publisher || 'Unknown Publisher';
          let pub = normalizePublisher(rawPub, publisherCodex);
          let ser = res.metadata?.series || res.metadata?.title || existing?.series || 'Unknown Series';
          try {
            const info = await getComicInfoFromArchive(filePath);
            pub = normalizePublisher(info.Publisher || pub, publisherCodex);
            ser = info.Series || ser;
            let title = info.Title || '';
            let num = info.Number || '';
            let vol = info.Volume || '';
            const volSplit = splitVolumeSeriesAndTitle(ser, title);
            if (volSplit.series && volSplit.number) {
              ser = volSplit.series;
              title = volSplit.title;
              if (!num || num === '1' || num === '01') {
                num = volSplit.number;
              }
              if (!vol) {
                vol = volSplit.volume;
              }
            }
            const dbMeta = {
              Title: title,
              Series: ser,
              Number: num,
              Volume: vol,
              Publisher: pub,
              Writer: info.Writer || '',
              Penciller: info.Penciller || '',
              Inker: info.Inker || '',
              Colorist: info.Colorist || '',
              Letterer: info.Letterer || '',
              CoverArtist: info.CoverArtist || '',
              Summary: cleanDescription(info.Summary || ''),
              'Cover Date': info.CoverDate || info.Year || ''
            };
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
            [id, filePath, entry.name, pub, ser, 'metadata', tagStatus, newStats.mtimeMs, dbMetaStr]
          );
          if (isSuccessful) {
            taggedCount++;
            ctLog(`✓ SUCCESS → Auto-tagged: ${res.matched_title || entry.name} (${res.confidence || 100}% confidence)`);
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
        
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
        
        const formattedMatches = (res.candidates || []).map((c, index) => {
          const meta = c.metadata || {};
          return {
            choice: String(index + 1),
            title: meta.title || 'Unknown Title',
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

        pendingMatchState = {
          fileName: entry.name,
          filePath: absolutePath,
          matches: formattedMatches,
          timestamp: new Date().toISOString(),
          waitingForResponse: true,
          isFinal: true,
          previewBuffer: null,
          previewMime: null
        };

        const choicePromise = new Promise((resolveChoice) => {
          userChoiceResolver = resolveChoice;
        });

        // Background extract and cache the preview image
        (async () => {
          try {
            const library = require('./library');
            const pages = await library.getComicPages(absolutePath);
            if (pages && pages.length > 0) {
              const firstPage = pages[0];
              const buffer = await library.extractPageBuffer(absolutePath, firstPage);
              if (buffer && pendingMatchState && pendingMatchState.filePath === absolutePath) {
                const { getMimeFromExt } = require('../utils');
                pendingMatchState.previewBuffer = buffer;
                pendingMatchState.previewMime = getMimeFromExt(firstPage);
                ctLog(`ⓘ Cached preview image for: ${entry.name}`);
              }
            }
          } catch (err) {}
        })();

        ctLog(`>>> WAITING FOR USER SELECTION (Found ${formattedMatches.length} candidates)`);
        
        await new Promise((resolveLoop) => {
          choicePromise.then(async (action) => {
            if (action === 'apply') {
              hasChanges = true;
            }
            pendingMatchState = null;
            userChoiceResolver = null;
            resolveLoop();
          }).catch((err) => {
            ctLog(`✗ Error in selection promise: ${err.message}`);
            pendingMatchState = null;
            userChoiceResolver = null;
            resolveLoop();
          });
        });
      } else {
        // status is skipped or failed
        if (res.status === 'failed') {
          failedCount++;
        } else {
          skippedCount++;
        }
        try {
          const currentStats = await fs.promises.stat(filePath).catch(() => stats);
          const isSuccessful = await checkFileSuccess(filePath);
          const tagStatus = isSuccessful ? 'successful' : 'failed';
          
          await db.dbRun(
            `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               tagStatus = excluded.tagStatus,
               updatedAt = excluded.updatedAt`,
            [id, filePath, entry.name, existing?.publisher || 'Unknown Publisher', existing?.series || 'Unknown Series', 'metadata', tagStatus, currentStats.mtimeMs]
          );
        } catch (err) {}
        ctLog(`➜ SKIPPED: ${res.reason || 'No match above threshold'} (${entry.name})`);
      }
      itemDurations.push(Date.now() - itemStart);
      ctLog('');
    }

    if (hasChanges) {
      ctLog('ⓘ Triggering library scan due to updated metadata');
      const scan = getScanLibrary();
      if (scan) scan();
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
    pendingMatchState = null;
    userChoiceResolver = null;
  }
}

function getPendingMatch() {
  return pendingMatchState;
}

async function applyUserSelection(selections) {
  if (!pendingMatchState || !userChoiceResolver) {
    ctLog('⚠ ERROR: No tagger run waiting for user selection');
    throw new Error('No tagger run waiting for user selection');
  }

  const resolver = userChoiceResolver;
  const choiceStr = selections[0] || '1';
  const match = pendingMatchState.matches.find(m => m.choice === choiceStr);
  if (!match) {
    ctLog(`⚠ ERROR: Selection #${choiceStr} not found in candidates list`);
    throw new Error(`Selection #${choiceStr} not found`);
  }

  ctLog(`✓ User selected candidate #${choiceStr}: ${match.title}`);
  
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  const filePath = pendingMatchState.filePath;
  const fileName = pendingMatchState.fileName;
  const isCbr = path.extname(filePath).toLowerCase() === '.cbr';
  const effectiveStorage = isCbr ? 'sidecar' : getMetadataStorage();

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
    
    const id = require('../utils').createId(filePath);
    const { getComicInfoFromArchive, normalizePublisher, cleanDescription } = require('./metadata');
    let publisherCodex = [];
    try {
      const pubRows = await db.dbAll("SELECT DISTINCT publisher FROM comics WHERE publisher IS NOT NULL AND publisher != '' AND publisher != 'Unknown Publisher'");
      publisherCodex = (pubRows || []).map(r => r.publisher).filter(Boolean);
    } catch (e) {}

    let dbMetaStr = null;
    let rawPub = match.publisher || 'Unknown Publisher';
    let pub = normalizePublisher(rawPub, publisherCodex);
    let ser = match.title || 'Unknown Series';
    try {
      const info = await getComicInfoFromArchive(filePath);
      pub = normalizePublisher(info.Publisher || pub, publisherCodex);
      ser = info.Series || ser;
      const dbMeta = {
        Title: info.Title || '',
        Series: info.Series || ser,
        Number: info.Number || '',
        Publisher: pub,
        Writer: info.Writer || '',
        Penciller: info.Penciller || '',
        Inker: info.Inker || '',
        Colorist: info.Colorist || '',
        Letterer: info.Letterer || '',
        CoverArtist: info.CoverArtist || '',
        Summary: cleanDescription(info.Summary || ''),
        'Cover Date': info.CoverDate || info.Year || ''
      };
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
    } else {
      ctLog(`⚠ WARNING → Tag applied but missing required tags in final file: ${fileName}`);
    }
    
    if (typeof resolver === 'function') resolver('apply');
  } catch (err) {
    ctLog(`✗ Failed to apply selection via tagger engine: ${err.message}`);
    if (typeof resolver === 'function') resolver('error');
    throw err;
  }
}

function skipCurrentMatch() {
  if (!pendingMatchState || !userChoiceResolver) {
    ctLog('⚠ ERROR: No tagger run waiting for user selection');
    throw new Error('No tagger run waiting for user selection');
  }

  const resolver = userChoiceResolver;
  const filePath = pendingMatchState.filePath;
  const fileName = pendingMatchState.fileName;

  ctLog(`ⓘ Skipping match for: ${fileName}`);
  
  const id = require('../utils').createId(filePath);
  fs.promises.stat(filePath).catch(() => ({ mtimeMs: Date.now() })).then(currentStats => {
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

async function searchExternal(source, query) {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  const comicvineApiKey = getComicVineApiKey();
  const googleBooksApiKey = getGoogleBooksApiKey();
  const metronUser = getMetronUser();
  const metronPass = getMetronPassword();

  const fetchRes = await fetch(`${serviceUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source,
      query,
      comicvine_api_key: comicvineApiKey,
      google_books_api_key: googleBooksApiKey,
      metron_user: metronUser,
      metron_pass: metronPass
    })
  });
  if (!fetchRes.ok) {
    const errText = await fetchRes.text();
    throw new Error(errText || `Search failed with status ${fetchRes.status}`);
  }
  return await fetchRes.json();
}

async function getScanLogsList() {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  const res = await fetch(`${serviceUrl}/api/logs`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.logs)) return data.logs;
  return [];
}

async function getScanLogDetail(logId) {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  const res = await fetch(`${serviceUrl}/api/logs/${logId}`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  return await res.json();
}

async function clearEnhancedTracking() {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  let pyResult = null;
  try {
    const res = await fetch(`${serviceUrl}/api/enhanced-comics/clear`, { method: 'POST' });
    if (res.ok) {
      pyResult = await res.json();
    }
  } catch (e) {
    ctLog(`⚠ Could not clear tagger engine tracking DB: ${e.message}`);
  }

  try {
    await db.dbRun("UPDATE comics SET tagStatus = 'pending', updatedAt = NULL WHERE tagStatus IN ('failed', 'completed', 'successful')");
    ctLog('✓ Reset comic tagging status in database.');
  } catch (dbErr) {
    ctLog(`⚠ Failed to reset comics in database: ${dbErr.message}`);
  }

  return pyResult || { ok: true };
}

function scheduleCtRun() {
  if (ctInterval) clearInterval(ctInterval);
  const minutes = getConfig().ctScheduleMinutes;
  if (minutes > 0) {
    ctInterval = setInterval(() => {
      runComicTagger();
    }, minutes * 60 * 1000);
  }
}

function cancelComicTagger() {
  if (!ctRunning) return false;
  ctCancelled = true;
  if (ctAbortController) {
    try { ctAbortController.abort(); } catch (e) {}
  }
  if (userChoiceResolver) {
    userChoiceResolver('skip');
  }
  ctLog('🛑 Scan cancellation requested by user...');
  return true;
}

function isTaggerRunning() {
  return ctRunning;
}

module.exports = {
  runComicTagger,
  cancelComicTagger,
  isTaggerRunning,
  scheduleCtRun,
  applyUserSelection,
  skipCurrentMatch,
  getPendingMatch,
  searchExternal,
  getScanLogsList,
  getScanLogDetail,
  clearEnhancedTracking
};
