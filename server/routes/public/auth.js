/**
 * Public Auth Routes
 * 
 * Handles user authentication status and profile information.
 */
const { rateLimiter } = require('../../middleware/rate-limiter');

module.exports = function attach(router, deps) {
  const authLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 100
  });
  router.use(authLimiter);

  const {
    requireAuth,
    isAuthEnabled
  } = deps;

  // Get current user info
  router.get('/api/v1/user/me', requireAuth, (req, res) => {
    res.json({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      authEnabled: isAuthEnabled()
    });
  });
};
