const path = require('path');
const yauzl = require('yauzl');
const xml2js = require('xml2js');
const { isImage } = require('../../utils');

const IMG_TAG_SRC_RE = /<(?:img|image)\b[^>]*?(?:src|xlink:href|href)\s*=\s*["']([^"']+)["']/gi;

function isSafeEntry(name) {
  if (typeof name !== 'string' || path.isAbsolute(name)) return false;
  return !name.split(/[\\/]/).includes('..');
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) return reject(err);
      const entries = new Map();
      zipfile.on('entry', (entry) => {
        if (!/\/$/.test(entry.fileName) && isSafeEntry(entry.fileName)) {
          entries.set(entry.fileName, entry);
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve({ zipfile, entries }));
      zipfile.on('error', (e) => {
        try { zipfile.close(); } catch (_) {}
        reject(e);
      });
      zipfile.readEntry();
    });
  });
}

function readZipEntryBuffer(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

function resolveZipRelative(baseDir, href) {
  if (!href) return '';
  const clean = decodeURIComponent(String(href).split('#')[0].split('?')[0]);
  const joined = baseDir ? path.posix.join(baseDir, clean) : clean;
  return joined.replace(/^\/+/, '');
}

async function parseOpfFromZip(zipfile, entries) {
  const containerEntry = entries.get('META-INF/container.xml');
  let opfPath = null;
  if (containerEntry) {
    const containerXml = (await readZipEntryBuffer(zipfile, containerEntry)).toString('utf8');
    const parsed = await xml2js.parseStringPromise(containerXml, { explicitArray: false });
    const rootfile = parsed?.container?.rootfiles?.rootfile;
    const first = Array.isArray(rootfile) ? rootfile[0] : rootfile;
    opfPath = first?.$?.['full-path'] || null;
  }
  if (!opfPath || !entries.has(opfPath)) {
    opfPath = Array.from(entries.keys()).find((k) => k.toLowerCase().endsWith('.opf')) || null;
  }
  if (!opfPath || !entries.has(opfPath)) return null;

  const opfXml = (await readZipEntryBuffer(zipfile, entries.get(opfPath))).toString('utf8');
  const opf = await xml2js.parseStringPromise(opfXml, { explicitArray: true });
  return { opfPath, opfDir: path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath), opf };
}

function extractOpfManifestAndSpine(parsedOpf) {
  const pkg = parsedOpf?.opf?.package || {};
  const manifestItems = new Map();
  const manifestList = pkg.manifest?.[0]?.item || [];
  for (const item of manifestList) {
    const attrs = item.$ || {};
    if (attrs.id && attrs.href) {
      manifestItems.set(attrs.id, {
        id: attrs.id,
        href: resolveZipRelative(parsedOpf.opfDir, attrs.href),
        mediaType: String(attrs['media-type'] || '').toLowerCase(),
        properties: String(attrs.properties || '').toLowerCase().split(/\s+/)
      });
    }
  }
  const spineRefs = (pkg.spine?.[0]?.itemref || []).map((r) => r.$?.idref).filter(Boolean);
  return { pkg, manifestItems, spineRefs };
}

