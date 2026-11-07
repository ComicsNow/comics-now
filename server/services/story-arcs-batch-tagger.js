/**
 * Story Arcs Batch ComicInfo.xml Enrichment Service
 * Non-destructively updates StoryArc, StoryArcNumber, and SeriesGroup in ComicInfo.xml
 * for library comics matching canonical storylines in reading-orders.db (Option C: Override).
 */
const path = require('path');
const db = require('../db');
const metadata = require('./metadata');
const { initReadingOrdersDb } = require('../readingOrdersDb');
const { createContinuityMatcher } = require('./continuityMatcher');
const { storyArcsLog } = require('../logger');

const PUBLISHER_ALIASES = {
  'dc': ['DC Comics', 'DC', 'Vertigo', 'Black Label', 'WildStorm'],
  'dc comics': ['DC Comics', 'DC', 'Vertigo', 'Black Label', 'WildStorm'],
  'marvel': ['Marvel Comics', 'Marvel', 'MAX', 'Icon'],
  'marvel comics': ['Marvel Comics', 'Marvel', 'MAX', 'Icon'],
  'image': ['Image', 'Image Comics', 'Skybound', 'Top Cow'],
  'image comics': ['Image', 'Image Comics', 'Skybound', 'Top Cow'],
  'dark horse': ['Dark Horse', 'Dark Horse Comics'],
  'dark horse comics': ['Dark Horse', 'Dark Horse Comics'],
  'idw': ['IDW', 'IDW Publishing'],
  'idw publishing': ['IDW', 'IDW Publishing']
};

function expandPublisherAliases(pubs) {
  const expanded = new Set();
  for (const pub of pubs) {
    if (!pub) continue;
    expanded.add(pub);
    const key = pub.trim().toLowerCase();
    const aliases = PUBLISHER_ALIASES[key];
    if (aliases) {
      for (const a of aliases) expanded.add(a);
    }
  }
  return Array.from(expanded);
}

