# Plan 06 — Remove dead aliases in `server/routes/index.js`

**Category:** Truly redundant.

## Finding

`server/routes/index.js:3-6` imports `formatErrorMessage` and `isPathSafe` aliased to `_formatErrorMessage` / `_isPathSafe`. Neither alias is referenced anywhere in the file. Lines 33-43 then re-`require('../utils')` inside two closures and shadow `_isPathSafe` in a separate scope. Pure dead imports.

## Steps

1. Re-grep: `grep -n "_formatErrorMessage\|_isPathSafe" server/routes/index.js`. Confirm line 4-5 declarations and line 37/39 (which is a separate inner-scoped binding) are the only hits.
2. Replace the destructuring on lines 3-6 with: simply delete those two aliased fields. Keep the rest of the destructure block intact.
3. Optionally tighten the closures: instead of `require('../utils')` re-imports on lines 33, 37, 42, hoist a single top-level `const { formatErrorMessage, isPathSafe, resolveLibraryPath } = require('../utils');` and have the closures reference those bindings. (Lower-risk variant: just delete the dead aliases and leave the inline requires.)
4. `node -e "require('./server/routes')"` — module must still load without throwing.

## Test strategy

### Before
- `npm test`.
- Start the server. `curl http://localhost:3000/api/v1/comics-directories` (any authenticated endpoint with auth disabled, or with an admin token) — expect a normal 200.
- Hit `/api/v1/comics/info` with a bad path to exercise the inner `isPathSafe` closure path — expect the same error message and status as today.

### After
- `npm test` — identical result.
- Server starts cleanly: `grep -i "error\|warning" server-startup.log` — no new entries.
- Repeat the two curl checks. Same responses.

## On failure

Per shared policy. The most likely failure is accidentally deleting a *used* destructured key alongside the dead aliases. `git diff` the file and confirm only the two aliased lines are gone. If the server fails to start with `ReferenceError`, restore from the diff and re-do more surgically.
