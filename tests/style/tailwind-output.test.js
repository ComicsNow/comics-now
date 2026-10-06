/**
 * Phase 0.2 — generated CSS must contain a rule for each at-risk utility.
 *
 * Runs the same CLI binary the `build:css` script uses (node_modules/.bin/
 * `tailwindcss`) into a TEMP output file — public/tailwind.css is never
 * touched here (prod serves it live from this checkout).
 *
 * GREEN on v3: every utility below is emitted.
 * After the v4 engine swap (before the codemod): `.rounded`, `.shadow`,
 * `.outline-none`, `.flex-shrink`, `.flex-grow`, `.blur`, `.bg-opacity-*`
 * vanish from the output → RED → forces the markup renames (Phase 3), which
 * then updates this list to the new v4 names.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TAILWIND_BIN = path.join(ROOT, 'node_modules', '.bin', 'tailwindcss');

// At-risk utilities exercised by the app's markup on Tailwind v3.
// Renamed/removed in v4:
//   rounded -> rounded-sm | shadow -> shadow-sm | outline-none -> outline-hidden
//   flex-shrink -> shrink | flex-grow -> grow | blur -> blur-sm
//   bg-opacity-* -> bg-*/<opacity>
// Note: bare `ring` is NOT in this list — the markup only uses ring-1/ring-2
// (explicit 1px/2px widths, unchanged in v4), so the v4 default-width change
// from 3px to 1px has no surface in this codebase.
const AT_RISK_SELECTORS = [
  'flex',
  'border',
  'rounded',
  'shadow',
  'outline-none',
  'flex-shrink',
  'flex-grow',
  'blur',
  'bg-opacity-75',
  'bg-opacity-50',
];

// Stable utilities that must keep working across the migration.
const CORE_SELECTORS = ['hidden', 'grid', 'text-white', 'bg-gray-700'];

function buildCss() {
  const tmpOut = path.join(os.tmpdir(), `tailwind-output-${process.pid}.css`);
  try {
    execFileSync(
      TAILWIND_BIN,
      ['-i', 'styles/tailwind.css', '-o', tmpOut, '--minify'],
      { cwd: ROOT, timeout: 120000, stdio: 'pipe' }
    );
    return fs.readFileSync(tmpOut, 'utf8');
  } finally {
    fs.rmSync(tmpOut, { force: true });
  }
}

describe('generated Tailwind CSS contains the utilities the app relies on', () => {
  it('emits a rule for every at-risk utility (v3 names)', () => {
    const css = buildCss();
    for (const selector of AT_RISK_SELECTORS) {
      // Match the exact class selector, not a longer name sharing the prefix
      // (e.g. `.rounded` must not match `.rounded-lg`).
      expect(css).toMatch(new RegExp(`\\.${selector}(?![\\w-])`));
    }
  }, 120000);

  it('emits a rule for every core utility', () => {
    const css = buildCss();
    for (const selector of CORE_SELECTORS) {
      expect(css).toMatch(new RegExp(`\\.${selector}(?![\\w-])`));
    }
  }, 120000);
});
