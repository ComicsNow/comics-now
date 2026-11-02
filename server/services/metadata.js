const {
  CANONICAL_PUBLISHER_MAP,
  IGNORED_FOREIGN_PUBLISHERS,
  isForeignPublisher,
  isEnglishText,
  normalizePublisher,
  cleanDescription
} = require('./metadata/heuristics');

const {
  cleanFormatAndEdition,
  splitVolumeSeriesAndTitle,
  cleanGenreAndTags,
  isTitleSameAsSeries,
  sanitizeMetadata
} = require('./metadata/sanitizer');

const {
  COMICINFO_TAGS,
  resolveCreatorRoles,
  buildComicInfoXml
} = require('./metadata/enricher');

const {
  getComicInfoFromArchive,
  writeComicInfoToCbz,
  createSaveMetadataToComic
} = require('./metadata/archive');

const {
  synthesizeMetadataDeterministic
} = require('./metadata/merger');

const saveMetadataToComic = createSaveMetadataToComic(() => module.exports.writeComicInfoToCbz);

module.exports = {
  COMICINFO_TAGS,
  CANONICAL_PUBLISHER_MAP,
  IGNORED_FOREIGN_PUBLISHERS,
  isForeignPublisher,
  isEnglishText,
  getComicInfoFromArchive,
  saveMetadataToComic,
  writeComicInfoToCbz,
  buildComicInfoXml,
  cleanFormatAndEdition,
  normalizePublisher,
  cleanDescription,
  cleanGenreAndTags,
  splitVolumeSeriesAndTitle,
  isTitleSameAsSeries,
  sanitizeMetadata,
  resolveCreatorRoles,
  synthesizeMetadataDeterministic
};
