const fs = require('fs');
const db = require('../../db');
const metadata = require('../metadata');
const { createId } = require('../../utils');
const { ctLog } = require('../../logger');

/**
 * Build the full DB metadata blob for a tagged comic from the parsed ComicInfo.
 * Used by every tag path (auto scan + manual selection) so the DB record carries
 * the SAME field set that gets written to the archive — including Characters,
 * Teams, Locations, StoryArc/StoryArcNumber, AgeRating, Web, Genre, PageCount.
 * Empty fields are dropped so `metadata LIKE '%"StoryArc"%'` style queries stay accurate.
 */
function buildTaggedDbMeta(info, overrides = {}) {
  const { title, series, number, volume, publisher } = overrides;
  const m = {
    Title: title,
    Series: series,
    Number: number,
    Volume: volume,
    Publisher: publisher,
    Imprint: info.Imprint || '',
    Writer: info.Writer || '',
    Penciller: info.Penciller || '',
    Inker: info.Inker || '',
    Colorist: info.Colorist || '',
    Letterer: info.Letterer || '',
    CoverArtist: info.CoverArtist || '',
    Editor: info.Editor || '',
    Summary: metadata.cleanDescription(info.Summary || ''),
    Genre: metadata.cleanGenreAndTags(info.Genre || ''),
    Tags: metadata.cleanGenreAndTags(info.Tags || ''),
    Characters: info.Characters || '',
    Teams: info.Teams || '',
    Locations: info.Locations || '',
    StoryArc: info.StoryArc || '',
    StoryArcNumber: info.StoryArcNumber || '',
    AgeRating: info.AgeRating || '',
    Web: info.Web || '',
    PageCount: info.PageCount || '',
    'Cover Date': info.CoverDate || info['Cover Date'] || info.Year || ''
  };
  for (const k of Object.keys(m)) {
    if (m[k] === '' || m[k] == null) delete m[k];
  }
  return m;
}

async function checkFileSuccess(filePath) {
  try {
    const info = await metadata.getComicInfoFromArchive(filePath);
    const hasSeries = ((info.Series && info.Series.trim().length > 0) || (info.Title && info.Title.trim().length > 0));
    const hasPublisher = info.Publisher && info.Publisher.trim().length > 0;
    const hasDate = (info.Year || info.CoverDate || info.StoreDate || info['Cover Date'] || info['Store Date'] || '').toString().trim().length > 0;
    const hasNumber = (info.Number !== undefined && info.Number !== null && info.Number.toString().trim().length > 0) ||
                      (info.Volume !== undefined && info.Volume !== null && info.Volume.toString().trim().length > 0);

    return Boolean(hasSeries && hasPublisher && hasDate && hasNumber);
  } catch (err) {
    return false;
  }
}

function resolveVolumeAndSeries(ser, title, rawNum, rawVol) {
  let num = rawNum || '';
  let vol = rawVol || '';
  const volSplit = metadata.splitVolumeSeriesAndTitle(ser, title);
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
  if (!num && vol) {
    num = vol;
  }
  if (title && (metadata.isTitleSameAsSeries(title, ser) || (!ser && metadata.isTitleSameAsSeries(title, '')))) {
    title = '';
  }
  return { series: ser, title, number: num, volume: vol };
}

async function recordCompleteComic(filePath, fileName, info, existing, publisherCodex, stats) {
  const id = createId(filePath);
  const rawPub = info.Publisher || existing?.publisher || 'Unknown Publisher';
  const pub = metadata.normalizePublisher(rawPub, publisherCodex);
  let ser = info.Series || existing?.series || 'Unknown Series';
  let title = info.Title || '';
  const resolved = resolveVolumeAndSeries(ser, title, info.Number, info.Volume);
  
  const dbMeta = buildTaggedDbMeta(info, {
    title: resolved.title,
    series: resolved.series,
    number: resolved.number,
    volume: resolved.volume,
    publisher: pub
  });

  await db.dbRun(
    `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tagStatus = excluded.tagStatus,
       publisher = excluded.publisher,
       series = excluded.series,
       updatedAt = excluded.updatedAt,
       metadata = COALESCE(excluded.metadata, comics.metadata)`,
    [id, filePath, fileName, pub, resolved.series, 'metadata', 'successful', stats.mtimeMs, JSON.stringify(dbMeta)]
  );
  return { pub, ser: resolved.series, dbMeta };
}

async function recordTaggedComic(filePath, fileName, res, existing, publisherCodex, newStats) {
  const id = createId(filePath);
  const isSuccessful = await checkFileSuccess(filePath);
  const tagStatus = isSuccessful ? 'successful' : 'failed';
  
  let dbMetaStr = null;
  let rawPub = res.metadata?.publisher || existing?.publisher || 'Unknown Publisher';
  let pub = metadata.normalizePublisher(rawPub, publisherCodex);
  let ser = res.metadata?.series || res.metadata?.title || existing?.series || 'Unknown Series';

  try {
    const info = await metadata.getComicInfoFromArchive(filePath);
    pub = metadata.normalizePublisher(info.Publisher || pub, publisherCodex);
    ser = info.Series || ser;
    let title = info.Title || '';
    const resolved = resolveVolumeAndSeries(ser, title, info.Number, info.Volume);
    ser = resolved.series;
    title = resolved.title;
    const dbMeta = buildTaggedDbMeta(info, {
      title,
      series: ser,
      number: resolved.number,
      volume: resolved.volume,
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

  return { isSuccessful, pub, ser };
}

async function recordUnmatchedComic(filePath, fileName, existing, stats, isFailed) {
  const id = createId(filePath);
  const currentStats = await fs.promises.stat(filePath).catch(() => stats);
  const isSuccessful = await checkFileSuccess(filePath);
  const tagStatus = isSuccessful ? 'successful' : 'failed';
  
  await db.dbRun(
    `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tagStatus = excluded.tagStatus,
       updatedAt = excluded.updatedAt`,
    [id, filePath, fileName, existing?.publisher || 'Unknown Publisher', existing?.series || 'Unknown Series', 'metadata', tagStatus, currentStats.mtimeMs]
  );
  return tagStatus;
}

function batchUpdateFailedComics(updates) {
  if (!updates || updates.length === 0) return;
  try {
    const stmt = db.db.prepare(
      `INSERT INTO comics (id, path, name, publisher, series, libraryMode, tagStatus, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tagStatus = excluded.tagStatus,
         updatedAt = excluded.updatedAt`
    );
    const insertMany = db.db.transaction((records) => {
      for (const update of records) {
        stmt.run(update[0], update[1], update[2], update[3], update[4], update[5], update[6], update[7]);
      }
    });
    insertMany(updates);
  } catch (dbErr) {
    ctLog(`✗ Failed to batch update failed records: ${dbErr.message}`);
  }
}

module.exports = {
  buildTaggedDbMeta,
  checkFileSuccess,
  resolveVolumeAndSeries,
  recordCompleteComic,
  recordTaggedComic,
  recordUnmatchedComic,
  batchUpdateFailedComics
};