function parseIssueNumber(name, existingNum) {
  if (existingNum !== undefined && existingNum !== null && String(existingNum).trim() !== '') {
    return String(existingNum).trim();
  }
  if (!name) return '1';
  const base = path.basename(name, path.extname(name));
  // Matches e.g. "Series #12", "Series 01", "01 Series - Title"
  const m = base.match(/(?:#|\s|^)(\d+(?:\.\d+)?)(?:\s|\.|$|\))/);
  return m ? m[1] : '1';
}

function createStoryArcsBatchTagger(deps = {}) {
  let readingOrdersDbInstance = deps.readingOrdersDb || null;
  let matcherInstance = deps.matcher || null;
  const dbAll = deps.dbAll || db.dbAll;
  const dbRun = deps.dbRun || db.dbRun;
  const getComicInfo = deps.getComicInfoFromArchive || metadata.getComicInfoFromArchive;
  const saveMetadata = deps.saveMetadataToComic || metadata.saveMetadataToComic;
  const log = deps.log || storyArcsLog;

  function getReadingDb() {
    if (!readingOrdersDbInstance) {
      readingOrdersDbInstance = initReadingOrdersDb();
    }
    return readingOrdersDbInstance;
  }

  function getMatcher() {
    if (!matcherInstance) {
      matcherInstance = createContinuityMatcher({
        readingOrdersDb: getReadingDb(),
        getComics: () => []
      });
    }
    return matcherInstance;
  }

  let isRunning = false;
  let isCancelled = false;
  let lastRunTime = null;
  let progress = { current: 0, total: 0, updated: 0, skipped: 0, errors: 0, currentComic: '' };

  function getStoryArcPublishers() {
    const rdb = getReadingDb();
    if (!rdb || !rdb.db) return [];
    try {
      const rows = rdb.db.prepare(`
        SELECT DISTINCT publisher FROM reading_orders
        WHERE publisher IS NOT NULL AND TRIM(publisher) != ''
        ORDER BY publisher ASC
      `).all();
      return rows.map(r => r.publisher);
    } catch (err) {
      console.warn('[StoryArcsBatchTagger] Error fetching publishers:', err.message);
      return [];
    }
  }

  function getStatus() {
    return {
      isRunning,
      isCancelled,
      lastRunTime,
      progress: { ...progress }
    };
  }

  function cancelBatchTag() {
    if (isRunning) {
      isCancelled = true;
      log('WARN', 'Cancelling batch Story Arc tagging...');
      return true;
    }
    return true;
  }

  async function startBatchTag({ publisher = 'all' } = {}) {
    if (isRunning) {
      throw new Error('Batch Story Arc tagging is already in progress');
    }

    isRunning = true;
    isCancelled = false;
    progress = { current: 0, total: 0, updated: 0, skipped: 0, errors: 0, currentComic: '' };

    try {
      const allPubs = getStoryArcPublishers();
      let targetPubs = [];

      if (publisher && publisher !== 'all') {
        targetPubs = expandPublisherAliases([publisher]);
      } else {
        targetPubs = expandPublisherAliases(allPubs);
      }

      if (targetPubs.length === 0) {
        log('WARN', 'No publishers indexed in reading-orders.db yet. Run initial sync first.');
        isRunning = false;
        return { ok: false, message: 'No publishers found in Story Arcs database' };
      }

      log('INFO', `Starting ComicInfo.xml Story Arc enrichment for: ${targetPubs.join(', ')}...`);

      const placeholders = targetPubs.map(() => '?').join(',');
      const comics = await dbAll(
        `SELECT id, path, name, publisher, series, metadata FROM comics WHERE publisher IN (${placeholders})`,
        targetPubs
      );

      progress.total = comics.length;
      log('INFO', `Found ${comics.length} library comic(s) matching target publisher(s).`);

      const matcher = getMatcher();

      for (let i = 0; i < comics.length; i++) {
        if (isCancelled) {
          log('WARN', `Batch tagging stopped early by user after ${progress.updated} update(s).`);
          break;
        }

        const comic = comics[i];
        progress.current = i + 1;
        progress.currentComic = comic.name;

        let existing = null;
        try {
          existing = await getComicInfo(comic.path);
        } catch (_) {}

        if (!existing && comic.metadata) {
          try {
            existing = JSON.parse(comic.metadata);
          } catch (_) {}
        }
        existing = existing || {};

        const seriesName = comic.series || existing.Series || '';
        const issueNum = parseIssueNumber(comic.name, existing.Number);

        const arcMeta = matcher.getComicInfoMetadata(seriesName, issueNum, comic);

        if (!arcMeta) {
          progress.skipped++;
          continue;
        }

        const isExactMatch =
          existing.StoryArc === arcMeta.StoryArc &&
          String(existing.StoryArcNumber || '') === String(arcMeta.StoryArcNumber || '');

        if (isExactMatch) {
          progress.skipped++;
          continue;
        }

        // Option C: Update StoryArc, StoryArcNumber, and SeriesGroup to canon; strictly preserve all other tags
        const mergedMeta = {
          ...existing,
          StoryArc: arcMeta.StoryArc,
          StoryArcNumber: String(arcMeta.StoryArcNumber),
          SeriesGroup: arcMeta.SeriesGroup || existing.SeriesGroup || ''
        };

        try {
          await saveMetadata(comic.path, mergedMeta);
          await dbRun(
            'UPDATE comics SET metadata = ?, updatedAt = ? WHERE id = ?',
            [JSON.stringify(mergedMeta), Date.now(), comic.id]
          );
          progress.updated++;
          log('INFO', `[${progress.current}/${progress.total}] ✓ Updated ${comic.name} -> StoryArc: "${arcMeta.StoryArc}" (#${arcMeta.StoryArcNumber})`);
        } catch (writeErr) {
          progress.errors++;
          log('ERROR', `[${progress.current}/${progress.total}] ⚠ Failed to write ${comic.name}: ${writeErr.message}`);
        }

        // Yield event loop briefly every 10 comics
        if (i % 10 === 0) {
          await new Promise(r => setTimeout(r, 10));
        }
      }

      lastRunTime = Date.now();
      log('INFO', `Batch enrichment complete! Updated: ${progress.updated}, Skipped: ${progress.skipped}, Errors: ${progress.errors} across ${progress.total} comics.`);
      return { ok: true, ...progress };
    } catch (err) {
      log('ERROR', `Batch Story Arc tagging error: ${err.message}`);
      throw err;
    } finally {
      isRunning = false;
    }
  }

  return {
    getStoryArcPublishers,
    getStatus,
    cancelBatchTag,
    startBatchTag
  };
}

let batchTaggerInstance = null;
function getStoryArcsBatchTagger() {
  if (!batchTaggerInstance) {
    batchTaggerInstance = createStoryArcsBatchTagger();
  }
  return batchTaggerInstance;
}

module.exports = {
  createStoryArcsBatchTagger,
  getStoryArcsBatchTagger
};
