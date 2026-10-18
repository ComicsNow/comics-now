module.exports = function attachHealthRoutes(router) {
  router.get('/api/v1/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({
      status: 'ok',
      timestamp: Date.now()
    });
  });
};
