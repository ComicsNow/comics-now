/**
 * Phase 0.3 — build command contract.
 *
 * Asserts that `npm run build:css` (the exact script CI/publish/prepack run)
 * exits 0 and writes a non-empty public/tailwind.css. This is precisely the
 * check that would have caught the v1.2.4 `tailwindcss: not found` break.
 *
 * public/tailwind.css is restored byte-for-byte afterwards: this checkout is
 * the live prod worktree and the running service serves that file from disk.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'tailwind.css');

describe('build:css contract', () => {
  let original;

  beforeAll(() => {
    original = fs.readFileSync(CSS_PATH);
  });

  afterAll(() => {
    fs.writeFileSync(CSS_PATH, original);
  });

  it('npm run build:css exits 0 and writes a non-empty public/tailwind.css', () => {
    execSync('npm run build:css', { cwd: ROOT, timeout: 180000, stdio: 'pipe' });

    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css.length).toBeGreaterThan(10000);
    // Sanity: the file is genuinely generated CSS, not a stub.
    expect(css).toContain('.flex');
  }, 180000);
});
