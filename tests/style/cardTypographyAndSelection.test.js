const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'style.css');

describe('Punchier Comic Typography & Selection State for Cards', () => {
  let css;

  beforeAll(() => {
    css = fs.readFileSync(CSS_PATH, 'utf8');
  });

  describe('Punchier Comic Typography', () => {
    it('applies uppercase comic font with letter-spacing to card titles', () => {
      // Must use Anton/display font, uppercase, and letter-spacing for punchy comic presence
      expect(css).toMatch(/\.comic-card\s+h3[^{]*\{[^}]*font-family:\s*['"]?Anton['"]?/);
      expect(css).toMatch(/\.comic-card\s+h3[^{]*\{[^}]*text-transform:\s*uppercase/);
      expect(css).toMatch(/\.comic-card\s+h3[^{]*\{[^}]*letter-spacing:/);
    });

    it('applies uppercase comic typography to series and publisher titles while maintaining 0.8rem size', () => {
      expect(css).toMatch(/\.series-card\s+h3\s*\{[^}]*font-size:\s*(?:0\.8rem|13px)\s*!important/);
      expect(css).toMatch(/\.series-card\s+h3\s*\{[^}]*text-transform:\s*uppercase/);
      expect(css).toMatch(/\.series-card\s+h3\s*\{[^}]*letter-spacing:/);
    });
  });

  describe('Card Selection & Focus State (DC All In Electric Blue)', () => {
    it('applies DC All In electric blue halo and border to selected and focused cards', () => {
      // Matches hover, focus-visible, and selected states
      expect(css).toMatch(/\.series-card\.selected\s*>\s*div:first-child|\.series-card\[aria-selected="true"\]/);
      expect(css).toMatch(/border-color:\s*var\(--dc-all-in-blue\)/);
      expect(css).toMatch(/box-shadow:[^;]*var\(--dc-all-in-blue\)/);
    });

    it('enhances title contrast and glow when card is hovered or selected', () => {
      expect(css).toMatch(/\.series-card:hover\s+h3[^{]*\{[^}]*color:\s*#ffffff/);
    });
  });
});
