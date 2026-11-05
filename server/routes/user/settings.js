/**
 * User Settings Routes
 * @param {object} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  const {
    getComicVineApiKey,
    getScanIntervalMinutes,
    getPageCacheMaxMb,
    getPageCacheStats,
    getAllowedFormats,
    getDeleteCbrAfterConversion,
    getDeletePdfAfterConversion,
    getMetadataStorage
  } = deps;

  router.get('/api/v1/settings', async (req, res) => {
    const apiKey = getComicVineApiKey();
    const isAdmin = req.user?.role === 'admin';

    let pageCacheStats = null;
    if (typeof getPageCacheStats === 'function') {
      try {
        pageCacheStats = await getPageCacheStats();
      } catch {
        pageCacheStats = null;
      }
    }

    res.json({
      scanInterval: getScanIntervalMinutes(),
      pageCacheMaxMb: typeof getPageCacheMaxMb === 'function' ? getPageCacheMaxMb() : null,
      pageCacheUsageBytes: pageCacheStats ? pageCacheStats.totalBytes : null,
      pageCacheFileCount: pageCacheStats ? pageCacheStats.fileCount : null,
      allowedFormats: getAllowedFormats(),
      deleteCbrAfterConversion: getDeleteCbrAfterConversion ? getDeleteCbrAfterConversion() : false,
      deletePdfAfterConversion: getDeletePdfAfterConversion ? getDeletePdfAfterConversion() : false,
      metadataStorage: getMetadataStorage(),
      hasApiKey: !!(apiKey && apiKey !== 'YOUR_API_KEY_HERE'),
      // Only send actual key to admins (for settings form)
      comicVineApiKey: isAdmin ? apiKey : undefined
    });
  });
};
