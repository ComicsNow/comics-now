# Plan 02 — Delete orphan `public/js/offline/db.js`

**Category:** Truly redundant.

## Finding

`public/js/offline/db.js` (1,195 lines) holds the pre-split IndexedDB layer. All 25 functions exist in the modular files (`db-core.js`, `db-jwt.js`, `db-library-cache.js`, `db-queue.js`, `db-comics.js`, `db-namespace.js`), and the modular set adds `isIdInLibrary` the monolith lacks. The file is not loaded by `index.html` or listed in `service-worker.js` `ASSET_PATHS`.

## Steps

1. `grep -rn "offline/db'\|offline/db\"\|offline\\\\/db\\.js" public server server.js public/service-worker.js` — confirm zero references.
2. Compare exports: `diff <(grep -hE "^  (async )?function " public/js/offline/db.js | sort -u) <(grep -hE "^  (async )?function " public/js/offline/db-*.js | sort -u)`. Every name in the monolith must appear in the modular set. If any is missing, stop and port it before deleting.
3. `git rm public/js/offline/db.js`.
4. Commit.

## Test strategy

### Before
- `npm test`.
- Open the app, sign in, download a comic for offline (queue + complete). Verify it appears in the offline library list.
- Open another tab in airplane mode (or DevTools "Offline"), reload the app, open the same comic. Confirm it renders.
- DevTools → Application → IndexedDB → inspect the `comics-now` DB and note the stores present.

### After
- `npm test` — identical result.
- Same offline smoke: download, go offline, reload, open the same comic.
- DevTools → IndexedDB: stores and contents must be identical (the deletion only removes a dead script tag, not the DB code).

## On failure

Per shared policy. If an offline operation breaks, a function in `offline/db.js` was relied on but missing from the modular set — port it into the appropriate `db-*.js` rather than restoring the monolith. If a test references symbols from `offline/db.js` directly (unlikely; tests target the server), confirm with the user before modifying the test.
