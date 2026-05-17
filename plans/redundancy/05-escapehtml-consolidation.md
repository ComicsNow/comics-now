# Plan 05 — Consolidate `escapeHtml` family

**Category:** Truly redundant.

## Finding

Four identical HTML-escape helpers exist:
- `public/js/globals.js:14 escapeHtml` — the canonical shared version.
- `public/js/settings.js:294 escapeHtmlValue` — will be removed by Plan 03 (device block); flag only if Plan 03 hasn't run.
- `public/js/settings/shared.js:1 escapeHtmlValue` — survivor candidate after Plan 03.
- `public/js/guided-reader.js:16 escapeHtml` — local IIFE-scoped shadow of the global.

Bodies are equivalent for non-null string input. `globals.js`'s version handles `null`/`undefined` (returns `''`); `escapeHtmlValue` does the same; `guided-reader.js`'s wraps in `String()` without the null guard (`String(null)` → `"null"`, not `""`).

## Steps

1. **Run Plan 03 first** so `settings.js:294` is already gone.
2. Decide the survivor. Recommend keeping `escapeHtml` from `globals.js` (loaded first, available everywhere).
3. In `public/js/settings/shared.js`: delete the `escapeHtmlValue` definition (lines 1-9). Add an alias at the top: `const escapeHtmlValue = escapeHtml;` so existing callers (`public/js/settings/devices.js`, etc.) keep working. Or, rename callers — but the alias is the smaller diff.
4. In `public/js/guided-reader.js`: delete the local `function escapeHtml` (lines 16-23). The outer global `escapeHtml` from `globals.js` is in scope.
5. `grep -rn "function escapeHtml\b\|function escapeHtmlValue\b" public` — must show only `globals.js` and (if you used the alias) `settings/shared.js`'s `const escapeHtmlValue =` line.

## Test strategy

### Before
- `npm test`.
- Open Settings → Devices; verify device names render correctly (escaped if they contain `<`, `&`, `"`).
- Open the Guided Reader status page; verify any displayed series/title strings render correctly.
- In DevTools, inject a comic name like `<img src=x onerror=alert(1)>` into the library cache (via IndexedDB editor) and confirm the rendered metadata escapes it.

### After
- `npm test` — identical result.
- Repeat the device-name and guided-reader visual checks.
- Repeat the XSS check — must still escape.
- DevTools console: no `ReferenceError: escapeHtml is not defined` from any module.

## On failure

Per shared policy. **Critical regression to watch:** if the surviving `escapeHtml` is null-stricter than the deleted copy, a previously-rendered field that was `null`/`undefined` will now render as `""` instead of `"null"`. That is correct behavior; don't revert. If the global version is missing the null guard, add it to `globals.js`, don't restore the local copy.

If `escapeHtmlValue` is undefined in `settings/devices.js`, the alias line was placed below its first use — move the alias to the top of `settings/shared.js`.
