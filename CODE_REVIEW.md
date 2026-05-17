# Comics Now (dev) — Code Review

_Reviewed: 2026-05-08. Scope: `/opt/comics-now-dev` (excluding `node_modules`, `thumbnails/`, `logos/`, `metadata/`, `screenshots/`, `temp/`, `conductor/`, `*.db`, `refactor_backup/` contents)._

## Critical

- ~~**Auth bypass via querystring**~~ — Resolved: `server/middleware/auth.js` now matches against `req.path` only, with an exact-path Set and a prefix list for `/icons/`, `/screenshots/`, `/js/`. Query strings can no longer trick the allowlist.
- **Duplicate auth tree** — `/middleware/auth.js` and `/server/middleware/auth.js` are byte-identical; only the latter is wired in. Delete the orphan before it desynchronizes. (Parallel migration folders were resolved: both `/migrations/` and `/server/migrations/` deleted; `server/db.js:initializeDatabase` is the schema source of truth.)
- ~~**Broken SQL `WHERE c.rootFolder = ?`**~~ — Resolved: the only call site lived in the duplicate handler, deleted below.
- ~~**Duplicate route handler**~~ — Resolved: removed the unreachable second `POST /api/v1/comics/set-all-continuous-mode` (was at `api.js:2278`); the working handler at `:2207` remains and matches what `public/js/settings.js:1688` actually sends.

## High

- ~~**Stored XSS via comic metadata**~~ — Resolved: shared `escapeHtml` added to `public/js/globals.js:13-20` and applied at every metadata interpolation in `library/render.js`, `app.js`, `metadata.js`, `reading-lists.js`, `comicvine.js`, `comictagger.js`. `viewer.js` already uses `textContent`; `context-menu/menu-actions.js` and `bulk-status.js` only interpolate static icons/labels/numerics.
- ~~**N+1 on `/api/v1/search`**~~ — False positive on re-check: `api.js:1759` already passes `accessList` as the 8th arg and `db.js:548` honors it as `preFetchedAccessList`. Admins also short-circuit before the DB load (api.js:1741, db.js:534). Per-row check is in-memory.
- ~~**Sync fs on the request thread**~~ — Resolved: both call sites in `api.js` (rename-cbz, move-comics) now use `await fs.promises.readdir(...)`.
- ~~**Full library scan on every metadata save**~~ — Resolved: removed the `scanLibrary()` call from `POST /api/v1/comics/info`. The handler already updates the DB row and writes ComicInfo.xml back to the CBZ, so the rescan would only re-read what was just written.
- **`express.json()` with no size limit** — `server.js:96`. Trivial OOM. Set `{ limit: '1mb' }`.
- ~~**JWKS init race**~~ — Re-checked: not actually a race (config loads synchronously before `initJwksClient`). Real bug was silent failure. Fixed: `auth.js` now logs an `ERROR` (once) when auth is enabled but `teamDomain`/`audience` is missing, an `INFO` when the JWKS client is constructed, and a `WARN` with the underlying error message on every JWT verification failure.

## Medium

- ~~**`/api/v1/progress` skips `isPathSafe`**~~ — Resolved: endpoint deleted (no frontend callers; `/sync/update` superseded it).
- ~~**Silent catches in auth path**~~ — Resolved: all four sites (`auth.js:127,164,194,253`) now log via `log('ERROR'/'WARN', 'AUTH', ...)`.
- ~~**API key leak in debug payload**~~ — Resolved: `_debug` block stripped from `/api/v1/comicvine/issue/:id` response.
- ~~**Wasteful `mkdir` per `/api/v1/comics` call**~~ — Resolved: removed the per-publisher `mkdir` from `buildLibrary`. `findLogoFileIn` already handles missing dirs gracefully (returns `null`); the 24h `logoCache` keeps the result. New publisher dirs can be created on demand by an admin when adding a logo.
- **No rate limiting** — Open. Decision: rely on Cloudflare/WAF since the app sits behind Cloudflare Zero Trust. Revisit if direct exposure changes.
- ~~**`refactor_backup/` is stale**~~ — Resolved: directory deleted.
- ~~**Service worker gaps**~~ — Resolved: bumped `CACHE_VERSION` to `v6.9`; added missing `js/viewer/full-image.js`, `js/viewer/end-navigation.js`, `js/viewer/guided.js`, `js/continuous.js`, `js/bulk-status.js`, `js/reading-lists.js`, `js/guided-reader.js` to `ASSET_PATHS`; gated the JS-handler `cache.put` on `url.origin === self.location.origin`.

## Low

- **`db.serialize` migrations are fire-and-forget** — `server.js` doesn't await schema readiness before scanning. Works today by queue luck; promote `initializeDatabase` to async and await.
- **Inconsistent error formatting** — some handlers use `formatErrorMessage`, neighbors return raw strings.
- **CBZ XML parser** — `api.js:643-671` can resolve+reject if the zip emits both `error` and the open path completes.
- **`/api/v1/sync/check`** has no `requireAuth`; in single-user mode any deviceId reads any progress. Add a comment or guard.
- ~~**Hardcoded `/opt/comics-now-dev` path**~~ — Resolved: `services/panel-detector.js:11-12` now uses relative requires (`../constants`, `../logger`). Safe to rsync to `/opt/comics-now`.

## Nits

- Dead/broken `checkUserAccess` (`db.js:506`, `access.granted`) and `getUserAccessibleResources` (`db.js:517`, `recursive_access`) reference columns that were migrated to `direct_access`/`child_access`.
- Inline `require('fs')` and `require('../db')` inside handlers despite top-of-file imports (`api.js:898, 1723, 2054, 2108`).
- `services/library.js:91` `new Promise(async ...)` antipattern.
- `public/test_write.txt` shouldn't be checked in.
- Empty `catch (error) {}` blocks in `app.js`.
- `service-worker.js:97` matches `/download` as substring — would catch a future `/downloads-summary`.

## Tests / scripts

`package.json` has `"test": "jest"` but zero test files exist — `npm test` fails. ESLint installed, no `lint` script. Add at minimum smoke tests for `validation.js` and `checkComicAccess` (pure, easy).

## The big architectural smell (resolved)

Two parallel migration systems existed: `server/db.js:initializeDatabase` does `CREATE TABLE` + 12 ad-hoc `ALTER TABLE` statements, and `server/migrations/001-004*.js` were aspirational (never invoked). The unused `server/migrations/` folder and the empty top-level `migrations/` were deleted. `db.js` is now the single schema source of truth — if you migrate to a real migration runner later, do it as a deliberate switch.

## Top issues to fix next

1. `express.json()` body-size limit + JWKS init race.
2. Stale duplicate `/middleware/auth.js` orphan file.
3. Sync `fs.readdirSync` calls on the request thread (api.js:456, :620).

Everything else can wait.