async function resolveEpubComicPages(zipfile, entries) {
  const parsedOpf = await parseOpfFromZip(zipfile, entries);
  const ordered = [];
  const seen = new Set();
  const pushIfImage = (entryName) => {
    if (entryName && entries.has(entryName) && isImage(entryName) && !seen.has(entryName)) {
      seen.add(entryName);
      ordered.push(entryName);
    }
  };

  if (parsedOpf) {
    const { pkg, manifestItems, spineRefs } = extractOpfManifestAndSpine(parsedOpf);
    // Prioritize explicit cover image first if declared
    const metas = pkg.metadata?.[0]?.meta || [];
    for (const m of metas) {
      if (m.$?.name === 'cover' && m.$?.content && manifestItems.has(m.$.content)) {
        pushIfImage(manifestItems.get(m.$.content).href);
      }
    }
    for (const item of manifestItems.values()) {
      if (item.properties.includes('cover-image')) {
        pushIfImage(item.href);
      }
    }

    for (const idref of spineRefs) {
      const item = manifestItems.get(idref);
      if (!item || !entries.has(item.href)) continue;
      if (isImage(item.href) || item.mediaType.startsWith('image/')) {
        pushIfImage(item.href);
        continue;
      }
      if (item.mediaType.includes('html') || /\.(xhtml|html|htm|svg)$/i.test(item.href)) {
        const html = (await readZipEntryBuffer(zipfile, entries.get(item.href))).toString('utf8');
        const itemDir = path.posix.dirname(item.href) === '.' ? '' : path.posix.dirname(item.href);
        IMG_TAG_SRC_RE.lastIndex = 0;
        let match;
        while ((match = IMG_TAG_SRC_RE.exec(html)) !== null) {
          if (match[1]) pushIfImage(resolveZipRelative(itemDir, match[1]));
        }
      }
    }
  }

  // Fallback: natural-sorted image entries in ZIP (excluding hidden / __MACOSX)
  if (ordered.length === 0) {
    const fallbackImages = Array.from(entries.keys())
      .filter((n) => isImage(n) && !n.split(/[\\/]/).some((p) => p.startsWith('.') || p === '__MACOSX'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    for (const img of fallbackImages) pushIfImage(img);
  }

  if (ordered.length === 0) {
    throw new Error('No comic images found in EPUB');
  }
  return ordered;
}

function textVal(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'object' && '_' in node) return String(node._ || '').trim();
  return '';
}

async function parseEpubOpfMetadata(filePath) {
  const { zipfile, entries } = await openZip(filePath);
  try {
    const parsedOpf = await parseOpfFromZip(zipfile, entries);
    if (!parsedOpf) return null;
    const metaNode = parsedOpf.opf?.package?.metadata?.[0] || {};
    const title = textVal(metaNode['dc:title']?.[0]);
    const writer = textVal(metaNode['dc:creator']?.[0]);
    const publisher = textVal(metaNode['dc:publisher']?.[0]);
    const summary = textVal(metaNode['dc:description']?.[0]);
    const dateStr = textVal(metaNode['dc:date']?.[0]);
    const subjects = (metaNode['dc:subject'] || []).map(textVal).filter(Boolean);
    let series = '';
    let number = '';
    for (const m of metaNode.meta || []) {
      const name = m.$?.name || m.$?.property || '';
      const content = m.$?.content || textVal(m);
      if (name === 'calibre:series' || name === 'belongs-to-collection') series = series || content;
      if (name === 'calibre:series_index' || name === 'group-position') number = number || content;
    }
    let year = null;
    let month = null;
    const dm = dateStr.match(/^(\d{4})(?:-(\d{1,2}))?/);
    if (dm) {
      year = parseInt(dm[1], 10);
      if (dm[2]) month = parseInt(dm[2], 10);
    }
    return {
      title: title || null,
      writer: writer || null,
      publisher: publisher || null,
      summary: summary || null,
      genre: subjects.join(', ') || null,
      series: series || null,
      number: number || null,
      year,
      month
    };
  } finally {
    try { zipfile.close(); } catch (_) {}
  }
}

async function getEpubCoverEntry(filePath) {
  const { zipfile, entries } = await openZip(filePath);
  try {
    const pages = await resolveEpubComicPages(zipfile, entries);
    return pages[0] || null;
  } finally {
    try { zipfile.close(); } catch (_) {}
  }
}

async function createEpubReader(filePath) {
  const { zipfile, entries } = await openZip(filePath);
  try {
    const pages = await resolveEpubComicPages(zipfile, entries);
    return {
      zipfile,
      orderedPages: pages,
      listEntries() {
        return [...pages];
      },
      async readBuffer(entryName) {
        const entry = entries.get(entryName);
        if (!entry) throw new Error('Entry not found: ' + entryName);
        return readZipEntryBuffer(zipfile, entry);
      },
      close() {
        try { zipfile.close(); } catch (_) {}
      }
    };
  } catch (err) {
    try { zipfile.close(); } catch (_) {}
    throw err;
  }
}

async function openEpubSession(filePath) {
  const reader = await createEpubReader(filePath);
  return {
    pages: [...reader.orderedPages],
    readBuffer: (name) => reader.readBuffer(name),
    close: async () => reader.close()
  };
}

module.exports = {
  createEpubReader,
  openEpubSession,
  getEpubCoverEntry,
  parseEpubOpfMetadata
};
