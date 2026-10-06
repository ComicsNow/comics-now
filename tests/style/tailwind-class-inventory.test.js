/**
 * Phase 0.1 — Tailwind class inventory snapshot (characterization).
 *
 * Scans every HTML/JS source under public/ and snapshots the sorted set of
 * unique class tokens in use. This locks the exact utility vocabulary so the
 * v3→v4 codemod renames show up as a reviewable diff in the snapshot.
 *
 * Vendor files (jszip.min.js) and the Vite build output (public/dist) are
 * excluded: they are not hand-written UI markup.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const EXCLUDED_FILES = new Set(['jszip.min.js']);

const CLASS_ATTR = /class="([^"]*)"/g;
const CLASSNAME_SET = /\.className\s*[+]?=\s*['"`]([^'"`]+)['"`]/g;
const CLASSLIST_OP = /classList\.(?:add|remove|toggle)\(([^)]*)\)/g;

/** Plausible utility token: letters/digits plus the punctuation Tailwind uses. */
const VALID_TOKEN = /^[-\w[\]#/:%.()]+$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist') continue; // Vite build output, derived from the sources
      walk(full, out);
    } else if (!EXCLUDED_FILES.has(entry.name) && /\.(html|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
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
    const files = walk(PUBLIC_DIR).map((f) => path.relative(ROOT, f)).sort();
    const tokens = new Set();
    for (const file of files) {
      for (const token of collectTokens(path.join(ROOT, file))) tokens.add(token);
    }
    expect(files.length).toBeGreaterThan(0);
    expect(tokens.size).toBeGreaterThan(100);
    expect([...tokens].sort()).toMatchSnapshot();
  });
});
