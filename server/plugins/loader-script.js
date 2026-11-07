/**
 * Builds the inline HTML guard script that loads private plugin bundles
 * only when they are allowed to run.
 *
 * Private plugins are excluded from:
 *   - Offline sessions (no network to their backends, and they must never be
 *     PWA-cached — see the /plugins/ bypass in public/service-worker.js)
 *
 * They ARE loaded in PWA standalone / fullscreen display modes and in iOS
 * Safari standalone (navigator.standalone) whenever the app is online.
 *
 * When the app transitions between online and offline states, the guard
 * automatically updates plugin element visibility to prevent broken requests.
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
  var loaded = false;
  var pluginSources = [
${sourceList}
  ];

  function updatePluginVisibility() {
    var isOff = navigator.onLine === false || (document.body && document.body.classList && document.body.classList.contains('is-offline'));
    var trackerBtn = document.getElementById('tracker-button');
    var ariaBtn = document.getElementById('aria-button');
    var trackerView = document.getElementById('tracker-view');
    var ariaView = document.getElementById('aria-view');

    if (trackerBtn) trackerBtn.style.display = isOff ? 'none' : '';
    if (ariaBtn) ariaBtn.style.display = isOff ? 'none' : '';
    if (isOff) {
      if (trackerView) trackerView.style.display = 'none';
      if (ariaView) ariaView.style.display = 'none';
    }
  }

  function loadPlugins() {
    if (loaded) return;
    if (navigator.onLine === false) return;
    loaded = true;
    pluginSources.forEach(function (src) {
      var s = document.createElement('script');
      s.type = 'module';
      s.src = src;
      document.head.appendChild(s);
    });
  }

  if (navigator.onLine !== false) {
    loadPlugins();
  }

  window.addEventListener('online', function () {
    loadPlugins();
    updatePluginVisibility();
  });

  window.addEventListener('offline', function () {
    updatePluginVisibility();
  });

  if (window.MutationObserver) {
    var obs = new MutationObserver(function () {
      updatePluginVisibility();
    });
    obs.observe(document.body || document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }
})();
</script>`;
}

module.exports = {
  buildPluginLoaderScript
};
