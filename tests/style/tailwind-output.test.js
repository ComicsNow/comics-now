/**
 * Phase 0.2 — generated CSS must contain a rule for each utility the app uses
 * that the v3→v4 migration touched, plus a set of core utilities.
 *
 * History: GREEN on v3. After the v4 engine swap (still on the legacy
 * `@tailwind` directives) this went RED because v4 silently drops
 * theme-dependent utilities in that mode — which is what forced Phase 2's
 * CSS-first entry. Now GREEN again under styles/tailwind.css
 * (`@import "tailwindcss" source(none)` + explicit @source of public/).
 *
 * The v4 rename surface for this codebase, verified empirically against
 * v4.3.3 probe builds and the committed v3 stylesheet as ground truth:
 *
 *   value-changing renames applied:
 *     shadow-sm        -> shadow-xs          (v4's shadow-sm == v3 `shadow`)
 *     backdrop-blur-sm -> backdrop-blur-xs   (v4's backdrop-blur-sm == 8px)
 *     bg-<color> bg-opacity-NN -> bg-<color>/NN  (bg-opacity-* removed in v4)
 *
 *   canonical (value-identical) renames applied:
 *     flex-shrink-0 -> shrink-0, flex-grow -> grow,
 *     bg-gradient-to-* -> bg-linear-to-*,
 *     aspect-[2/3] -> aspect-2/3, z-[9999] -> z-9999,
 *     break-words -> wrap-break-word
 *
 *   semantics-preserving rename applied (Phase 3 manual item):
 *     outline-none -> outline-hidden — v4's outline-none is
 *     `outline-style:none` and drops v3's forced-colours fallback
 *     (transparent 2px outline); v4's outline-hidden restores it via an
 *     `@media (forced-colors: active)` block, matching v3's outline-none.
 *
 *   unchanged in v4 (no rename needed): bare rounded/shadow keep their v3
 *     values (probed against v4.3.3); placeholder-<color> remains available.
 *
 * Runs the same CLI binary the `build:css` script uses (node_modules/.bin/
 * `tailwindcss`) into a TEMP output file — public/tailwind.css is never
 * touched here (prod serves it live from this checkout).
 *
 * Note: bare `ring` is NOT asserted — the markup only uses ring-1/ring-2
 * (explicit widths, unchanged in v4), so the v4 default-width change
 * (3px -> 1px) has no surface in this codebase.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TAILWIND_BIN = path.join(ROOT, 'node_modules', '.bin', 'tailwindcss');

// Utilities whose spelling changed in v4 (or that only exist in v4).
const RENAMED_SELECTORS = [
  'shadow-xs',
  'backdrop-blur-xs',
  'shrink-0',
  'grow',
  'bg-linear-to-r',
  'bg-linear-to-t',
  'wrap-break-word',
  'sm:wrap-break-word',
  'aspect-2/3',
  'z-9999',
  'bg-gray-900/75',
  'bg-black/50',
  'outline-hidden',
  'focus:outline-hidden',
];

// Utilities whose names are unchanged but that must keep working.
const KEPT_SELECTORS = [
  'flex',
  'border',
  'rounded',
  'shadow',
  'hidden',
  'grid',
  'text-white',
  'bg-gray-700',
];

// Escape a class name the way Tailwind escapes it in a selector
// (e.g. `sm:wrap-break-word` -> `.sm\:wrap-break-word`), then escape the
// result for use in a RegExp.
const cssEscape = (sel) => sel.replace(/([:./[\]])/g, '\\$1');
const regexEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const selectorPattern = (sel) =>
  // The negative lookahead keeps `.rounded` from matching `.rounded-lg`.
  new RegExp(`\\.${regexEscape(cssEscape(sel))}(?![\\w-])`);

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
  it('emits a rule for every renamed-at-risk utility (v4 names)', () => {
    const css = buildCss();
    for (const selector of RENAMED_SELECTORS) {
      expect(css).toMatch(selectorPattern(selector));
    }
  }, 120000);

  it('emits a rule for every kept core utility', () => {
    const css = buildCss();
    for (const selector of KEPT_SELECTORS) {
      expect(css).toMatch(selectorPattern(selector));
    }
  }, 120000);
});
