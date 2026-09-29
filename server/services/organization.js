const fs = require('fs');
const path = require('path');
const { safeDirName } = require('../utils');

const DEFAULT_NAMING_RULES = {
  tokens: [
    { id: 'number', enabled: true, mandatory: false },
    { id: 'series', enabled: true, mandatory: true },
    { id: 'title', enabled: true, mandatory: false },
    { id: 'publisher', enabled: true, mandatory: true },
    { id: 'year', enabled: true, mandatory: true },
    { id: 'pages', enabled: true, mandatory: false },
    { id: 'writer', enabled: false, mandatory: false },
    { id: 'volume', enabled: false, mandatory: false }
  ]
};

const DEFAULT_FOLDER_RULES = {
  hierarchy: ['publisher', 'series']
};

/**
 * Format a comic filename from metadata according to configured naming rules.
 */
function formatComicFilename(info = {}, rules = DEFAULT_NAMING_RULES, ext = '.cbz') {
  const tokens = rules.tokens || DEFAULT_NAMING_RULES.tokens;

  // Extract relevant metadata
  const coverDate = info.CoverDate || info['Cover Date'] || info.StoreDate || info['Store Date'] || '';
  const year = info.Year || (coverDate ? coverDate.toString().substring(0, 4) : null);
  const series = (info.Series || '').trim();
  const title = (info.Title || '').trim();
  const publisher = (info.Publisher || '').trim();
  const writer = (info.Writer || '').trim();
  const volume = (info.Volume || '').toString().trim();
  const pages = info.PageCount || info.totalPages || null;

  let issue = '';
  if (info.Number != null && info.Number !== '') {
    issue = info.Number.toString().trim();
    if (/^[0-9]+$/.test(issue)) {
      issue = issue.padStart(2, '0');
    }
  }

  const values = {
    number: issue,
    series: series,
    title: title,
    publisher: publisher,
    year: year,
    pages: pages,
    writer: writer,
    volume: volume
  };

  // Validate mandatory fields
  for (const token of tokens) {
    if (token.mandatory) {
      const val = values[token.id];
      if (!val) {
        throw new Error(`Missing mandatory field: ${token.id}`);
      }
    }
  }

  // Construct parts according to token order
  const parts = [];
  let seriesAppended = false;

  for (const token of tokens) {
    if (!token.enabled) continue;
    const val = values[token.id];
    if (!val) continue;

    switch (token.id) {
      case 'number':
        parts.push(val);
        break;
      case 'series':
        parts.push(val);
        seriesAppended = true;
        break;
      case 'title':
        if (seriesAppended) {
          parts.push(`- ${val}`);
        } else {
          parts.push(val);
        }
        break;
      case 'publisher':
        parts.push(`[${val}]`);
        break;
      case 'year':
        parts.push(`(${val})`);
        break;
      case 'pages':
        parts.push(`#${val}`);
        break;
      case 'writer':
        parts.push(`{${val}}`);
        break;
      case 'volume':
        parts.push(`Vol. ${val}`);
        break;
      default:
        parts.push(val);
    }
  }

  let baseName = parts.join(' ').trim();
  if (!baseName) {
    baseName = series || 'Unknown';
  }

  // Sanitize filename: replace slashes with dash, strip other illegal characters
  baseName = baseName
    .replace(/[/\\]/g, '-')
    .replace(/[*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const extension = ext.startsWith('.') ? ext : `.${ext}`;
  return `${baseName}${extension}`;
}

/**
 * Format relative folder path according to configured folder rules.
 */
function formatFolderPath(info = {}, rules = DEFAULT_FOLDER_RULES) {
  const hierarchy = (rules && rules.hierarchy && rules.hierarchy.length > 0)
    ? rules.hierarchy
    : DEFAULT_FOLDER_RULES.hierarchy;

  const coverDate = info.CoverDate || info['Cover Date'] || info.StoreDate || info['Store Date'] || '';
  const year = info.Year || (coverDate ? coverDate.toString().substring(0, 4) : 'Unknown Year');
  const series = (info.Series || 'Unknown Series').trim();
  const publisher = (info.Publisher || 'Unknown Publisher').trim();
  const writer = (info.Writer || 'Unknown Writer').trim();
  let volume = (info.Volume || '').toString().trim();
  if (!volume) {
    volume = 'Vol. 1';
  } else if (!volume.toLowerCase().startsWith('vol')) {
    volume = `Vol. ${volume}`;
  }

  const values = {
    publisher: safeDirName(publisher),
    writer: safeDirName(writer),
    series: safeDirName(series),
    volume: safeDirName(volume),
    year: safeDirName(year)
  };

  const pathSegments = hierarchy.map(token => values[token] || safeDirName(`Unknown ${token}`));
  return path.join(...pathSegments);
}

/**
 * Generate virtual metadata for folder mode aware of hierarchy depth.
 */
function generateVirtualMetadataFromHierarchy(filePath, libraryRootPath, folderRules = DEFAULT_FOLDER_RULES) {
  const relativePath = path.relative(libraryRootPath, filePath);
  const pathParts = relativePath.split(path.sep);
  const fileName = pathParts.pop(); // Remove filename
  const rootDirName = path.basename(libraryRootPath);

  const hierarchy = (folderRules && folderRules.hierarchy && folderRules.hierarchy.length > 0)
    ? folderRules.hierarchy
    : DEFAULT_FOLDER_RULES.hierarchy;

  const result = {
    Publisher: rootDirName,
    Series: rootDirName,
    Title: path.parse(fileName).name,
    Number: '',
    Writer: '',
    Volume: '',
    Year: ''
  };

  // If pathParts matches hierarchy depth
  if (pathParts.length >= hierarchy.length) {
    hierarchy.forEach((token, idx) => {
      const val = pathParts[idx];
      if (token === 'publisher') result.Publisher = val;
      if (token === 'series') result.Series = val;
      if (token === 'writer') result.Writer = val;
      if (token === 'volume') result.Volume = val;
      if (token === 'year') result.Year = val;
    });
  } else if (pathParts.length > 0) {
    // Fewer directories than hierarchy depth: map first directory to publisher (if > 1) or series (if 1)
    if (pathParts.length === 1) {
      result.Series = pathParts[0];
    } else {
      result.Publisher = pathParts[0];
      result.Series = pathParts[pathParts.length - 1];
    }
  }

  // Parse issue number from filename
  const title = result.Title;
  const specificMatch = title.match(/(?:#|No\.?)\s*(\d+)/i);
  if (specificMatch) {
    result.Number = specificMatch[1];
  } else {
    const endMatch = title.trim().match(/(\d+)$/);
    if (endMatch) {
      result.Number = endMatch[1];
    } else {
      const standaloneMatch = title.match(/(?:\D|^)(\d+)(?:\D|$)/);
      if (standaloneMatch) {
        result.Number = standaloneMatch[1];
      } else {
        const anyMatch = title.match(/(\d+)/);
        if (anyMatch) {
          result.Number = anyMatch[1];
        }
      }
    }
  }

  if (result.Number && /^\d+$/.test(result.Number)) {
    result.Number = parseInt(result.Number, 10).toString();
  }

  return result;
}

/**
 * Updates comic file, sidecar ComicInfo.xml, thumbnail, guided view sidecar, and DB references.
 */
async function updateComicIdentity({
  dbRun,
  oldId,
  newId,
  oldPath,
  newPath,
  newName,
  thumbnailsDir,
  guidedViewDir
}) {
  // 1. Move/Rename comic file if path changed
  if (oldPath !== newPath && fs.existsSync(oldPath)) {
    const destDir = path.dirname(newPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    try {
      fs.renameSync(oldPath, newPath);
    } catch (renameErr) {
      if (renameErr.code === 'EXDEV') {
        fs.copyFileSync(oldPath, newPath);
        fs.unlinkSync(oldPath);
      } else {
        throw renameErr;
      }
    }
  }

  // 2. Move/Rename adjacent .ComicInfo.xml sidecar
  const oldExt = path.extname(oldPath);
  const newExt = path.extname(newPath);
  const oldSidecar = path.join(path.dirname(oldPath), path.basename(oldPath, oldExt) + '.ComicInfo.xml');
  if (fs.existsSync(oldSidecar)) {
    const newSidecar = path.join(path.dirname(newPath), path.basename(newPath, newExt) + '.ComicInfo.xml');
    try {
      fs.renameSync(oldSidecar, newSidecar);
    } catch (sErr) {
      if (sErr.code === 'EXDEV') {
        fs.copyFileSync(oldSidecar, newSidecar);
        fs.unlinkSync(oldSidecar);
      } else {
        console.warn(`[ORGANIZATION] Failed to move sidecar: ${sErr.message}`);
      }
    }
  }

  // 3. Rename thumbnail in thumbnailsDir if old thumbnail exists
  if (thumbnailsDir && oldId !== newId) {
    const oldThumb = path.join(thumbnailsDir, `${oldId}.jpg`);
    const newThumb = path.join(thumbnailsDir, `${newId}.jpg`);
    if (fs.existsSync(oldThumb)) {
      try {
        fs.renameSync(oldThumb, newThumb);
      } catch (tErr) {
        console.warn(`[ORGANIZATION] Failed to rename thumbnail: ${tErr.message}`);
      }
    }
  }

  // 4. Rename Guided View sidecar in guidedViewDir if it exists
  let newGvPath = null;
  if (guidedViewDir && oldId !== newId) {
    const oldGv = path.join(guidedViewDir, `${oldId}.json`);
    const newGv = path.join(guidedViewDir, `${newId}.json`);
    if (fs.existsSync(oldGv)) {
      try {
        fs.renameSync(oldGv, newGv);
        newGvPath = path.join('metadata', 'guided_view', `${newId}.json`);
      } catch (gErr) {
        console.warn(`[ORGANIZATION] Failed to rename guided view sidecar: ${gErr.message}`);
      }
    }
  }

  // 5. Update Database Records
  if (typeof dbRun === 'function') {
    const newThumbFilename = `${newId}.jpg`;
    await dbRun(
      'UPDATE comics SET id = ?, path = ?, name = ?, thumbnailPath = ?, guidedViewPath = COALESCE(?, guidedViewPath) WHERE id = ?',
      [newId, newPath, newName, newThumbFilename, newGvPath, oldId]
    );

    // Update cascading/related tables
    try {
      await dbRun('UPDATE progress SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    } catch (_) {}
    try {
      await dbRun('UPDATE device_progress SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    } catch (_) {}
    try {
      await dbRun('UPDATE reading_list_items SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    } catch (_) {}
    try {
      await dbRun('UPDATE user_bookmarks SET comicId = ? WHERE comicId = ?', [newId, oldId]);
    } catch (_) {}
    try {
      await dbRun('UPDATE reading_mode_preferences SET targetId = ? WHERE targetId = ? AND preferenceType = ?', [newId, oldId, 'comic']);
    } catch (_) {}
  }
}

module.exports = {
  DEFAULT_NAMING_RULES,
  DEFAULT_FOLDER_RULES,
  formatComicFilename,
  formatFolderPath,
  generateVirtualMetadataFromHierarchy,
  updateComicIdentity
};
