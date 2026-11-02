import { state } from './globals.js';
import {
  cleanFormatAndEdition,
  splitVolumeSeriesAndTitle,
  cleanGenreAndTags,
  isTitleSameAsSeries,
  sanitizeMetadata
} from './metadata/sanitizer.js';
import {
  escapeSelector,
  createFormRow,
  createChipInputRow
} from './metadata/form-fields.js';
import {
  createUrlTaggerBox,
  loadMetadata
} from './metadata/url-tagger.js';
import {
  KNOWN_FIELDS,
  renderMetadataDisplay
} from './metadata/display.js';

export {
  loadMetadata,
  createFormRow,
  createChipInputRow,
  renderMetadataDisplay,
  isTitleSameAsSeries,
  cleanFormatAndEdition,
  splitVolumeSeriesAndTitle,
  sanitizeMetadata,
  cleanGenreAndTags,
  escapeSelector,
  createUrlTaggerBox,
  KNOWN_FIELDS
};

if (typeof state !== 'undefined') {
  state.loadMetadata = loadMetadata;
  state.createFormRow = createFormRow;
  state.createChipInputRow = createChipInputRow;
  state.renderMetadataDisplay = renderMetadataDisplay;
  state.isTitleSameAsSeries = isTitleSameAsSeries;
  state.cleanFormatAndEdition = cleanFormatAndEdition;
  state.splitVolumeSeriesAndTitle = splitVolumeSeriesAndTitle;
  state.sanitizeMetadata = sanitizeMetadata;
  state.cleanGenreAndTags = cleanGenreAndTags;
  state.createUrlTaggerBox = createUrlTaggerBox;
}

if (typeof window !== 'undefined') {
  window.loadMetadata = loadMetadata;
  window.createFormRow = createFormRow;
  window.createChipInputRow = createChipInputRow;
  window.renderMetadataDisplay = renderMetadataDisplay;
  window.isTitleSameAsSeries = isTitleSameAsSeries;
  window.cleanFormatAndEdition = cleanFormatAndEdition;
  window.splitVolumeSeriesAndTitle = splitVolumeSeriesAndTitle;
  window.sanitizeMetadata = sanitizeMetadata;
  window.cleanGenreAndTags = cleanGenreAndTags;
  window.createUrlTaggerBox = createUrlTaggerBox;
}
