/**
 * Phase 0.1 — Tailwind class inventory snapshot (characterization).
 *
 * Scans the repository's HTML/JS sources under public/ and snapshots the
 * sorted set of unique class tokens in use. This locks the exact utility
 * vocabulary so the v3→v4 codemod renames show up as a reviewable diff in
 * the snapshot.
 *
 * The file list comes from the git index (`git ls-files public`), not a raw
 * directory walk: only files that are part of the repository may influence
 * the snapshot, so it stays reproducible on any clean checkout. (A raw walk
 * also picked up locally added, uncommitted files, which made this test
 * fail on CI during the v1.3.0 release with tokens that exist nowhere in
 * the repo.) Vendor files (jszip.min.js) are excluded: they are not
 * hand-written UI markup.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const EXCLUDED_FILES = new Set(['jszip.min.js']);

const CLASS_ATTR = /class="([^"]*)"/g;
const CLASSNAME_SET = /\.className\s*[+]?=\s*['"`]([^'"`]+)['"`]/g;
const CLASSLIST_OP = /classList\.(?:add|remove|toggle)\(([^)]*)\)/g;

/** Plausible utility token: letters/digits plus the punctuation Tailwind uses. */
const VALID_TOKEN = /^[-\w[\]#/:%.()]+$/;

/** Repository files under public/ that the snapshot covers. */
function sourceFiles() {
  return execFileSync('git', ['ls-files', 'public'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && /\.(html|js)$/.test(f) && !EXCLUDED_FILES.has(path.basename(f)))
    .sort();
}

function collectTokens(file) {
  const source = fs.readFileSync(file, 'utf8');
  const tokens = new Set();
  const record = (raw) => {
    for (const t of raw.split(/\s+/)) {
      const token = t.trim();
      if (token && VALID_TOKEN.test(token) && /\w/.test(token) && !token.includes('${')) {
        tokens.add(token);
      }
    }
  };

  let m;
  CLASS_ATTR.lastIndex = 0;
  while ((m = CLASS_ATTR.exec(source))) record(m[1]);
  CLASSNAME_SET.lastIndex = 0;
  while ((m = CLASSNAME_SET.exec(source))) record(m[1]);
  CLASSLIST_OP.lastIndex = 0;
  while ((m = CLASSLIST_OP.exec(source))) {
    for (const arg of m[1].split(',')) {
      const stripped = arg.trim().replace(/^['"`]|['"`]$/g, '');
      if (stripped && !stripped.includes('${')) record(stripped);
    }
  }
  return tokens;
}

describe('Tailwind class inventory (public/**/*.{html,js})', () => {
  it('snapshots the sorted unique set of class tokens in use', () => {
    const files = sourceFiles();
    const tokens = new Set();
    for (const file of files) {
      for (const token of collectTokens(path.join(ROOT, file))) tokens.add(token);
    }
    expect(files.length).toBeGreaterThan(0);
    expect(tokens.size).toBeGreaterThan(100);
    expect([...tokens].sort()).toMatchSnapshot();
  });
});
