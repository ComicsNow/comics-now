const {
  ALL_COMIC_FORMATS,
  CONVERTIBLE_COMIC_FORMATS,
  normalizeAllowedFormats
} = require('../services/comic-formats');

function parseBoolFlag(value) {
  return value === true || value === 'true' || value === 'delete';
}

function sanitizeAllowedFormatsSetting(value) {
  if (Array.isArray(value)) {
    const normalized = normalizeAllowedFormats(value);
    return normalized.length === 1 ? normalized[0] : normalized;
  }
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'both' || raw === 'all' || ALL_COMIC_FORMATS.includes(raw)) {
    return raw;
  }
  if (raw.includes(',')) {
    const normalized = normalizeAllowedFormats(raw);
    return normalized.length === 1 ? normalized[0] : normalized;
  }
  return 'cbz';
}

function sanitizeAutoConvertFormats(value) {
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim() ? value.split(',') : []);
  const out = [];
  for (const item of list) {
    const norm = String(item || '').trim().toLowerCase();
    if (CONVERTIBLE_COMIC_FORMATS.includes(norm) && !out.includes(norm)) {
      out.push(norm);
    }
  }
  return out;
}

function createFormatConfigAccessors(config, saveConfigToDisk) {
  function getAllowedFormats() {
    return config.allowed_formats || 'cbz';
  }

  function setAllowedFormats(value, skipSave = false) {
    const sanitized = sanitizeAllowedFormatsSetting(value);
    config.allowed_formats = sanitized;
    if (!skipSave) saveConfigToDisk();
    return sanitized;
  }

  function getAutoConvertEnabled() {
    return config.auto_convert_enabled === true;
  }

  function setAutoConvertEnabled(value, skipSave = false) {
    const sanitized = value === true || value === 'true' || value === 1 || value === '1';
    config.auto_convert_enabled = sanitized;
    if (!skipSave) saveConfigToDisk();
    return sanitized;
  }

  function getAutoConvertFormats() {
    return sanitizeAutoConvertFormats(config.auto_convert_formats);
  }

  function setAutoConvertFormats(value, skipSave = false) {
    const sanitized = sanitizeAutoConvertFormats(value);
    config.auto_convert_formats = sanitized;
    if (!skipSave) saveConfigToDisk();
    return sanitized;
  }

  function getDeleteCbrAfterConversion() {
    return config.delete_cbr_after_conversion === true;
  }

  function setDeleteCbrAfterConversion(value, skipSave = false) {
    const sanitized = parseBoolFlag(value);
    config.delete_cbr_after_conversion = sanitized;
    if (!skipSave) saveConfigToDisk();
    return sanitized;
  }

  function getDeletePdfAfterConversion() {
    return config.delete_pdf_after_conversion === true;
  }

  function setDeletePdfAfterConversion(value, skipSave = false) {
    const sanitized = parseBoolFlag(value);
    config.delete_pdf_after_conversion = sanitized;
    if (!skipSave) saveConfigToDisk();
    return sanitized;
  }

  function getDeleteEpubAfterConversion() {
    return config.delete_epub_after_conversion === true;
  }

  function setDeleteEpubAfterConversion(value, skipSave = false) {
    const sanitized = parseBoolFlag(value);
    config.delete_epub_after_conversion = sanitized;
    if (!skipSave) saveConfigToDisk();
    return sanitized;
  }

  function getMetadataStorage() {
    return config.metadata_storage || 'sidecar';
  }

  function setMetadataStorage(value, skipSave = false) {
    const allowed = ['archive', 'db', 'sidecar'];
    const sanitized = allowed.includes(value) ? value : 'sidecar';
    config.metadata_storage = sanitized;
    if (!skipSave) saveConfigToDisk();
    return sanitized;
  }

  return {
    getAllowedFormats,
    setAllowedFormats,
    getAutoConvertEnabled,
    setAutoConvertEnabled,
    getAutoConvertFormats,
    setAutoConvertFormats,
    getDeleteCbrAfterConversion,
    setDeleteCbrAfterConversion,
    getDeletePdfAfterConversion,
    setDeletePdfAfterConversion,
    getDeleteEpubAfterConversion,
    setDeleteEpubAfterConversion,
    getMetadataStorage,
    setMetadataStorage
  };
}

module.exports = {
  createFormatConfigAccessors,
  sanitizeAllowedFormatsSetting,
  sanitizeAutoConvertFormats
};
