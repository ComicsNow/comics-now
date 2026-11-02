const { dbAll, getReadingPrefMaps, resolveReadingModes } = require('../../db');
const { getComicsDirectories } = require('../../config');

function getScopeStatuses(force) {
  return force ? ['pending', 'failed', 'completed'] : ['pending', 'failed'];
}

async function buildQueue(scope = null) {
  const roots = getComicsDirectories();
  const readingMaps = await getReadingPrefMaps();
  const queue = [];
  const statuses = (scope && Array.isArray(scope.statuses) && scope.statuses.length)
    ? scope.statuses
    : ['pending', 'failed'];
  const statusPlaceholders = statuses.map(() => '?').join(',');

  const targetRoots = (scope && scope.type === 'library')
    ? roots.filter(r => r === scope.target)
    : roots;

  for (const root of targetRoots) {
    const rootPrefix = root.endsWith('/') ? root : root + '/';
    const likePattern = rootPrefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';

    let sql = `SELECT id, publisher, series, name, path,
                      COALESCE(guidedViewStatus, 'pending') AS guidedViewStatus
               FROM comics
               WHERE path LIKE ? ESCAPE '\\'
                 AND COALESCE(guidedViewStatus, 'pending') IN (${statusPlaceholders})`;
    const params = [likePattern, ...statuses];

    if (scope && Array.isArray(scope.ids) && scope.ids.length) {
      sql += ` AND id IN (${scope.ids.map(() => '?').join(',')})`;
      params.push(...scope.ids);
    }

    if (scope && scope.type === 'comic') {
      sql += ' AND id = ?';
      params.push(scope.target);
    } else if (scope && scope.type === 'series') {
      sql += ' AND series = ?';
      params.push(scope.target);
    } else if (scope && scope.type === 'publisher') {
      sql += ' AND publisher = ?';
      params.push(scope.target);
    }

    sql += ` ORDER BY
               COALESCE(publisher, 'zzz_unknown') COLLATE NOCASE,
               COALESCE(series, 'zzz_unknown') COLLATE NOCASE,
               COALESCE(name, '') COLLATE NOCASE`;

    const rows = await dbAll(sql, params);
    for (const r of rows) {
      const { mangaMode } = resolveReadingModes({
        comicId: r.id,
        series: r.series,
        publisher: r.publisher,
        comicPath: r.path,
        prefMaps: readingMaps,
        comicsRoots: roots
      });
      const type = mangaMode ? 'manga' : 'western';
      queue.push({ ...r, _root: root, type });
    }
  }
  return queue;
}

module.exports = {
  getScopeStatuses,
  buildQueue
};
