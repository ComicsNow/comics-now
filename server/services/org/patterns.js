const path = require('path');
const { safeDirName } = require('../../utils');
const { DEFAULT_NAMING_RULES, DEFAULT_FOLDER_RULES } = require('../../constants');

/**
 * Format a comic filename from metadata according to configured naming rules.
 */
function formatComicFilename(info = {}, rules = DEFAULT_NAMING_RULES, ext = '.cbz') {
  const tokens = rules.tokens || DEFAULT_NAMING_RULES.tokens;

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

  for (const token of tokens) {
    if (token.mandatory) {
      const val = values[token.id];
      if (!val) {
        throw new Error(`Missing mandatory field: ${token.id}`);
      }
    }
  }

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
  const fileName = pathParts.pop();
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
    if (pathParts.length === 1) {
      result.Series = pathParts[0];
    } else {
      result.Publisher = pathParts[0];
      result.Series = pathParts[pathParts.length - 1];
    }
  }

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

module.exports = {
  formatComicFilename,
  formatFolderPath,
  generateVirtualMetadataFromHierarchy
};
