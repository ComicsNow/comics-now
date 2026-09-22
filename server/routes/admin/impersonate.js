/**
 * Admin impersonation control endpoints.
 *
 * These are guarded by requireRealAdmin (they judge the REAL identity, because
 * while impersonating req.user is the target/non-admin). Starting sets a signed
 * cookie in the admin's browser; the swap itself happens in the impersonation
 * middleware. Every start/stop is written to impersonation_audit.
 */
const { signToken, setCookie, clearCookie } = require('../../middleware/impersonation');

module.exports = function attach(router, deps) {
  const { dbGet, dbRun, dbAll, log, formatErrorMessage } = deps;

  const realAdmin = (req) => req.realUser || req.user;

  async function audit(admin, target, action) {
    try {
      await dbRun(
        `INSERT INTO impersonation_audit (adminUserId, adminEmail, targetUserId, targetEmail, action, ts)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [admin.userId, admin.email, target.userId, target.email, action, Date.now()]
      );
    } catch (e) {
      log('WARN', 'IMPERSONATE', `audit write failed: ${e.message}`);
    }
  }

  // Current impersonation status (for the app-wide banner).
  router.get('/api/v1/admin/impersonate/status', (req, res) => {
    if (req.impersonator) {
      return res.json({
        ok: true,
        impersonating: true,
        target: { userId: req.user.userId, email: req.user.email },
        admin: { userId: req.impersonator.userId, email: req.impersonator.email }
      });
    }
    res.json({ ok: true, impersonating: false });
  });

  // Stop impersonating (exempt from the read-only guard). Declared BEFORE the
  // ":userId" route so the literal path isn't captured as userId="stop".
  router.post('/api/v1/admin/impersonate/stop', async (req, res) => {
    try {
      clearCookie(res);
      if (req.impersonator) {
        await audit(req.impersonator, req.user, 'stop');
        log('INFO', 'IMPERSONATE', `${req.impersonator.email} stopped impersonating ${req.user.email}`);
      }
      res.json({ ok: true, impersonating: false });
    } catch (error) {
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to stop impersonation') });
    }
  });

  // Start impersonating a user.
  router.post('/api/v1/admin/impersonate/:userId', async (req, res) => {
    try {
      const admin = realAdmin(req);
      const { userId } = req.params;

      if (userId === admin.userId) {
        return res.status(400).json({ ok: false, message: 'You cannot impersonate yourself.' });
      }

      const target = await dbGet('SELECT userId, email, role FROM users WHERE userId = ?', [userId]);
      if (!target) {
        return res.status(404).json({ ok: false, message: 'User not found' });
      }
      if (target.role === 'admin') {
        return res.status(400).json({ ok: false, message: 'Cannot impersonate another admin.' });
      }

      const token = await signToken(dbGet, dbRun, {
        adminUserId: admin.userId,
        targetUserId: target.userId
      });
      setCookie(res, token, req);
      await audit(admin, target, 'start');
      log('INFO', 'IMPERSONATE', `${admin.email} started impersonating ${target.email}`);

      res.json({ ok: true, impersonating: true, target: { userId: target.userId, email: target.email } });
    } catch (error) {
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to start impersonation') });
    }
  });

  // Recent impersonation audit trail.
  router.get('/api/v1/admin/impersonate/audit', async (req, res) => {
    try {
      const rows = await dbAll(
        `SELECT adminEmail, targetEmail, action, ts FROM impersonation_audit ORDER BY ts DESC LIMIT 100`
      );
      res.json({ ok: true, audit: rows });
    } catch (error) {
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to load audit') });
    }
  });
};
