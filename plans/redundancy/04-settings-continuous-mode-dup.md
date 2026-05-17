# Plan 04 — Remove duplicate continuous-mode block from `public/js/settings.js`

**Category:** Truly redundant.

## Finding

`public/js/settings.js:600-764` (≈165 lines) is **byte-identical** to `public/js/settings/continuous-mode.js`. `diff` between the two returns empty. Both define `loadContinuousModeDefaults` and `initContinuousModeSettings`. The modular file loads first; the `settings.js` copy redefines the same identifiers with the same bodies.

## Steps

1. Reconfirm identity:
   `diff <(sed -n '600,758p' public/js/settings.js) <(sed -n '2,160p' public/js/settings/continuous-mode.js)` — must be empty.
2. Delete `settings.js` lines 600-764 (`loadContinuousModeDefaults` through `initContinuousModeSettings`).
3. `grep -n "loadContinuousModeDefaults\|initContinuousModeSettings" public/js/settings.js` — must return nothing.
4. Commit.

## Test strategy

### Before
- `npm test`.
- Open Settings → Reading Defaults (or wherever continuous-mode controls live). Toggle the continuous-mode default on/off; reload the page; confirm the default persisted.
- Open a comic; confirm the default applies. Toggle continuous mode for that comic; reload; confirm per-comic state and default are independent.

### After
- `npm test` — identical result.
- Repeat the continuous-mode smoke. Defaults and per-comic state must behave identically.
- DevTools console: no `ReferenceError`, no warnings on settings init.

## On failure

Per shared policy. If `initContinuousModeSettings` is `undefined` after deletion, then `settings/continuous-mode.js` either isn't loading (check `index.html` and `service-worker.js`) or loads in the wrong order. Fix the load order; don't restore the duplicate.
