# Plan 01 — Delete orphan `public/js/context-menu/menu-actions.js`

**Category:** Truly redundant.

## Finding

`public/js/context-menu/menu-actions.js` (1,039 lines) defines `triggerGuidedRunForScope`, `isEligibleComic`, `showComicContextMenu`, `showSeriesContextMenu`, `showPublisherContextMenu`, `showLibraryContextMenu`. All six are implemented in the modular split (`actions-comic.js`, `actions-series.js`, `actions-publisher.js`, `actions-library.js`, `actions-shared.js`), which also adds `showFolderContextMenu` that the monolith never had. The file is not loaded by `index.html` or listed in `service-worker.js` `ASSET_PATHS`.

## Steps

1. `grep -rn "menu-actions" public server server.js scripts package.json public/service-worker.js` — confirm zero non-self references one more time before the delete.
2. `git rm public/js/context-menu/menu-actions.js`.
3. Commit.

## Test strategy

Follow `00-TESTING-POLICY.md` for capture/diff/failure handling.

### Before
- `npm test` (baseline pass list).
- `grep -rn "menu-actions" .` excluding `node_modules` and `.git`.
- Boot the app (`node server.js`), open in a browser, right-click each entity (comic, series, publisher, library, folder) and confirm each menu opens and an item from each (Mark read, Download, Toggle manga, Toggle continuous, Trigger guided run) works.

### After
- `npm test` — expect identical result to before.
- Repeat the right-click smoke. Each context menu must still appear with the same items and behave identically.
- Hard-refresh with DevTools "Disable cache" on, confirm no 404 for `menu-actions.js`.

## On failure

Per shared policy. The most likely failure mode is a stale browser cache fetching the old file (a 404 is the intended outcome, not a regression). If a context-menu item is *missing* after deletion, the modular files are incomplete — fix the missing item in the appropriate `actions-*.js`, do not restore `menu-actions.js`.
