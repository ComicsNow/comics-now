const { buildPluginLoaderScript } = require('../../server/plugins/loader-script.js');

// Synthetic base paths only: the loader must work for ANY deployed base href,
// so the capability is exercised across generic ones, never a real deploy path.
const BASE_HREFS = ['/', '/reader/'];

describe('buildPluginLoaderScript (private plugin injection guard)', () => {
  test.each(BASE_HREFS)('returns an empty string when no plugins are active (base "%s")', (baseHref) => {
    expect(buildPluginLoaderScript(baseHref, { trackerActive: false, ariaActive: false })).toBe('');
    expect(buildPluginLoaderScript(baseHref, {})).toBe('');
  });

  test.each(BASE_HREFS)('includes both plugin module srcs under the base href when both are active (base "%s")', (baseHref) => {
    const script = buildPluginLoaderScript(baseHref, { trackerActive: true, ariaActive: true });

    expect(script).toContain(`'${baseHref}plugins/tracker.js'`);
    expect(script).toContain(`'${baseHref}plugins/aria.js'`);
  });

  test.each(BASE_HREFS)('omits the tracker src when only aria is active (base "%s")', (baseHref) => {
    const script = buildPluginLoaderScript(baseHref, { trackerActive: false, ariaActive: true });

    expect(script).toContain(`'${baseHref}plugins/aria.js'`);
    expect(script).not.toContain('plugins/tracker.js');
  });

  test.each(BASE_HREFS)('omits the aria src when only tracker is active (base "%s")', (baseHref) => {
    const script = buildPluginLoaderScript(baseHref, { trackerActive: true, ariaActive: false });

    expect(script).toContain(`'${baseHref}plugins/tracker.js'`);
    expect(script).not.toContain('plugins/aria.js');
  });

  test.each(BASE_HREFS)('skips loading while offline (base "%s")', (baseHref) => {
    const script = buildPluginLoaderScript(baseHref, { trackerActive: true, ariaActive: true });

    expect(script).toContain('navigator.onLine');
    expect(script).toContain("navigator.onLine === false");
  });

  test.each(BASE_HREFS)('skips loading in PWA standalone and fullscreen display modes (base "%s")', (baseHref) => {
    const script = buildPluginLoaderScript(baseHref, { trackerActive: true, ariaActive: true });

    expect(script).toContain('(display-mode: standalone)');
    expect(script).toContain('(display-mode: fullscreen)');
    // iOS Safari standalone detection
    expect(script).toContain('navigator.standalone');
  });

  test.each(BASE_HREFS)('loads plugin modules by creating script elements when allowed (base "%s")', (baseHref) => {
    const script = buildPluginLoaderScript(baseHref, { trackerActive: true, ariaActive: true });

    expect(script).toContain("document.createElement('script')");
    expect(script).toContain("s.type = 'module'");
  });
});
