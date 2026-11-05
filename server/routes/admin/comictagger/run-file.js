/**
 * Per-comic Tag Search endpoint.
 *
 * Runs the full Tag Comics Now pipeline for a single comic row, including
 * comics that live outside the smart folder.
 */

module.exports = function attachRunFileRoutes(router, deps) {
  const {
    dbGet,
    checkComicAccess,
    getComicsDirectories,
    runSingleFileTagger,
    formatErrorMessage
  } = deps;

  router.post('/api/v1/tag-comics-now/run-file', async (req, res) => {
    const { comicId, force } = req.body || {};

    if (!comicId || typeof comicId !== 'string') {
      return res.status(400).json({
        ok: false,
        code: 'invalid_comic_id',
        message: 'comicId is required.'
      });
    }

    try {
      const comic = await dbGet(
        'SELECT id, path, publisher, series FROM comics WHERE id = ?',
        [comicId]
      );
      if (!comic || !comic.path) {
        return res.status(404).json({
          ok: false,
          code: 'comic_not_found',
          message: 'Comic not found.'
        });
      }

      const user = req.user || { role: 'admin' };
      const hasAccess = await checkComicAccess({
        userId: user.userId,
        userRole: user.role,
        comicPath: comic.path,
        publisher: comic.publisher,
        series: comic.series,
        rootFolders: getComicsDirectories(),
        comicId: comic.id
      });
      if (!hasAccess) {
        return res.status(403).json({
          ok: false,
          code: 'access_denied',
          message: 'You do not have access to this comic.'
        });
      }

      const result = await runSingleFileTagger({
        comicId,
        force: force === true || force === 'true'
      });

      return res.json({ ok: true, ...result });
    } catch (err) {
      const status = Number.isInteger(err.statusCode) ? err.statusCode : 500;
      const message = typeof formatErrorMessage === 'function'
        ? formatErrorMessage(err, req, 'Tag search failed')
        : err.message;
      return res.status(status).json({
        ok: false,
        code: err.code || 'tagger_error',
        message
      });
    }
  });
};
