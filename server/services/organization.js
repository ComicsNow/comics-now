const { DEFAULT_NAMING_RULES, DEFAULT_FOLDER_RULES } = require('../constants');
const {
  formatComicFilename,
  formatFolderPath,
  generateVirtualMetadataFromHierarchy
} = require('./org/patterns');
const { updateComicIdentity } = require('./org/relocator');

module.exports = {
  DEFAULT_NAMING_RULES,
  DEFAULT_FOLDER_RULES,
  formatComicFilename,
  formatFolderPath,
  generateVirtualMetadataFromHierarchy,
  updateComicIdentity
};
