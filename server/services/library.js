const fs = require('fs');
const path = require('path');
const { resolveLogo } = require('./library-logos');
const { extractPageBuffer, getComicPages, generateThumbnail } = require('./library-pages');
const { convertCbrToCbz, convertPdfToCbz } = require('./library-conversion');
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

  for (const r of rows) {
    // Access control: Check if user has access to this comic using hierarchical access control
    // Admin has access to everything
    // For non-admin, check hierarchical access: root_folder -> publisher -> series
    const hasAccess = await checkComicAccess(
      userId,
      userRole,
      r.path,
      r.publisher,
      r.series,
      directories,
      r.id,
      accessList
    );

    if (!hasAccess) {
      continue; // User doesn't have access to this comic, skip it
    }

    // User has access to this comic, include it in the library
    const absoluteRootDir = directories.find(d => r.path.startsWith(d));
    const rootDirKey = require('../config').getLibraryIdFromPath(absoluteRootDir) || 'Library';

    if (!lib[rootDirKey]) {
      const config = libraryConfigs.find(c => c.path === absoluteRootDir);
      lib[rootDirKey] = { 
        publishers: {},
        hierarchyMode: config ? config.hierarchyMode : 'metadata'
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

    // Only include minimal metadata fields needed for display
    // Full metadata can be fetched via /api/v1/comics/info when needed
    const metadata = {
      Number: fullMetadata.Number || fullMetadata.Issue || fullMetadata.IssueNumber || fullMetadata.SortNumber || fullMetadata.AlternateNumber || '',
      Series: fullMetadata.Series || fullMetadata.SeriesName || fullMetadata.AlternateSeries || '',
      Title: fullMetadata.Title || fullMetadata.DisplayTitle || fullMetadata.SortName || fullMetadata.FullTitle || fullMetadata.StoryTitle || ''
    };

    // Use per-user progress if available, otherwise default to 0
    const progress = progressMap[r.id] || { lastReadPage: 0, totalPages: r.totalPages || 0 };

    // Apply hierarchical reading modes preferences
    const { mangaMode, continuousMode } = resolveReadingModes(r.id, r.series, r.publisher, r.path, prefMaps, directories);

    // Redact absolute path: Replace absolute root with library ID
    const relativePath = path.relative(absoluteRootDir, r.path);
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
      libraryMode: r.libraryMode
    });
  }

  for (const rootDir in lib) {
    for (const publisherName in lib[rootDir].publishers) {
      const folderName = safeDirName(publisherName);
      const pubLogoDir = path.join(LOGOS_DIRECTORY, folderName);
      const { logoFile, needsBackground } = await resolveLogo(pubLogoDir);

      if (logoFile) {
        lib[rootDir].publishers[publisherName].logoUrl =
          `logos/${encodeURIComponent(folderName)}/${encodeURIComponent(logoFile)}`;
        lib[rootDir].publishers[publisherName].logoNeedsBackground = needsBackground;
      } else {
        // Use default blank logo when no publisher logo exists
        lib[rootDir].publishers[publisherName].logoUrl = 'logos/6373148-blank.png';
        lib[rootDir].publishers[publisherName].logoNeedsBackground = false;
      }
    }
  }

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
