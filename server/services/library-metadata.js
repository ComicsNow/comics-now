const path = require('path');

/**
 * Generates virtual metadata from folder structure and filename.
 * Used for libraries in 'folder' mode.
 */
function generateVirtualMetadata(filePath, libraryRootPath) {
  const relativePath = path.relative(libraryRootPath, filePath);
  const pathParts = relativePath.split(path.sep);
  const rootDirName = path.basename(libraryRootPath);

  // Publisher: Immediate subfolder of library root, or root folder name if at root
  let publisher = rootDirName;
  if (pathParts.length > 1) {
    publisher = pathParts[0];
  }

  // Series: Name of the parent folder of the comic file
  const parentDir = path.dirname(filePath);
  let series = rootDirName;
  if (path.normalize(parentDir) !== path.normalize(libraryRootPath)) {
    series = path.basename(parentDir);
  }

  const fileName = path.basename(filePath);
  const title = path.parse(fileName).name;

  // Issue: Attempt to parse a number from the filename
  let issue = "";

  // Try to find #123 or No. 123 first as they are very specific
  const specificMatch = title.match(/(?:#|No\.?)\s*(\d+)/i);
  if (specificMatch) {
    issue = specificMatch[1];
  } else {
    // Try to find a number at the end of the string (ignoring trailing whitespace)
    const endMatch = title.trim().match(/(\d+)$/);
    if (endMatch) {
      issue = endMatch[1];
    } else {
      // Fallback: standalone number
      const standaloneMatch = title.match(/(?:\D|^)(\d+)(?:\D|$)/);
      if (standaloneMatch) {
        issue = standaloneMatch[1];
      } else {
        // Absolute fallback: first number found
        const anyMatch = title.match(/(\d+)/);
        if (anyMatch) {
          issue = anyMatch[1];
        }
      }
    }
  }

  return {
    Publisher: publisher,
    Series: series,
    Title: title,
    Number: issue
  };
}

module.exports = {
  generateVirtualMetadata
};
