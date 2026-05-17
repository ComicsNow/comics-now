# Plan 13 — Fix the broken `ROOT_DIR` reference in `server.js`

**Category:** Missing functionality — fix broken safety check.

## Finding

`server.js:256` reads:
```js
if (!dir.startsWith('/') || dir.startsWith(ROOT_DIR)) {
  fs.mkdirSync(dir, { recursive: true });
  ...
}
```

`server.js` imports `LOGOS_DIRECTORY`, `ICONS_DIRECTORY`, `THUMBNAILS_DIRECTORY`, `SCRIPTS_DIRECTORY` from `./server/constants` but **not `ROOT_DIR`**. The branch is reached only when a configured library directory doesn't exist on disk. Today it throws `ReferenceError: ROOT_DIR is not defined`, which is caught by the surrounding `try` and silently swallowed (line 261: `// Quietly ignore library directory creation failures`). So a feature labeled "auto-create user-writable library dirs" is fully broken in production.

## Steps

1. Decide intent (ask the user if uncertain):
   - **(A) Keep the auto-create behavior:** add `ROOT_DIR` to the destructure on `server.js:10-15`:
     ```js
     const {
       ROOT_DIR,
       LOGOS_DIRECTORY,
       ICONS_DIRECTORY,
       THUMBNAILS_DIRECTORY,
       SCRIPTS_DIRECTORY
     } = require('./server/constants');
     ```
   - **(B) Drop the feature:** delete the whole `getComicsDirectories().forEach(...)` block on lines 252-264. Library directories are configured by operators; auto-creating them silently is arguably wrong anyway.
2. If (A): also remove the empty `catch {}` (line 261) and log the actual error at `WARN` level so a real failure is visible.
3. If (B): leave the LOGOS/ICONS/THUMBNAILS auto-create block intact — only the library-dir block goes.

## Test strategy

### Before
- `npm test`.
- Configure a non-existent library path in `config.json` (e.g., `/tmp/cn-test-libs/does-not-exist`).
- Start server. `grep "Ensured library dir" server.log` → today: empty (silently swallowed). `ls /tmp/cn-test-libs/does-not-exist 2>&1` → "No such file".
- Optional: `node -e "process.on('uncaughtException', e => console.log('CAUGHT:', e.message)); require('./server.js')"` — confirm the `ReferenceError` is what's being swallowed.

### After (option A)
- `npm test` — unchanged.
- Start server with the same bad library path. `ls /tmp/cn-test-libs/does-not-exist` → directory now exists; log line `Ensured library dir: /tmp/cn-test-libs/does-not-exist` is present.
- Configure a non-writable path (e.g., `/root/blocked`) and start — the WARN line should now log the real `EACCES` error instead of silence.

### After (option B)
- `npm test` — unchanged.
- Start server with the bad path. Directory is NOT created. Log shows no library-dir lines. The library scan that follows will skip it.

## On failure

Per shared policy.
- **(A) fails because `mkdirSync` throws `EACCES`:** intended — that's the operator's permission problem. Log it; don't swallow.
- **Server crashes on startup:** the most likely cause is destructuring `ROOT_DIR` from a file that doesn't export it. Confirm `server/constants.js` exports it (line 7 — it does).
- **No existing test covers this path** — the failure mode was silent in prod. Consider adding a small unit test that mocks `fs.existsSync`/`fs.mkdirSync` and asserts the ROOT_DIR branch behaves correctly. Ask the user before adding non-essential tests if scope is tight.
