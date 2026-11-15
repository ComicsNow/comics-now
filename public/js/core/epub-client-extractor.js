const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

function isImagePath(name) {
  return IMAGE_EXT_RE.test(String(name || ''));
}

function getImageMimeType(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

function dirnamePosix(p) {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}

function resolveRelativePosix(baseDir, href) {
  if (!href) return '';
  const clean = decodeURIComponent(String(href).split('#')[0].split('?')[0]);
  const parts = (baseDir ? `${baseDir}/${clean}` : clean).split('/');
  const stack = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

async function resolveOrderedComicImages(zip) {
  const allEntries = Object.keys(zip.files).filter((name) => zip.files[name] && !zip.files[name].dir);
  const entrySet = new Set(allEntries);
  const ordered = [];
  const seen = new Set();

  const pushIfImage = (entryName) => {
    if (entryName && entrySet.has(entryName) && isImagePath(entryName) && !seen.has(entryName)) {
      seen.add(entryName);
      ordered.push(entryName);
    }
  };

  let opfPath = null;
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile && typeof DOMParser !== 'undefined') {
    const xmlText = await containerFile.async('text');
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const rootfile = doc.querySelector('rootfile');
    opfPath = rootfile?.getAttribute('full-path') || null;
  }
  if (!opfPath || !entrySet.has(opfPath)) {
    opfPath = allEntries.find((n) => n.toLowerCase().endsWith('.opf')) || null;
  }

  if (opfPath && entrySet.has(opfPath) && typeof DOMParser !== 'undefined') {
    const opfDir = dirnamePosix(opfPath);
    const opfText = await zip.file(opfPath).async('text');
    const opfDoc = new DOMParser().parseFromString(opfText, 'application/xml');
    const manifestMap = new Map();

    opfDoc.querySelectorAll('manifest > item').forEach((item) => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (id && href) {
        manifestMap.set(id, {
          href: resolveRelativePosix(opfDir, href),
          mediaType: String(item.getAttribute('media-type') || '').toLowerCase(),
          properties: String(item.getAttribute('properties') || '').toLowerCase().split(/\s+/)
        });
      }
    });

    opfDoc.querySelectorAll('metadata > meta').forEach((m) => {
      if (m.getAttribute('name') === 'cover') {
        const ref = manifestMap.get(m.getAttribute('content'));
        if (ref) pushIfImage(ref.href);
      }
    });
    for (const item of manifestMap.values()) {
      if (item.properties.includes('cover-image')) {
        pushIfImage(item.href);
      }
    }

    const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref'))
      .map((r) => r.getAttribute('idref'))
      .filter(Boolean);

    for (const idref of spineRefs) {
      const item = manifestMap.get(idref);
      if (!item || !entrySet.has(item.href)) continue;
      if (isImagePath(item.href) || item.mediaType.startsWith('image/')) {
        pushIfImage(item.href);
        continue;
      }
      if (item.mediaType.includes('html') || /\.(xhtml|html|htm|svg)$/i.test(item.href)) {
        const html = await zip.file(item.href).async('text');
        const htmlDoc = new DOMParser().parseFromString(html, 'text/html');
        const itemDir = dirnamePosix(item.href);
        htmlDoc.querySelectorAll('img, image').forEach((el) => {
          const src = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href');
          if (src) pushIfImage(resolveRelativePosix(itemDir, src));
        });
      }
    }
  }

  if (ordered.length === 0) {
    const fallback = allEntries
      .filter((n) => isImagePath(n) && !n.split(/[\\/]/).some((p) => p.startsWith('.') || p === '__MACOSX'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    for (const name of fallback) pushIfImage(name);
  }

  if (ordered.length === 0) {
    throw new Error('No comic images found in EPUB');
  }
  return ordered;
}

export async function openEpubClientArchive(arrayBuffer, JSZipCtor) {
  if (!JSZipCtor) {
    throw new Error('JSZip not found');
  }
  const zip = await new JSZipCtor().loadAsync(arrayBuffer);
  const pages = await resolveOrderedComicImages(zip);

  const extractEntryBlob = async (entryName) => {
    const pageFile = zip.file(entryName);
    if (!pageFile) {
      throw new Error(`Entry not found in EPUB: ${entryName}`);
    }
    const rawBlob = await pageFile.async('blob');
    if (rawBlob && rawBlob.type) return rawBlob;
    return new Blob([rawBlob], { type: getImageMimeType(entryName) });
  };

  return {
    type: 'epub',
    zip,
    listEntries: () => pages.slice(),
    getCoverEntryName: () => pages[0] || null,
    extractEntryBlob,
    getPageBlob: extractEntryBlob,
    close: () => {}
  };
}
