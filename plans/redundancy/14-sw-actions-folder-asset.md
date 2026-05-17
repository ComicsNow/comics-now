# Plan 14 — Add `actions-folder.js` to the service-worker asset list

**Category:** Missing functionality — caching bug.

## Finding

`public/index.html` loads `js/context-menu/actions-folder.js`, but `public/service-worker.js:48-55` lists every other `actions-*.js` (`actions-comic`, `actions-series`, `actions-publisher`, `actions-library`, `actions-shared`) and omits this one. Online sessions work because the browser fetches it directly; offline-launched sessions (PWA cold start without network) fail to load the folder context menu silently.

## Steps

1. In `public/service-worker.js`, add `'js/context-menu/actions-folder.js'` to `ASSET_PATHS` next to its siblings (around line 55).
2. Bump `CACHE_VERSION` (per the SW's convention — find the existing constant near the top of the file and increment it, e.g., `v7.4` → `v7.5`).
3. `grep -n "actions-folder\|CACHE_VERSION" public/service-worker.js` — confirm both edits.

## Test strategy

### Before
- `grep -c "actions-folder" public/service-worker.js` → `0`.
- Open the app online, install as PWA. DevTools → Application → Cache Storage → inspect the precache. `actions-folder.js` is missing.
- Toggle DevTools → Network → Offline. Reload. Right-click a folder in the library — the menu either doesn't appear or fires a console error about a missing function.

### After
- `grep -c "actions-folder" public/service-worker.js` → `1`.
- Hard-refresh the app online (DevTools Application → "Unregister" then reload, or wait for the SW update cycle). Confirm in cache storage that `actions-folder.js` is now precached and `CACHE_VERSION` is bumped.
- Toggle offline; reload; right-click a folder — menu appears with all items; no console errors.

## On failure

Per shared policy.
- **SW didn't update:** browser is still on the old version. Force-update via DevTools → Application → Service Workers → "Update" or "Unregister". This is a caching artifact, not a code bug.
- **Old asset list still served:** confirm `CACHE_VERSION` was actually bumped — if you only edited `ASSET_PATHS` without changing the version, the install handler won't invalidate.
- **Other assets become uncached after the bump:** unlikely, but if so the asset list has a typo in another entry. `diff` the file against `HEAD~1` and verify only the two intended changes are present.
- No tests cover the SW today; an integration test would need a headless browser. Out of scope unless the user asks.
