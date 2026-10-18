const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'style.css');

describe('DC Comics Modern Trade Dress & Editorial Design Language', () => {
  let css;

  beforeAll(() => {
    css = fs.readFileSync(CSS_PATH, 'utf8');
  });

  describe('Soul of the App Preservation', () => {
    it('preserves the comic library background.png in body styling', () => {
      expect(css).toMatch(/background-image:[^;]*background\.png/);
    });

    it('preserves the subtle halftone comic dots matrix overlay', () => {
      expect(css).toMatch(/body::before\s*\{[^}]*background-image:\s*radial-gradient/);
      expect(css).not.toMatch(/body::before\s*\{[^}]*display:\s*none/);
    });

    it('preserves authentic brand colors for app title and view title', () => {
      expect(css).toMatch(/\.view-title\s+\.text-cream[^{]*\{[^}]*color:\s*(?:#f3e9d2|var\(--cream\)|var\(--paper\))/);
      expect(css).toMatch(/\.view-title\s+\.text-vermilion[^{]*\{[^}]*color:\s*(?:#fb4d3d|#ff5449|var\(--vermilion\)|var\(--red\))/);
    });
  });

  describe('Modern DC "All In" & "Absolute" Trade Dress Tokens', () => {
    it('defines DC All In and Absolute Universe trade dress design tokens', () => {
      expect(css).toMatch(/--dc-trade-dress/);
      expect(css).toMatch(/--dc-all-in-blue/);
      expect(css).toMatch(/--dc-absolute-red/);
    });

    it('applies classic Milton Glaser bullet insignia styling to circular controls', () => {
      expect(css).toMatch(/\.fullscreen-close-button[^{]*\{[^}]*box-shadow:[^}]*rgba\(255,\s*255,\s*255,\s*0\.25\)/);
    });

    it('styles comic cards with art-forward trade dress hairline precision borders', () => {
      expect(css).toMatch(/\.comic-card\s*>[^{]*\{[^}]*border:[^;]*rgba\(255,\s*255,\s*255/);
    });
  });
});
