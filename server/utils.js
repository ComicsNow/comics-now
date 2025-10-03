const crypto = require('crypto');

function createId(p) {
  return crypto.createHash('sha1').update(p).digest('hex');
}

function safeDirName(str) {
  return String(str).trim().replace(/[\\/]+/g, '_').replace(/\s+/g, ' ');
}

function getMimeFromExt(name) {
  const ext = name.toLowerCase();
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.webp')) return 'image/webp';
  if (ext.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

module.exports = {
  createId,
  safeDirName,
  getMimeFromExt
};
