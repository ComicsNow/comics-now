const fs = require('fs');
const path = require('path');
const { writeComicInfoToCbz, buildComicInfoXml } = require('../../../services/metadata');
const { trimObjectStrings } = require('../../../utils');

module.exports = function attachScanMetaRoutes(router, deps) {
  const {
    log,
    dbAll,
    dbGet,
    dbRun,
    getComicsDirectories,
    scanLibrary,
    getConfig,
    isScanning,
    formatErrorMessage,
    isPathSafe,
    resolvePath,
    createId,
    saveMetadataToComic,
    requireAdmin
  } = deps;

  router.post('/api/v1/scan', requireAdmin, async (req, res) => {
    if (isScanning()) return res.json({ ok: true, message: 'Scan already in progress' });
    try {
      const isFull = !!(req.body && req.body.full);
      if (isFull) {
        await dbRun('DELETE FROM scan_dirs');
      }
      scanLibrary(isFull);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Scan failed') });
    }
  });

  router.post('/api/v1/admin/metadata/migrate', requireAdmin, async (req, res) => {
    const { mode } = req.body;
    if (!['archive', 'db', 'sidecar'].includes(mode)) {
      return res.status(400).json({ ok: false, message: 'Invalid mode' });
    }

    log('INFO', 'META', `🚀 Starting metadata migration to mode: ${mode}`);

    try {
      const comics = await dbAll('SELECT id, path, metadata FROM comics');
      let processed = 0;

      for (const comic of comics) {
        const comicPath = comic.path;
        if (!fs.existsSync(comicPath)) continue;

        const metadata = comic.metadata ? JSON.parse(comic.metadata) : {};
        const ext = path.extname(comicPath).toLowerCase();
        const sidecarPath = path.join(path.dirname(comicPath), path.basename(comicPath, ext) + '.ComicInfo.xml');
        const legacySidecarPath = path.join(path.dirname(comicPath), path.basename(comicPath, ext) + '.xml');

        try {
          if (mode === 'sidecar') {
            const metadataXml = buildComicInfoXml(metadata);
            if (metadataXml) {
              await fs.promises.writeFile(sidecarPath, metadataXml, 'utf-8');
            }
            if (fs.existsSync(legacySidecarPath)) {
              fs.unlinkSync(legacySidecarPath);
            }
          } else if (mode === 'archive') {
            if (ext === '.cbz') {
              const metadataXml = buildComicInfoXml(metadata);
              if (metadataXml) {
                await writeComicInfoToCbz(comicPath, metadataXml);
              }
            }
            if (fs.existsSync(sidecarPath)) {
              fs.unlinkSync(sidecarPath);
            }
            if (fs.existsSync(legacySidecarPath)) {
              fs.unlinkSync(legacySidecarPath);
            }
          } else if (mode === 'db') {
            if (fs.existsSync(sidecarPath)) {
              fs.unlinkSync(sidecarPath);
            }
            if (fs.existsSync(legacySidecarPath)) {
              fs.unlinkSync(legacySidecarPath);
            }
          }
        } catch (err) {
          log('ERROR', 'META', `Failed to migrate ${path.basename(comicPath)}: ${err.message}`);
        }

        processed++;
        if (processed % 100 === 0) {
          log('INFO', 'META', `Migration progress: ${processed}/${comics.length}`);
        }
      }

      log('INFO', 'META', `✅ Metadata migration complete. Processed ${processed} comics.`);
      res.json({ ok: true, processed });
    } catch (e) {
      log('ERROR', 'META', `Migration failed: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Migration failed') });
    }
  });

  router.post('/api/v1/comics/info', requireAdmin, async (req, res) => {
    try {
      const pB64 = req.query.path || '';
      const rawPath = Buffer.from(pB64, 'base64').toString('utf-8');
      const cbzPath = resolvePath(rawPath);
      if (!cbzPath) {
        return res.status(400).json({ ok: false, message: 'No path (missing ?path=)' });
      }

      if (!isPathSafe(cbzPath)) {
        return res.status(403).json({ ok: false, message: 'Access denied' });
      }

      const metadata = trimObjectStrings(req.body || {});
      const id = createId(cbzPath);

      log('INFO', 'META', `📥 Save metadata request for: ${cbzPath} (id=${id})`);
      log('INFO', 'META', `📦 Payload: ${JSON.stringify(metadata)}`);

      const comicRow = await dbGet('SELECT libraryMode FROM comics WHERE id = ?', [id]);
      const libraryMode = comicRow ? comicRow.libraryMode : 'metadata';

      const hasSeries = ((metadata.Series || '').toString().trim().length > 0) || ((metadata.Title || '').toString().trim().length > 0);
      const hasPublisher = (metadata.Publisher || '').toString().trim().length > 0;
      const hasDate = (metadata.Year || metadata.CoverDate || metadata.StoreDate || metadata['Cover Date'] || metadata['Store Date'] || '').toString().trim().length > 0;
      const hasNumber = (metadata.Number !== undefined && metadata.Number !== null && metadata.Number.toString().trim().length > 0);

      let tagStatus = (hasSeries && hasPublisher && hasDate && hasNumber) ? 'successful' : 'failed';
      const pub = (metadata.Publisher || '').trim() || null;
      const ser = (metadata.Series || metadata.Title || '').trim() || null;

      await dbRun(
        'UPDATE comics SET metadata = ?, tagStatus = ?, publisher = COALESCE(?, publisher), series = COALESCE(?, series) WHERE id = ?',
        [JSON.stringify(metadata), tagStatus, pub, ser, id]
      );
      log('INFO', 'META', `💾 DB updated for ${path.basename(cbzPath)}`);

      if (!fs.existsSync(cbzPath)) {
        log('ERROR', 'META', `❌ CBZ not found on disk: ${cbzPath}`);
        return res.status(404).json({ ok: false, message: 'CBZ not found on disk' });
      }

      if (libraryMode === 'folder') {
        log('INFO', 'META', `📂 ComicInfo.xml write-back skipped (Folder Mode) for ${path.basename(cbzPath)}`);
        return res.json({ ok: true, writeBack: 'skipped' });
      }

      try {
        await saveMetadataToComic(cbzPath, metadata, { preserveTitle: true });
        log('INFO', 'META', `📂 ComicInfo.xml written back into ${path.basename(cbzPath)}`);
        try {
          const stats = await fs.promises.stat(cbzPath);
          await dbRun('UPDATE comics SET updatedAt = ? WHERE id = ?', [stats.mtimeMs, id]);
        } catch (_) {}
      } catch (e) {
        log('ERROR', 'META', `❌ Write-back failed for ${path.basename(cbzPath)}: ${e.message}`);
        return res.status(200).json({ ok: true, writeBack: false, error: formatErrorMessage(e, req, 'Metadata write-back failed') });
      }

      log('INFO', 'META', `✅ Metadata save complete for ${path.basename(cbzPath)}`);
      return res.json({ ok: true, writeBack: true });
    } catch (e) {
      log('ERROR', 'META', `❌ POST /comics/info error: ${e.message}`);
      return res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to save metadata') });
    }
  });

  router.get('/api/v1/comics-directories', requireAdmin, (req, res) => {
    try {
      const directories = getComicsDirectories();
      if (!directories || directories.length === 0) {
        return res.status(500).json({ ok: false, message: 'No comics directories configured' });
      }

      const comicsLocation = getConfig().comicsLocation;
      const payload = directories.map(dir => ({
        path: dir,
        name: path.basename(dir),
        fullPath: dir,
        isInbox: dir === comicsLocation
      }));

      res.json({ ok: true, directories: payload });
    } catch (error) {
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to list directories') });
    }
  });
};
