const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const CSS_PATH = path.join(ROOT, 'public', 'style.css');

describe('Comics Now Title & Series/Publisher Typography', () => {
  let html;
  let css;

  beforeAll(() => {
    html = fs.readFileSync(HTML_PATH, 'utf8');
    css = fs.readFileSync(CSS_PATH, 'utf8');
  });

  describe('Comics Now App Title (Single-line, Red NOW, No Light Blue Shadow)', () => {
    it('renders the app title across a single line without a <br> tag', () => {
      const titleMatch = html.match(/<h1 class="app-title-riso">([\s\S]*?)<\/h1>/);
      expect(titleMatch).toBeTruthy();
      expect(titleMatch[1]).not.toContain('<br>');
      expect(titleMatch[1]).toMatch(/COMICS/);
      expect(titleMatch[1]).toMatch(/NOW/);
    });

    it('wraps the word NOW with a red styling hook in public/index.html', () => {
      const titleMatch = html.match(/<h1 class="app-title-riso">([\s\S]*?)<\/h1>/);
      expect(titleMatch).toBeTruthy();
      expect(titleMatch[1]).toMatch(/<(?:span)[^>]*class="[^"]*(?:text-vermilion|text-red|title-now)[^"]*"[^>]*>\s*NOW\s*<\/(?:span)>/);
    });

    it('enforces white-space: nowrap and responsive font-size on .app-title-riso for single-line display', () => {
      expect(css).toMatch(/\.app-title-riso\s*\{[^}]*white-space:\s*nowrap/);
      // Font size should be clamped appropriately for Pixel 10 Pro XL (viewport ~412px)
      expect(css).toMatch(/\.app-title-riso\s*\{[^}]*font-size:\s*clamp\(\s*(?:2[0-8]px|1\.[4-8]rem)/);
    });

    it('styles the word NOW in red in public/style.css', () => {
      expect(css).toMatch(/\.app-title-riso\s+\.(?:text-vermilion|text-red|title-now)[^{]*\{[^}]*color:\s*(?:var\(--(?:dc-absolute-red|red|vermilion)(?:,[^)]+)?\)|#e61c24|#fb4d3d)/);
    });

    it('removes the light blue (cyan) shadow effect from .app-title-riso and .logo-compact .app-title-riso', () => {
      const appTitleMatch = css.match(/\.app-title-riso\s*\{([^}]*)\}/);
      expect(appTitleMatch).toBeTruthy();
      expect(appTitleMatch[1]).not.toMatch(/text-shadow:[^;]*(?:var\(--cyan\)|#2ec6d6|cyan)/);

      const compactMatch = css.match(/\.logo-compact\s+\.app-title-riso\s*\{([^}]*)\}/);
      expect(compactMatch).toBeTruthy();
      expect(compactMatch[1]).not.toMatch(/text-shadow:[^;]*(?:var\(--cyan\)|#2ec6d6|cyan)/);
    });
  });

  describe('Series and Publisher Font Sizing', () => {
    it('sets series and publisher card titles (.series-card h3) to the smaller 0.8rem size', () => {
      // Must explicitly enforce font-size: 0.8rem (or 13px) for .series-card h3 to override generic 15px card titles
      expect(css).toMatch(/\.series-card\s+h3\s*\{[^}]*font-size:\s*(?:0\.8rem|13px)\s*!important/);
    });

    it('sets view titles (.view-title) to 1.5rem (text-2xl) instead of the oversized 2.25rem', () => {
      const viewTitleBlock = css.match(/\.view-title\s*\{([^}]*)\}/);
      expect(viewTitleBlock).toBeTruthy();
      expect(viewTitleBlock[1]).not.toMatch(/font-size:\s*2\.25rem/);
      expect(viewTitleBlock[1]).toMatch(/font-size:\s*1\.5rem/);
    });
  });
});
