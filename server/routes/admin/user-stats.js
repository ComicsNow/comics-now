/**
 * Per-user reading stats (derived, no telemetry).
 *
 * All figures are computed from user_comic_status (the per-user source of truth
 * for reading progress). This gives accurate read/in-progress/opened counts,
 * active days, a per-day activity series and recent activity. It intentionally
 * does NOT report true "time spent" — progress writes are too sparse to measure
 * duration; that would require the deferred heartbeat telemetry.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

module.exports = function attach(router, deps) {
  const { dbGet, dbAll, log, formatErrorMessage } = deps;

  router.get('/api/v1/users/:userId/stats', async (req, res) => {
    try {
      const { userId } = req.params;
      const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
      const since = Date.now() - days * DAY_MS;

      const user = await dbGet('SELECT userId, email, role FROM users WHERE userId = ?', [userId]);
      if (!user) return res.status(404).json({ ok: false, message: 'User not found' });

      // Per-user status rows joined to comic titles.
      const rows = await dbAll(
        `SELECT ucs.comicId, ucs.lastReadPage, ucs.totalPages, ucs.updatedAt,
                c.name AS comicName, c.series AS series
         FROM user_comic_status ucs
         LEFT JOIN comics c ON c.id = ucs.comicId
         WHERE ucs.userId = ?`,
        [userId]
      );

      const isComplete = (r) => r.totalPages > 0 && r.lastReadPage >= r.totalPages - 1;
      const isInProgress = (r) => r.lastReadPage > 0 && !isComplete(r);

      let completed = 0, inProgress = 0, opened = 0;
      const dayMap = new Map();      // day -> comics touched that day
      let lastActive = 0;

      for (const r of rows) {
        opened += 1; // any status row = the user has opened this comic
        if (isComplete(r)) completed += 1;
        else if (isInProgress(r)) inProgress += 1;
        if (r.updatedAt) {
          lastActive = Math.max(lastActive, r.updatedAt);
          if (r.updatedAt >= since) {
            const k = dayKey(r.updatedAt);
            dayMap.set(k, (dayMap.get(k) || 0) + 1);
          }
        }
      }

      // Dense per-day series over the requested window (fills zero days).
      const perDay = [];
      for (let i = days - 1; i >= 0; i--) {
        const k = dayKey(Date.now() - i * DAY_MS);
        perDay.push({ day: k, comics: dayMap.get(k) || 0 });
      }
      const activeDays = [...dayMap.values()].filter(Boolean).length;

      // Recent activity: latest 50 touched comics (client paginates 5/page).
      const recent = rows
        .filter(r => r.updatedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 50)
        .map(r => ({
          comicId: r.comicId,
          name: r.comicName || r.comicId,
          series: r.series || null,
          lastReadPage: r.lastReadPage,
          totalPages: r.totalPages,
          status: isComplete(r) ? 'completed' : (isInProgress(r) ? 'in_progress' : 'opened'),
          updatedAt: r.updatedAt
        }));

      res.json({
        ok: true,
        user: { userId: user.userId, email: user.email, role: user.role },
        rangeDays: days,
        summary: {
          opened,
          completed,
          inProgress,
          activeDays,
          lastActive: lastActive || null
        },
        perDay,
        recent,
        note: 'Reading time-per-day is not tracked. Figures are derived from saved reading progress.'
      });
    } catch (error) {
      log('ERROR', 'STATS', `Failed to build user stats: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to load user stats') });
    }
  });
};
