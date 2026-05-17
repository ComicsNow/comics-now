# Plan 03 — Remove duplicate device-management block from `public/js/settings.js`

**Category:** Truly redundant.

## Finding

`public/js/settings.js:290-589` (≈300 lines) is a near byte-identical copy of `public/js/settings/devices.js`. `diff` shows only ~14 lines of difference, all cosmetic. Since `settings/devices.js` loads first (`index.html` line 1562) and `settings.js` loads later (line 1567), the duplicated identifiers in `settings.js` clobber the modular ones at runtime with the same function bodies — no behavior change, but pure duplication.

## Steps

1. Re-confirm the diff is purely cosmetic:
   `diff <(sed -n '290,589p' public/js/settings.js) public/js/settings/devices.js`.
2. Delete `settings.js` lines 290-589 inclusive (the contiguous block from `function escapeHtmlValue` through the device-list click handler).
3. Verify `settings.js` no longer defines `escapeHtmlValue`, `formatDeviceTimestamp`, `getStoredDeviceInfo`, `setDevicesStatus`, `renderDeviceList`, or `refreshDeviceList`: `grep -n "^function \(escapeHtmlValue\|formatDeviceTimestamp\|getStoredDeviceInfo\|setDevicesStatus\|renderDeviceList\|refreshDeviceList\)" public/js/settings.js` must return nothing.
4. Verify `settings/devices.js` and `settings/shared.js` still define them.
5. Commit.

## Test strategy

### Before
- `npm test`.
- Open Settings → Devices. Confirm: list renders, "Refresh" button works, device names display, "Remove" prompts and removes successfully, timestamps render in the relative format ("Just now", "5m ago", "2d ago").
- As admin, switch the user filter dropdown — list reloads scoped to the selected user.

### After
- `npm test` — identical result.
- Repeat the entire Settings → Devices smoke. Every behavior must match.
- Open DevTools console while the modal is open: no `ReferenceError`, no "function redeclared" warnings.

## On failure

Per shared policy. The most likely failure mode is removing too much (deleting code that wasn't actually duplicated). If a device-management feature breaks, restore from `git diff HEAD~1` and re-do the deletion with tighter line bounds. Do not move logic back into `settings.js`.
