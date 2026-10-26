const path = require('path');
const { resolveLogo } = require('./library-logos');
const { extractPageBuffer, getComicPages } = require('./library-pages');
const { generateVirtualMetadata } = require('./library-metadata');
const { scanLibrary, scheduleNextScan, isScanning } = require('./library-scan');

const { dbGet, dbAll } = require('../db');
const { log } = require('../logger');
const { getComicsDirectories } = require('../config');
const { safeDirName } = require('../utils');
const { LOGOS_DIRECTORY } = require('../constants');

async function buildLibrary(userId = 'default-user') {
  // Get user role to determine access level
  const user = await dbGet('SELECT role FROM users WHERE userId = ?', [userId]);
  const userRole = user?.role || 'user';

  // Get all comics and their per-user progress/status
  const rows = await dbAll('SELECT * FROM comics');
  log('INFO', 'SERVER', `Build library for UI with ${rows.length} rows for user ${userId} (role: ${userRole})`);

  // Get per-user progress for all comics in one query
  const userProgress = await dbAll(
    'SELECT comicId, lastReadPage, totalPages FROM user_comic_status WHERE userId = ?',
    [userId]
  );

  // Create maps for quick lookup
  const progressMap = {};
  for (const p of userProgress) {
    progressMap[p.comicId] = { lastReadPage: p.lastReadPage, totalPages: p.totalPages };
  }

  // Load all reading preferences for this user
  const { getReadingPrefMaps, resolveReadingModes, checkComicAccess } = require('../db');
  const prefMaps = await getReadingPrefMaps(userId);

  const lib = {};
  const directories = getComicsDirectories();
  const libraryConfigs = require('../config').getLibraries();

  // Pre-fetch access list once for the whole library build
  const accessList = userRole === 'admin' ? [] : await dbAll(
    `SELECT accessType, accessValue, direct_access, child_access
     FROM user_library_access
     WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
    [userId]
  );

  // Optimization: Parallelize access checks
  const accessChecks = rows.map(async (r) => {
    const hasAccess = await checkComicAccess({
      userId,
      userRole,
      comicPath: r.path,
      publisher: r.publisher,
      series: r.series,
      rootFolders: directories,
      comicId: r.id,
      preFetchedAccessList: accessList
    });
    return hasAccess ? r : null;
  });
  const accessibleRows = (await Promise.all(accessChecks)).filter(r => r !== null);

  for (const r of accessibleRows) {

    // User has access to this comic, include it in the library
    const absoluteRootDir = directories.find(d => r.path.startsWith(d));
    const configObj = require('../config').getConfig();
    const comicsLocation = configObj.comicsLocation;
    const isInboxComic = comicsLocation && r.path.startsWith(comicsLocation);

    const rootDirKey = isInboxComic ? 'Smart Inbox' : (require('../config').getLibraryIdFromPath(absoluteRootDir) || 'Library');

    if (!lib[rootDirKey]) {
      const config = libraryConfigs.find(c => c.path === absoluteRootDir);
      lib[rootDirKey] = { 
        publishers: {},
        hierarchyMode: isInboxComic ? 'metadata' : (config ? config.hierarchyMode : 'metadata')
      };
    }
    if (!lib[rootDirKey].publishers[r.publisher]) {
      lib[rootDirKey].publishers[r.publisher] = { logoUrl: null, logoNeedsBackground: false, series: {} };
    }
    if (!lib[rootDirKey].publishers[r.publisher].series[r.series]) {
      lib[rootDirKey].publishers[r.publisher].series[r.series] = [];
    }

    let fullMetadata = {};
    try {
      fullMetadata = JSON.parse(r.metadata || '{}');
    } catch {
      fullMetadata = {};
    }

    let year = fullMetadata.Year || fullMetadata.year || '';
    let month = fullMetadata.Month || fullMetadata.month || '';
    let day = fullMetadata.Day || fullMetadata.day || '';
    const coverDate = fullMetadata.CoverDate || fullMetadata['Cover Date'] || fullMetadata.StoreDate || fullMetadata['Store Date'] || '';
    if (!year && coverDate) {
      const match = String(coverDate).match(/\b(19\d\d|20\d\d)\b/);
      if (match) year = match[1];
    }
    if (!year && r.name) {
      const match = String(r.name).match(/\b(19\d\d|20\d\d)\b/);
      if (match) year = match[1];
    }

    // Only include minimal metadata fields needed for display
    // Full metadata can be fetched via /api/v1/comics/info when needed
    const metadata = {
      Number: fullMetadata.Number || fullMetadata.Issue || fullMetadata.IssueNumber || fullMetadata.SortNumber || fullMetadata.AlternateNumber || '',
      Series: fullMetadata.Series || fullMetadata.SeriesName || fullMetadata.AlternateSeries || '',
      Title: fullMetadata.Title || fullMetadata.DisplayTitle || fullMetadata.SortName || fullMetadata.FullTitle || fullMetadata.StoryTitle || '',
      Year: year,
      Month: month,
      Day: day,
      CoverDate: coverDate
    };

    // Use per-user progress if available, otherwise default to 0
    const progress = progressMap[r.id] || { lastReadPage: 0, totalPages: r.totalPages || 0 };

    // Apply hierarchical reading modes preferences
    const { mangaMode, continuousMode } = resolveReadingModes({ comicId: r.id, series: r.series, publisher: r.publisher, comicPath: r.path, prefMaps, comicsRoots: directories });

    // Redact absolute path: Replace absolute root with library ID
    const relativePath = path.relative(isInboxComic ? comicsLocation : absoluteRootDir, r.path);
    const redactedPath = path.join(rootDirKey, relativePath);

    lib[rootDirKey].publishers[r.publisher].series[r.series].push({
      id: r.id,
      name: r.name,
      path: redactedPath,
      thumbnailPath: r.thumbnailPath || null,
      progress,
      updatedAt: r.updatedAt || null,
      convertedAt: r.convertedAt || null,
      metadata,
      series: r.series,
      publisher: r.publisher,
      mangaMode: mangaMode,
      continuousMode: continuousMode,
      guidedViewStatus: r.guidedViewStatus || 'pending',
      libraryMode: isInboxComic ? 'metadata' : r.libraryMode,
      tagStatus: r.tagStatus || 'pending'
    });
  }

  // Optimization: Parallelize publisher logo resolution across all publishers concurrently using Promise.all
  // instead of resolving each publisher's logo sequentially (which blocks on async disk I/O / sharp metadata inspection).
  const logoTasks = [];
  for (const rootDir in lib) {
    for (const publisherName in lib[rootDir].publishers) {
      const folderName = safeDirName(publisherName);
      const pubLogoDir = path.join(LOGOS_DIRECTORY, folderName);
      logoTasks.push(
        resolveLogo(pubLogoDir).then(({ logoFile, needsBackground, needsDarkBackground }) => {
          const pubObj = lib[rootDir].publishers[publisherName];
          if (logoFile) {
            pubObj.logoUrl = `logos/${encodeURIComponent(folderName)}/${encodeURIComponent(logoFile)}`;
            pubObj.logoNeedsBackground = needsBackground;
            pubObj.logoNeedsDarkBackground = Boolean(needsDarkBackground);
          } else {
            // Use default blank logo when no publisher logo exists
            pubObj.logoUrl = 'logos/6373148-blank.png';
            pubObj.logoNeedsBackground = false;
            pubObj.logoNeedsDarkBackground = false;
          }
        })
      );
    }
  }
  await Promise.all(logoTasks);

  return lib;
}

module.exports = {
  scanLibrary,
  scheduleNextScan,
  buildLibrary,
  getComicPages,
  extractPageBuffer,
  generateVirtualMetadata,
  isScanning,
};
