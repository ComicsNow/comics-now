# Plan 08 — Drop unused `db` re-export from `server/settings.js`

**Category:** Truly redundant.

## Finding

`server/settings.js:76` re-exports `db` (imported from `./db`). No consumer destructures `db` from `./settings`. The single import site (`server.js:69`) destructures only `{ loadSettings, saveSetting }`.

## Steps

1. Confirm: `grep -rn "require.*settings').db\|from.*settings.*db" server server.js`. Must be empty.
2. Edit `server/settings.js`:
   - Remove `db` from the destructure on line 1 (keep `dbAll`, `dbRun`).
   - Remove the `db` line from `module.exports`.
3. `node -e "console.log(Object.keys(require('./server/settings')))"` — should print `['loadSettings', 'saveSetting']`.

## Test strategy

### Before
- `npm test`.
- Start server, exercise the settings endpoints: `GET /api/v1/settings`, change a setting via the admin UI, confirm it persists (reload).

### After
- `npm test` — identical result.
- Repeat the settings smoke. No behavior change expected.

## On failure

Per shared policy. If anything breaks, a hidden consumer was relying on the side-effect of `require('./settings')` exposing `db`. The fix is to have that consumer import from `./db` directly — not to restore the re-export.
