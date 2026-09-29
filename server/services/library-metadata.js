const { generateVirtualMetadataFromHierarchy } = require('./organization');

/**
 * Generates virtual metadata from folder structure and filename.
 * Used for libraries in 'folder' mode.
 */
function generateVirtualMetadata(filePath, libraryRootPath, customFolderRules = null) {
  try {
    const { getFolderRules } = require('../config');
    const folderRules = customFolderRules || (typeof getFolderRules === 'function' ? getFolderRules() : null);
    return generateVirtualMetadataFromHierarchy(filePath, libraryRootPath, folderRules);
  } catch (err) {
    return generateVirtualMetadataFromHierarchy(filePath, libraryRootPath);
  }
}

module.exports = {
  generateVirtualMetadata
};
