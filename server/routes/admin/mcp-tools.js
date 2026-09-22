const fs = require('fs');
const path = require('path');

const { ROOT_DIR } = require('../../constants');
const { getMetadataStorage } = require('../../config');

// Guided-view sidecars live here (mirrors panel-detector.js GUIDED_VIEW_DIR and
// the reconnect logic in library-scan.js). Computed from ROOT_DIR directly so we
// don't load the ONNX runtime just to write a JSON file.
const GUIDED_VIEW_DIR = path.join(ROOT_DIR, 'metadata', 'guided_view');

/**
 * Admin endpoints that back the MCP server's guided-view authoring and tagging
 * tools. These deliberately reuse the app's existing metadata writers so the
 * MCP layer (or a future in-app assistant) never reimplements zip/XML logic.
 *
 *   GET  /api/v1/comics/:id/guided-pages     list pages for a comic
 *   GET  /api/v1/comics/:id/page-image?page= stream one native page image
 *   POST /api/v1/comics/:id/guided-view      write an AI-authored guided view
 *   GET  /api/v1/comics/:id/tags             read current ComicInfo + DB tags
 *   POST /api/v1/comics/:id/tags             write ComicInfo (sidecar/zip/db)
 */
module.exports = function attach(router, deps) {
  const { dbGet, dbRun, dbAll, log, formatErrorMessage, getComicPages, getMimeFromExt } = deps;
  const metadata = require('../../services/metadata');

  async function getComic(id) {
    return dbGet(
      'SELECT id, path, name, series, publisher, metadata, totalPages, guidedViewStatus, tagStatus FROM comics WHERE id = ?',
      [id]
    );
  }

  async function readComicTags(comic) {
    let comicInfo = null;
    if (comic.path && fs.existsSync(comic.path)) {
      comicInfo = await metadata.getComicInfoFromArchive(comic.path).catch(() => null);
    }
    let dbMetadata = null;
    try { dbMetadata = comic.metadata ? JSON.parse(comic.metadata) : null; } catch { dbMetadata = comic.metadata; }
    return {
      comicId: comic.id,
      name: comic.name,
      path: comic.path,
      publisher: comic.publisher,
      series: comic.series,
      totalPages: comic.totalPages,
      tagStatus: comic.tagStatus || 'pending',
      comicInfo,
      dbMetadata
    };
  }

  async function applyComicTags(comic, fields, storagePreference) {
    if (!comic) {
      throw new Error('Comic not found');
    }
    const storage = ['sidecar', 'archive', 'db'].includes(storagePreference)
      ? storagePreference
      : (getMetadataStorage() || 'sidecar');

    if (storage !== 'db') {
      if (!comic.path || !fs.existsSync(comic.path)) {
        throw new Error('Comic file missing on disk');
      }
      const ext = path.extname(comic.path).toLowerCase();
      const xml = metadata.buildComicInfoXml(fields);
      if (!xml) throw new Error('No valid ComicInfo fields to write');
      if (storage === 'sidecar') {
        const sidecarPath = path.join(path.dirname(comic.path), path.basename(comic.path, ext) + '.ComicInfo.xml');
        await fs.promises.writeFile(sidecarPath, xml, 'utf-8');
      } else { // archive
        if (ext === '.cbr') throw new Error('CBR archives cannot be written; use sidecar or db');
        await metadata.writeComicInfoToCbz(comic.path, xml);
      }
    }

    let existingMeta = {};
    try { existingMeta = comic.metadata ? JSON.parse(comic.metadata) : {}; } catch { existingMeta = {}; }
    const mergedMeta = { ...existingMeta, ...fields };
    await dbRun(
      'UPDATE comics SET tagStatus = ?, publisher = COALESCE(?, publisher), series = COALESCE(?, series), metadata = ? WHERE id = ?',
      ['completed', fields.Publisher || null, fields.Series || null, JSON.stringify(mergedMeta), comic.id]
    );

    return { storage, fields };
  }

  // --- Guided view: list pages ---------------------------------------------
  router.get('/api/v1/comics/:id/guided-pages', async (req, res) => {
    try {
      const comic = await getComic(req.params.id);
      if (!comic) return res.status(404).json({ ok: false, message: 'Comic not found' });
      if (!comic.path || !fs.existsSync(comic.path)) {
        return res.status(404).json({ ok: false, message: 'Comic file missing on disk' });
      }
      const pages = await getComicPages(comic.path);
      res.json({
        ok: true,
        comicId: comic.id,
        name: comic.name,
        pageCount: pages.length,
        guidedViewStatus: comic.guidedViewStatus || 'pending',
        pages: pages.map((name, index) => ({ index, name }))
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to list pages') });
    }
  });

  // --- Guided view: stream one native-resolution page image ----------------
  router.get('/api/v1/comics/:id/page-image', async (req, res) => {
    try {
      const comic = await getComic(req.params.id);
      if (!comic || !comic.path || !fs.existsSync(comic.path)) return res.status(404).end();
      const pageName = typeof req.query.page === 'string' ? req.query.page : '';
      if (!pageName) return res.status(400).end();

      const { getEntryBuffer } = require('../../services/archive-utils');
      const buffer = await getEntryBuffer(comic.path, pageName);
      if (!buffer) return res.status(404).end();
      res.setHeader('Content-Type', getMimeFromExt(pageName));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buffer);
    } catch (e) {
      log('ERROR', 'MCP', `page-image failed: ${e.message}`);
      res.status(500).end();
    }
  });

  // --- Guided view: write an AI-authored sidecar ---------------------------
  // Body: { type: 'manga'|'western', pages: { "<pageName>": { panels:[[x,y,w,h],...],
  //         bubbles?:[[...]], sequence?:[[...]] } } }
  // Coordinates are absolute pixels [x, y, w, h] in the page's native resolution.
  router.post('/api/v1/comics/:id/guided-view', async (req, res) => {
    try {
      const comic = await getComic(req.params.id);
      if (!comic) return res.status(404).json({ ok: false, message: 'Comic not found' });

      const body = req.body || {};
      const type = body.type === 'manga' ? 'manga' : 'western';
      const pagesIn = body.pages;
      if (!pagesIn || typeof pagesIn !== 'object' || Array.isArray(pagesIn)) {
        return res.status(400).json({ ok: false, message: 'pages must be an object keyed by page name' });
      }

      // Coordinate space. 'normalized' (default): boxes are fractions 0..1 of the
      // page, scaled here to each page's TRUE native pixel size (measured with
      // sharp). Scale-invariant, so it doesn't matter what resolution the
      // authoring model actually saw (clients often downscale images). 'absolute':
      // boxes are already native pixels (what the ONNX detector produces).
      const coords = body.coords === 'absolute' ? 'absolute' : 'normalized';
      const sharp = require('sharp');
      const { getEntryBuffer } = require('../../services/archive-utils');

      const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number' && isFinite(n));
      const dimsCache = {};
      async function pageDims(pageName) {
        if (dimsCache[pageName]) return dimsCache[pageName];
        const buf = await getEntryBuffer(comic.path, pageName);
        const meta = await sharp(buf).metadata();
        dimsCache[pageName] = { w: meta.width, h: meta.height };
        return dimsCache[pageName];
      }
      async function scaleBoxes(arr, pageName) {
        const valid = (Array.isArray(arr) ? arr : []).filter(isBox);
        if (coords === 'absolute') return valid.map(b => b.map(n => Math.round(n)));
        try {
          const { w, h } = await pageDims(pageName);
          return valid.map(([x, y, bw, bh]) => [Math.round(x * w), Math.round(y * h), Math.round(bw * w), Math.round(bh * h)]);
        } catch (err) {
          log('WARN', 'MCP', `Could not measure ${pageName}; storing boxes as-is: ${err.message}`);
          return valid.map(b => b.map(n => Math.round(n)));
        }
      }

      const pagesOut = {};
      let totalPanels = 0;
      for (const [pageName, spec] of Object.entries(pagesIn)) {
        const s = spec || {};
        const panels = await scaleBoxes(s.panels, pageName);
        const bubbles = await scaleBoxes(s.bubbles, pageName);
        let sequence = await scaleBoxes(s.sequence, pageName);
        if (sequence.length === 0) sequence = panels; // default reading order = panels
        pagesOut[pageName] = { panels, bubbles, sequence };
        totalPanels += panels.length;
      }

      if (Object.keys(pagesOut).length === 0) {
        return res.status(400).json({ ok: false, message: 'No valid pages provided' });
      }

      const result = { comicId: comic.id, type, pages: pagesOut };
      await fs.promises.mkdir(GUIDED_VIEW_DIR, { recursive: true });
      const outPath = path.join(GUIDED_VIEW_DIR, `${comic.id}.json`);
      await fs.promises.writeFile(outPath, JSON.stringify(result, null, 2));

      await dbRun(
        "UPDATE comics SET guidedViewStatus = 'completed', guidedViewError = NULL, guidedViewPath = ? WHERE id = ?",
        [outPath, comic.id]
      );

      log('INFO', 'MCP', `Guided view written for ${comic.name} (${Object.keys(pagesOut).length} pages, ${totalPanels} panels)`);
      res.json({ ok: true, comicId: comic.id, type, pages: Object.keys(pagesOut).length, panels: totalPanels, path: outPath });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to write guided view') });
    }
  });

  // --- Tags: batch read metadata for multiple comics ----------------------
  // Body: { comicIds: string[] }
  router.post('/api/v1/comics/tags/batch', async (req, res) => {
    try {
      const { comicIds } = req.body || {};
      if (!comicIds || !Array.isArray(comicIds) || comicIds.length === 0) {
        return res.status(400).json({ ok: false, message: 'comicIds array is required' });
      }
      const placeholders = comicIds.map(() => '?').join(',');
      const comics = await dbAll(
        `SELECT id, path, name, series, publisher, metadata, totalPages, tagStatus FROM comics WHERE id IN (${placeholders})`,
        comicIds
      );
      const comicMap = new Map(comics.map(c => [c.id, c]));
      const items = [];
      const notFound = [];

      for (const id of comicIds) {
        const comic = comicMap.get(id);
        if (!comic) {
          notFound.push(id);
          continue;
        }
        const tagData = await readComicTags(comic);
        items.push({ ok: true, ...tagData });
      }

      res.json({
        ok: true,
        count: items.length,
        items,
        notFound
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to read batch tags') });
    }
  });

  // --- Tags: read current metadata (single comic) -------------------------
  router.get('/api/v1/comics/:id/tags', async (req, res) => {
    try {
      const comic = await getComic(req.params.id);
      if (!comic) return res.status(404).json({ ok: false, message: 'Comic not found' });
      const data = await readComicTags(comic);
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to read tags') });
    }
  });

  // --- Tags: write ComicInfo in bulk ---------------------------------------
  // Body can be either:
  // 1) { items: [{ comicId, fields, storage? }], storage?: 'sidecar'|'archive'|'db' }
  // 2) { comicIds: string[], fields: object, storage?: 'sidecar'|'archive'|'db' }
  router.post('/api/v1/comics/tags/bulk', async (req, res) => {
    try {
      const body = req.body || {};
      const defaultStorage = ['sidecar', 'archive', 'db'].includes(body.storage)
        ? body.storage
        : (getMetadataStorage() || 'sidecar');

      let operations = [];
      if (Array.isArray(body.items) && body.items.length > 0) {
        operations = body.items.map(item => ({
          comicId: item.comicId || item.comic_id || item.id,
          fields: item.fields,
          storage: ['sidecar', 'archive', 'db'].includes(item.storage) ? item.storage : defaultStorage
        }));
      } else if (Array.isArray(body.comicIds) && body.comicIds.length > 0 && body.fields && typeof body.fields === 'object') {
        operations = body.comicIds.map(comicId => ({
          comicId,
          fields: body.fields,
          storage: defaultStorage
        }));
      } else {
        return res.status(400).json({
          ok: false,
          message: 'Either items array or (comicIds array + fields object) is required'
        });
      }

      const results = [];
      let succeeded = 0;
      let failed = 0;

      for (const op of operations) {
        if (!op.comicId || !op.fields || typeof op.fields !== 'object') {
          results.push({ comicId: op.comicId, ok: false, message: 'comicId and fields object are required' });
          failed++;
          continue;
        }

        try {
          const comic = await getComic(op.comicId);
          if (!comic) {
            results.push({ comicId: op.comicId, ok: false, message: 'Comic not found' });
            failed++;
            continue;
          }
          const result = await applyComicTags(comic, op.fields, op.storage);
          results.push({ comicId: comic.id, ok: true, storage: result.storage, fields: op.fields });
          succeeded++;
        } catch (itemErr) {
          results.push({ comicId: op.comicId, ok: false, message: itemErr.message });
          failed++;
        }
      }

      log('INFO', 'MCP', `Bulk tags written: ${succeeded} succeeded, ${failed} failed out of ${operations.length}`);
      res.json({
        ok: failed === 0,
        total: operations.length,
        succeeded,
        failed,
        results
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to write bulk tags') });
    }
  });

  // --- Tags: write ComicInfo (single comic) --------------------------------
  router.post('/api/v1/comics/:id/tags', async (req, res) => {
    try {
      const comic = await getComic(req.params.id);
      if (!comic) return res.status(404).json({ ok: false, message: 'Comic not found' });
      const body = req.body || {};
      const fields = body.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return res.status(400).json({ ok: false, message: 'fields object is required' });
      }
      const result = await applyComicTags(comic, fields, body.storage);
      log('INFO', 'MCP', `Tags written for ${comic.name} via ${result.storage}`);
      res.json({ ok: true, comicId: comic.id, storage: result.storage, fields });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to write tags') });
    }
  });
};
