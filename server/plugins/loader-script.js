/**
 * Builds the inline HTML guard script that loads private plugin bundles
 * only when they are allowed to run.
 *
 * Private plugins are excluded from:
 *   - Offline sessions (no network to their backends, and they must never be
 *     PWA-cached — see the /plugins/ bypass in public/service-worker.js)
 *
 * They ARE loaded in PWA standalone / fullscreen display modes and in iOS
 * Safari standalone (navigator.standalone).
 *
 * When no plugins are active the function returns an empty string and the
 * bootstrap injects nothing.
 *
 * @param {string} baseHref - Deployed base path (e.g. '/comics/')
 * @param {{ trackerActive?: boolean, ariaActive?: boolean }} active - Which plugins are enabled
 * @returns {string} Inline <script> HTML, or '' when nothing should load
 */
function buildPluginLoaderScript(baseHref, active = {}) {
  const sources = [];
  if (active.trackerActive) {
    sources.push(`${baseHref}plugins/tracker.js`);
  }
  if (active.ariaActive) {
    sources.push(`${baseHref}plugins/aria.js`);
  }
  if (sources.length === 0) {
    return '';
  }

  const sourceList = sources.map((src) => `    '${src}'`).join(',\n');

  return `<script>
(function () {
  if (navigator.onLine === false) return;
  var isStandalone = (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone === true;
  if (isStandalone) return;
  var pluginSources = [
${sourceList}
  ];
  pluginSources.forEach(function (src) {
    var s = document.createElement('script');
    s.type = 'module';
    s.src = src;
    document.head.appendChild(s);
  });
})();
</script>`;
}

module.exports = {
  buildPluginLoaderScript
};
