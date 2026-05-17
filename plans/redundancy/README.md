# Redundancy Cleanup Plans

Per-finding plans for the items in `/opt/comics-now/CODE_REVIEW_REDUNDANT.md`. Each plan is independently revertable.

Read `00-TESTING-POLICY.md` first — every numbered plan defers to it for the rules on capturing before/after state and handling test failures (fix the code, not the test; always ask the user before modifying a test).

## Index

### Truly redundant — safe to delete

| # | Plan | Approx. line saving |
|---|---|---|
| 01 | [Delete `menu-actions.js`](01-orphan-menu-actions.md) | ~1,039 |
| 02 | [Delete `offline/db.js`](02-orphan-offline-db.md) | ~1,195 |
| 03 | [Remove device-management dup from `settings.js`](03-settings-device-block-dup.md) | ~300 |
| 04 | [Remove continuous-mode dup from `settings.js`](04-settings-continuous-mode-dup.md) | ~165 |
| 05 | [Consolidate `escapeHtml` family](05-escapehtml-consolidation.md) | ~30 |
| 06 | [Remove dead aliases in `routes/index.js`](06-routes-dead-aliases.md) | ~5 |
| 07 | [Tighten `panel-detector.js` exports](07-panel-detector-exports.md) | 0 (export-surface only) |
| 08 | [Drop `db` re-export from `settings.js`](08-settings-db-reexport.md) | ~2 |
| 09 | [Remove stray repo-root files](09-stray-files.md) | 2 files |

### Missing functionality — wire up, don't delete

| # | Plan |
|---|---|
| 10 | [Wire `validateSearchQuery` into `/api/v1/search`](10-wire-validateSearchQuery.md) |
| 11 | [Wire `validateComicId` at all comic-id boundaries](11-wire-validateComicId.md) |
| 12 | [Wire `closeDb` into SIGTERM/SIGINT handlers](12-wire-graceful-shutdown.md) |
| 13 | [Fix broken `ROOT_DIR` reference in `server.js`](13-fix-rootdir-reference.md) |
| 14 | [Add `actions-folder.js` to service-worker asset list](14-sw-actions-folder-asset.md) |

## Suggested execution order

1. Plans 01, 02, 09 — pure deletions, lowest risk.
2. Plan 14 — small one-line fix + cache bump.
3. Plan 13 — one-line bug fix (decide A vs B with the user first).
4. Plans 03, 04 — `settings.js` blocks; do 03 before 05.
5. Plan 05 — `escapeHtml` consolidation (depends on 03).
6. Plans 06, 07, 08 — server-side export tightening.
7. Plan 12 — graceful shutdown.
8. Plans 10, 11 — validator wiring; 11 should land per-handler in separate commits.

Each plan commits independently so you can stop or revert at any point.
