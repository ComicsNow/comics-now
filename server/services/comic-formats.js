const path = require('path');

/**
 * Read-side visibility check for the Allowed Library Formats setting.
 * Only .cbz/.cbr are in scope; unknown or extensionless names stay visible.
 */
function isComicFormatAllowed(fileNameOrPath, allowedFormats = 'cbz') {
    const ext = path.extname(String(fileNameOrPath || '')).toLowerCase();
    if (ext !== '.cbz' && ext !== '.cbr') return true;

    const mode = String(allowedFormats || 'cbz').trim().toLowerCase();
    const effective = (mode === 'cbr' || mode === 'both') ? mode : 'cbz';

    if (ext === '.cbz') return effective === 'cbz' || effective === 'both';
    return effective === 'cbr' || effective === 'both';
}

module.exports = { isComicFormatAllowed };
