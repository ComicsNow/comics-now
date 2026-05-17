# Plan 10 — Wire up `validateSearchQuery` in the search endpoint

**Category:** Missing functionality — wire up, don't delete.

## Finding

`server/validation.js:182 validateSearchQuery` (max 500 chars, trims) is exported but never called. `server/routes/user/library.js:80 GET /api/v1/search` accepts `req.query.query`, does a `.trim()`, and pushes it straight into four `LIKE %?%` clauses against the `comics` table. No length cap, no rejection of malformed input.

## Steps

1. In `server/routes/user/library.js`:
   - Add `validateSearchQuery` to the `deps` destructure at the top of `attach`. (`server/routes/index.js` already passes it through `extendedDeps`; if it doesn't, add it there.)
   - In the search handler, replace `const q = query.trim();` with:
     ```js
     const v = validateSearchQuery(req.query.query);
     if (!v.valid) return res.status(400).json({ message: v.error });
     const q = v.sanitized;
     ```
2. Confirm `extendedDeps` in `server/routes/index.js:46` already includes `validateSearchQuery`. (Other `validate*` are listed; this one might be missing — add it.)

## Test strategy

### Before
- `npm test` (note: `validateSearchQuery` is not in `tests/validation.test.js` today — confirm that).
- `curl 'http://localhost:3000/api/v1/search?query=batman'` — returns an array.
- `curl 'http://localhost:3000/api/v1/search?query=$(printf "a%.0s" {1..600})'` — currently returns results; should return `400` after the fix.
- `curl 'http://localhost:3000/api/v1/search?query='` — currently returns `[]`.

### After
- Add a `describe('validateSearchQuery')` block to `tests/validation.test.js` with at least:
  - empty/undefined input returns `{ valid: true, sanitized: '' }`.
  - normal string trims correctly.
  - 501-char string returns `{ valid: false }`.
- `npm test` — all green including new cases.
- Repeat the three curls. The 600-char one must now `400`; the others unchanged.

## On failure

Per shared policy.
- If existing tests fail: the most likely cause is that `validateSearchQuery` rejected something the test was sending unsanitized. Inspect — if the test was relying on the old no-validation behavior with payloads that should have been rejected, the *test* is wrong; **ask the user before changing it**.
- If a real user reports their search broke: check the input. If they're sending >500 chars deliberately, raise the cap in `validateSearchQuery` (a code change, not a test change).
- If the new tests fail: validator behavior may have drifted from its JSDoc. Fix `validateSearchQuery`, don't loosen the new tests.
