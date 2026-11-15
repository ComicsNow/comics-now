const { createPdfReader } = require('./document-pages/pdf-reader');
const { createEpubReader } = require('./document-pages/epub-reader');

function isDocumentExtension(ext) {
  return ext === '.pdf' || ext === '.epub';
}

async function openDocumentArchive(ext, filePath) {
  if (ext === '.pdf') {
    return createPdfReader(filePath);
  }
  if (ext === '.epub') {
    return createEpubReader(filePath);
  }
  throw new Error('Unsupported document format: ' + ext);
}

module.exports = {
  isDocumentExtension,
  openDocumentArchive
};
